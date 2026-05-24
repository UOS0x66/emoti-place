import openai from '../config/openai.js';
import PERSONAS from '../prompts/personas.js';
import { getSession, updateSession } from './sessionService.js';

const MAX_HISTORY = 20;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

// ─────────────────────────────────────────────────────────────
// DYNAMIC HINT 생성기
//
// 매 턴 직전 대화를 분석해 페르소나가 "이번 응답을 어떻게 짤지" 가이드를 생성.
// 사용자 메시지 앞에 system 메시지로 주입한다 (system prompt는 캐시 친화적으로 고정 유지).
// ─────────────────────────────────────────────────────────────

const PERSONA_INTERJECTIONS = {
  1: ['예 행님', '허,', '캬,', '에헤이 행님', '오메,', '쯧,', '흐음'],
  2: ['수신 확인', '입력 처리', '…흠', '분석 중', '본 시스템 응답'],
  3: ['아이고', '어유', '허허', '쯧쯧', '어머나야', '에휴', '야야'],
};

const ANGRY_KEYWORDS = ['그놈', '그 자식', '그 양반', '뒤집', '빡', '속이 다', '비겁', '결함', '인간이', '못된', '욕', '세상이'];

function detectInterjection(text, personaId) {
  const pool = PERSONA_INTERJECTIONS[personaId] || [];
  return pool.find((w) => text.includes(w)) || null;
}

function isAngryTone(text) {
  return ANGRY_KEYWORDS.some((k) => text.includes(k));
}

function isShortMetaUtterance(text) {
  const t = (text || '').trim();
  if (!t) return false;
  // 5자 이하 + (의문/감탄/외마디)
  if (t.length <= 5 && /[?？!ㅋㅎ~]?$/.test(t)) return true;
  // 단일 외마디 패턴
  if (/^(뭐|왜|응|어|음|네|아|헐|진짜|진심|뭔|뭐라|왜그래|왜요|뭐예요)[?!]?$/.test(t)) return true;
  return false;
}

function isRecommendationRequest(text) {
  return /추천|어디|좋은 데|좋은데|알려줘|소개/.test(text || '');
}

function isCasualTone(text) {
  // 가벼운 일상 신호: 너무 짧지 않고, 부정 감정 키워드도 없는 평이한 메시지
  const t = (text || '').trim();
  if (!t || t.length < 4) return false;
  const negatives = /짜증|힘들|우울|화|싫|아프|지쳤|울|죽고|그만|미치|답답|속상|괴롭|서럽|외롭|쓸쓸/;
  return !negatives.test(t);
}

function buildDynamicHint(history, userMessage, personaId) {
  const hints = [];

  // 실제 대화 턴 수 (그리팅만 있는 첫 메시지면 0턴)
  const realBotTurns = history.filter((m, i) => m.role === 'assistant' && i > 0).length;
  const isFirstTurn = realBotTurns === 0;

  // 직전 봇 응답 분석 (그리팅은 제외 — index 0)
  const lastBot = history.length > 1
    ? [...history.slice(1)].reverse().find((m) => m.role === 'assistant')
    : null;
  if (lastBot) {
    const used = detectInterjection(lastBot.content, personaId);
    if (used) {
      hints.push(`직전 응답에서 추임새 "${used}" 사용했음. 이번엔 반드시 다른 추임새로.`);
    }
    if (isAngryTone(lastBot.content)) {
      hints.push('직전 응답이 격분/세상욕 톤이었음. 이번엔 격분 톤 자제하고 디테일 파고들기 또는 차분 모드로.');
    }
  }

  // 사용자 메시지 분석 — 메타 외마디는 첫 턴이 아닐 때만 적용
  if (!isFirstTurn && isShortMetaUtterance(userMessage)) {
    hints.push('사용자가 짧은 외마디/의문문을 던졌음. 직전 자기 응답에 대한 의문·당혹일 가능성. 새로 격분/감정 톤 만들지 말고, 살짝 톤 다운해서 페르소나 캐릭터로 가볍게 받아쳐라.');
  }

  if (isRecommendationRequest(userMessage)) {
    hints.push('사용자가 추천을 직접 요구함. 짧게 "따로 정리해드리겠다" 식으로 받고, 곧장 사용자 감정·상황으로 돌아와 한 마디 더 받아쳐라. 추가 질문 금지.');
  }

  if (isCasualTone(userMessage) && (userMessage || '').trim().length < 20) {
    hints.push('사용자 톤이 가볍거나 일상적임. 무겁게 끌고 가지 말고, 페르소나 색깔로 짧고 가볍게 받아라.');
  }

  // 응답 카운트로 변주 강화 (실제 대화 3턴 이상부터 변주 압력)
  if (realBotTurns >= 3) {
    hints.push('대화가 누적됐음. 같은 톤 반복하지 말고 이번엔 의식적으로 어휘·문장 구조를 새로 빚어라.');
  }

  if (hints.length === 0) return null;
  return '[이번 턴 가이드 — 반드시 반영]\n' + hints.map((h, i) => `${i + 1}. ${h}`).join('\n');
}

// ─────────────────────────────────────────────────────────────
// 메시지 구성: system + few-shot + history + (hint) + user
// ─────────────────────────────────────────────────────────────

function composeMessages(persona, personaId, history, userMessage) {
  const hint = buildDynamicHint(history, userMessage, personaId);

  const messages = [
    { role: 'system', content: persona.system_prompt },
    // 그리팅 + 실제 대화 히스토리만 (few-shot 없음 — LLM이 무관한 맥락에도 베끼는 부작용 회피)
    ...history.slice(-MAX_HISTORY).filter((m) => m.role !== 'user' || m.content !== userMessage),
  ];

  // hint는 user 메시지 직전에 system role로 박아 매번 갱신
  if (hint) {
    messages.push({ role: 'system', content: hint });
  }
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/**
 * 페르소나 대화 응답을 SSE 스트리밍으로 생성한다.
 */
async function streamChat(sessionId, userMessage, res) {
  const session = await getSession(sessionId);
  const persona = PERSONAS[session.persona_id];

  // 대화 히스토리 로드 (사용자 메시지 추가 전 상태가 hint 분석 기준)
  let history = session.conversation_history || [];

  const messages = composeMessages(persona, session.persona_id, history, userMessage);

  // history는 저장용으로 사용자 메시지 추가
  history.push({ role: 'user', content: userMessage });

  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let fullResponse = '';

  try {
    const stream = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages,
      stream: true,
      temperature: 0.85,
      max_tokens: 400,
      frequency_penalty: 0.4,
      presence_penalty: 0.3,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // 히스토리에 응답 추가 후 저장
    history.push({ role: 'assistant', content: fullResponse });

    // 히스토리 크기 제한
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    await updateSession(sessionId, {
      conversation_history: history,
    });

    res.write(`data: ${JSON.stringify({ done: true, full_response: fullResponse })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}

export { streamChat, buildDynamicHint, composeMessages };
