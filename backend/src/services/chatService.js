import openai from '../config/openai.js';
import PERSONAS from '../prompts/personas.js';
import { getSession, updateSession, generateSessionTitle } from './sessionService.js';
import { listMemoriesForUser } from './memoryService.js';
import { detectEdgeCase, getEdgeCaseHint } from '../prompts/edgeCases.js';

const MAX_HISTORY = 20;
// 채팅은 instruction-following + 톤 일관성이 중요해서 LLM_MODEL(파이프라인용 mini)과 분리.
// CHAT_MODEL 미설정 시 LLM_MODEL 로 폴백.
const LLM_MODEL = process.env.CHAT_MODEL || process.env.LLM_MODEL || 'gpt-4o';

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

// 페르소나별 hint 예시 — DYNAMIC HINT 가 다른 페르소나 예시를 누설하면 응답에 그 페르소나 문구가 박힘.
const SHORT_META_EXAMPLES_BY_PERSONA = {
  1: '"행님, 제가 말이 좀 셌습니까"',
  2: '*"응답 톤 과잉, 감지."*',
  3: '"어유 아가 할미가 셌나"',
};

const NEW_KEEL_BY_PERSONA = {
  1: '과장 충정·제3자 디스·자기 비하 등',
  2: '인간미 누출·황당 분석·시스템 농담 등',
  3: '잔소리·세상 욕·옛날 얘기 등',
};

// 페르소나별 드립 마커 — 응답에 이 단어가 포함되면 "드립이 있다" 로 본다.
// 빈도 강제용 휴리스틱이라 정확도 100% 아님, 다만 90%+ 드립률 페르소나(조폭/할미)에선 충분히 잘 작동.
const DRIP_MARKERS_BY_PERSONA = {
  1: ['골목', '잠 못', '빡', '걸겠', '비겁', '버르장머리', '그놈', '그 자식', '담배', '술 한 잔', '인생 다'],
  2: ['변수 활성', '권장', '결함', '임계', '프로토콜', '미보유', '권한 외', '캘리브레이션', '검출'],
  3: ['세상이', '옛날', '한마디', '동네 어른', '그년', '그 가스나', '시방 너', '인간이'],
};

// 빈도 강제 대상 페르소나 — 평가에서 90%+ 드립률 보인 페르소나에만 적용.
// 로봇(35%)에는 적용하지 않는다 (overshoot 회피).
const ENFORCE_DRIP_FREQUENCY = new Set([1, 3]);

function detectInterjection(text, personaId) {
  const pool = PERSONA_INTERJECTIONS[personaId] || [];
  return pool.find((w) => text.includes(w)) || null;
}

function isAngryTone(text) {
  return ANGRY_KEYWORDS.some((k) => text.includes(k));
}

function hasDripMarker(text, personaId) {
  const markers = DRIP_MARKERS_BY_PERSONA[personaId] || [];
  return markers.some((m) => (text || '').includes(m));
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

// 사용자가 "어떻게/방법" 류 실용 질문을 던지면 LLM 이 RLHF 학습된 "helpful assistant" 매뉴얼 모드로 빠짐.
// 캐릭터 톤 유지하라는 신호 별도로 박아야 함.
function isPracticalQuestion(text) {
  return /어떻게|어떡|방법|뭐\s*해야|뭘\s*해야|어찌|어떡함/.test(text || '');
}

function isCasualTone(text) {
  // 가벼운 일상 신호: 너무 짧지 않고, 부정 감정 키워드도 없는 평이한 메시지
  const t = (text || '').trim();
  if (!t || t.length < 4) return false;
  const negatives = /짜증|힘들|우울|화|싫|아프|지쳤|울|죽고|그만|미치|답답|속상|괴롭|서럽|외롭|쓸쓸/;
  return !negatives.test(t);
}

function buildDynamicHint(history, userMessage, personaId, memories = []) {
  const hints = [];

  // 엣지 케이스 — 패턴 매치 시 강한 우선 hint (다른 가이드보다 위에 박는다)
  const edgeCase = detectEdgeCase(userMessage, history);
  if (edgeCase) {
    const edgeHint = getEdgeCaseHint(edgeCase, personaId);
    if (edgeHint) hints.push(edgeHint);
  }

  // 메모리 callback — 이전 만남에서 알게 된 사용자 컨텍스트
  if (Array.isArray(memories) && memories.length > 0) {
    const memSection = memories
      .slice(0, 3)
      .map((m) => `- ${m.content}`)
      .join('\n');
    hints.push(
      `[사용자 컨텍스트 — 이전 만남에서 알게 된 것]\n${memSection}\n흐름이 자연스럽게 맞을 때만 캐릭터 톤으로 한 마디 callback (예: "아까 그놈 또 그러던가요?"). 매 응답마다 박지 마라. 어색하면 그냥 무시.`
    );
  }

  // 실제 대화 턴 수 (그리팅만 있는 첫 메시지면 0턴)
  const realBotTurns = history.filter((m, i) => m.role === 'assistant' && i > 0).length;
  const isFirstTurn = realBotTurns === 0;

  // ★ 톤 가이드 — 매뉴얼 위로 차단. 드립은 적재적소에 (평균 2~3턴에 한 번).
  hints.push('매뉴얼식 위로·공감 문구 금지. 캐릭터답게 받아라. 드립·과장은 흐름이 맞으면 박고, 안 맞으면 평이한 캐릭터 톤으로. 매번 박지도, 너무 안 박지도 마라.');

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
      hints.push('직전 응답이 격분 톤이었음. 이번엔 변주 — 과장 충정/잔소리/시스템 농담/딴소리 같은 다른 코미디 결로 가라.');
    }
  }

  // [F] 빈도 강제 — 직전 2턴 봇 응답에 드립 마커 검출되면 이번엔 평이로.
  // 조폭/할미 같이 매번 캐릭터 색깔 박는 페르소나만 적용.
  if (ENFORCE_DRIP_FREQUENCY.has(personaId)) {
    const recentBots = history.slice(1).filter((m) => m.role === 'assistant').slice(-2);
    const dripsInRecent = recentBots.filter((m) => hasDripMarker(m.content, personaId)).length;
    if (recentBots.length >= 2 && dripsInRecent >= 2) {
      hints.push('직전 2턴 봇 응답에 모두 캐릭터 색깔 어휘(드립/시그니처 어휘)가 들어갔다. 이번 응답은 시그니처 어휘 일체 없이 평이한 캐릭터 톤으로만 받아라. 짧고 담백하게.');
    } else if (
      recentBots.length >= 1 &&
      hasDripMarker(recentBots[recentBots.length - 1].content, personaId)
    ) {
      hints.push('직전 응답에 캐릭터 색깔 어휘가 들어갔다. 이번엔 가급적 시그니처 어휘 없이 평이하게 받아라.');
    }
  }

  // 사용자 메시지 분석 — 메타 외마디는 첫 턴이 아닐 때만 적용
  if (!isFirstTurn && isShortMetaUtterance(userMessage)) {
    const example = SHORT_META_EXAMPLES_BY_PERSONA[personaId] || '';
    hints.push(
      `사용자가 짧은 외마디/의문문 던졌음. 직전 자기 응답에 대한 당혹일 가능성. 톤 다운해서 캐릭터로 가볍게 받아쳐라 (예: ${example}).`
    );
  }

  if (isRecommendationRequest(userMessage)) {
    hints.push('사용자가 추천 직접 요구. 짧게 "따로 정리해드릴게" 식으로 받고, 곧장 캐릭터 코미디 한 줄로 받아쳐라. 추가 질문 금지.');
  }

  // 실용 질문 — RLHF 의 helpful assistant 모드 (번호 리스트·매뉴얼) 회귀 차단
  if (isPracticalQuestion(userMessage)) {
    hints.push('사용자가 실용·방법 질문 던졌다. 번호 리스트(1) 2) 3)) / 불릿(- ) / 매뉴얼 작성 절대 X. 캐릭터 톤 그대로, 한 줄짜리 결만 흘려라. 디테일은 사용자가 더 묻기를 기다려라. 컨설턴트화 금지.');
  }

  if (isCasualTone(userMessage) && (userMessage || '').trim().length < 20) {
    hints.push('사용자 톤 가볍거나 일상적. 무겁게 끌고 가지 말고 짧고 빵 터지게.');
  }

  // 응답 카운트로 변주 강화
  if (realBotTurns >= 3) {
    const keel = NEW_KEEL_BY_PERSONA[personaId] || '캐릭터의 새로운 결';
    hints.push(`대화 누적됨. 같은 톤·어휘 반복 X, 캐릭터의 새로운 결(${keel})을 끄집어내라.`);
  }

  return '[이번 턴 가이드 — 반드시 반영]\n' + hints.map((h, i) => `${i + 1}. ${h}`).join('\n');
}

// ─────────────────────────────────────────────────────────────
// 메시지 구성: system + few-shot + history + (hint) + user
// ─────────────────────────────────────────────────────────────

function composeMessages(persona, personaId, history, userMessage, memories = []) {
  const hint = buildDynamicHint(history, userMessage, personaId, memories);

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

  // 메모리 callback — 채팅 응답 latency 에 영향 작도록 짧게 (top 2~3)
  let memories = [];
  if (session.user_id) {
    try {
      memories = await listMemoriesForUser(session.user_id, 3);
    } catch (err) {
      console.error('[chat] 메모리 조회 실패 (무시):', err.message);
    }
  }

  const messages = composeMessages(persona, session.persona_id, history, userMessage, memories);

  // history는 저장용으로 사용자 메시지 추가
  history.push({ role: 'user', content: userMessage });

  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let fullResponse = '';

  // gpt-5 계열은 max_completion_tokens + reasoning_effort 만 받고, temperature/penalty 는 고정값(1, 0).
  // 그 외 모델 (gpt-4o, gpt-4.1 등) 은 기존 max_tokens + temperature/penalty 튜닝 가능.
  const isReasoningChat = /^gpt-5/i.test(LLM_MODEL);
  const completionParams = isReasoningChat
    ? {
        model: LLM_MODEL,
        messages,
        stream: true,
        max_completion_tokens: 450,
        reasoning_effort: 'minimal',
      }
    : {
        model: LLM_MODEL,
        messages,
        stream: true,
        temperature: 0.9,
        max_tokens: 400,
        frequency_penalty: 0.2,
        presence_penalty: 0.2,
      };

  try {
    const stream = await openai.chat.completions.create(completionParams);

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // 히스토리에 응답 추가
    history.push({ role: 'assistant', content: fullResponse });

    // 히스토리 크기 제한
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    // 메시지 카운트 증가 + 5턴 시점 타이틀 자동 생성 (feature/SessionSave)
    const newMessageCount = (session.message_count || 0) + 1;
    const updateData = {
      conversation_history: history,
      message_count: newMessageCount,
    };

    const userMsgCount = history.filter((m) => m.role === 'user').length;
    if (userMsgCount === 5 && !session.title) {
      updateData.title = await generateSessionTitle(history);
    }

    await updateSession(sessionId, updateData);

    res.write(`data: ${JSON.stringify({ done: true, full_response: fullResponse })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}

export { streamChat, buildDynamicHint, composeMessages };