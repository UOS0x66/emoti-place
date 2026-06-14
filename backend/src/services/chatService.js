import openai from '../config/openai.js';
import PERSONAS from '../prompts/personas.js';
import { getSession, updateSession, generateSessionTitle } from './sessionService.js';
import { listMemoriesForUser } from './memoryService.js';
import { detectEdgeCase, getEdgeCaseHint } from '../prompts/edgeCases.js';
import { validateResponse } from './responseValidator.js';

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

// ─────────────────────────────────────────────────────────────
// 현재 상태 추론 — examples 의 [감정/관계/최근사건] schema 와 일치
//
// 휴리스틱 기반 (인라인 LLM 호출 X, latency 0).
// 향후 emotion extractor 가 도입되면 emotion 만 교체하면 됨.
// ─────────────────────────────────────────────────────────────

function inferEmotion(userMessage) {
  const t = (userMessage || '').trim();
  if (!t) return null;
  if (/우울|힘들|죽고|울|외로|쓸쓸|허무|공허/.test(t)) return '슬픔/위로 필요';
  if (/짜증|빡|화|뒤집|미치|진절머리|열받|성질/.test(t)) return '분노/불만';
  if (/와|대박|신난|짱|럭|성공|기쁘|행복|좋다|좋아/.test(t)) return '기쁨/환희';
  if (/피곤|지쳤|녹초|뻗|졸려|기진|탈진/.test(t)) return '피곤/무기력';
  if (/막막|모르겠|어찌|한숨|답답|어떡|망함/.test(t)) return '막막함/혼란';
  if (/긴장|떨려|불안|걱정|초조/.test(t)) return '불안/초조';
  if (/그립|보고싶|아쉽|허전/.test(t)) return '그리움/씁쓸함';
  return '평이/일상';
}

function inferRelation(history, hasMemories) {
  const realBotTurns = history.filter((m, i) => m.role === 'assistant' && i > 0).length;
  if (realBotTurns === 0) return hasMemories ? '오랜만에 다시 보는 사이' : '첫 만남';
  if (realBotTurns < 5) return hasMemories ? '구면 — 익숙해지는 중' : '인사 트는 중';
  if (realBotTurns < 15) return '친밀해진 사이';
  return '오랜 시간 함께한 사이';
}

/**
 * memory 가 현재 사용자 메시지와 주제 관련 있는지 휴리스틱 판단.
 * memory.content 에서 한글 명사 후보를 뽑고 3자 substring (또는 2자 통단어) 단위로
 * userMessage 에 매치되면 true. 조사 ("~과/~이야/~을") 영향 회피용.
 * 무관 주제로 LLM 이 옛 memory 를 드립 fodder 로 끌어오는 회귀 차단.
 */
function isMemoryRelevant(memory, userMessage) {
  if (!memory || !userMessage) return false;
  const content = memory.content || '';
  const memWords = content.match(/[가-힣]{2,}/g) || [];
  for (const mw of memWords) {
    if (mw.length === 2) {
      if (userMessage.includes(mw)) return true;
      continue;
    }
    // 3자+ → 3자 sliding window substring 매치 (조사 끼어도 핵심 명사 잡음)
    for (let i = 0; i <= mw.length - 3; i++) {
      if (userMessage.includes(mw.slice(i, i + 3))) return true;
    }
  }
  return false;
}

function inferRecentEvent(memories, userMessage) {
  if (!Array.isArray(memories) || memories.length === 0) return null;
  // 현재 사용자 메시지와 주제 매치되는 memory 만 박는다 — 무관 주제에 끌려가지 않게.
  const relevant = memories.find((m) => isMemoryRelevant(m, userMessage));
  return relevant?.content || null;
}

function buildStateBlock(history, userMessage, memories) {
  const emotion = inferEmotion(userMessage);
  const relation = inferRelation(history, memories.length > 0);
  const recent = inferRecentEvent(memories, userMessage);

  const lines = ['[현재 상태 — 이번 응답 톤 결정에 반영]'];
  if (emotion) lines.push(`감정: ${emotion}`);
  if (relation) lines.push(`관계: ${relation}`);
  if (recent) lines.push(`최근 사건: ${recent}`);
  lines.push('→ EXAMPLES 의 같은/비슷한 상태 응답을 참고 (베끼지 말고 변주).');
  return lines.join('\n');
}

function buildDynamicHint(history, userMessage, personaId, memories = [], opts = {}) {
  const hints = [];

  // 자동 추천 트리거 턴 — bot 응답에 사용자 메시지 답변 + 추천 안내 한 줄을
  // 한 호흡으로 자연스럽게 박게 한다. (직후 프론트가 카드 emit)
  if (opts.autoRecommend) {
    hints.push(
      '이번 응답이 자동 장소 추천 트리거 턴이다. 사용자 메시지 답변을 짧게 마무리한 뒤, "~한 데 몇 곳 추려보겠습니다 / 봐둔 데 몇 군데 있습니다" 류 자연스러운 한 줄을 끝에 박아라. 별도 답변 + 별도 안내로 두 문단 나누지 말고 한 호흡으로 묶어 출력. 캐릭터 톤·길이·금지 어미 규칙 그대로.'
    );
  }

  // 엣지 케이스 — 패턴 매치 시 강한 우선 hint (다른 가이드보다 위에 박는다)
  const edgeCase = detectEdgeCase(userMessage, history);
  if (edgeCase) {
    const edgeHint = getEdgeCaseHint(edgeCase, personaId);
    if (edgeHint) hints.push(edgeHint);
  }

  // 메모리 callback — 이전 만남에서 알게 된 사용자 컨텍스트
  // **주제 관련성 매치된 memory 만** 박는다. 무관 주제 끌어다 드립 fodder 로 쓰는 회귀 방지.
  if (Array.isArray(memories) && memories.length > 0) {
    const relevantMems = memories.filter((m) => isMemoryRelevant(m, userMessage)).slice(0, 2);
    if (relevantMems.length > 0) {
      const memSection = relevantMems.map((m) => `- ${m.content}`).join('\n');
      hints.push(
        `[사용자 컨텍스트 — 현재 주제와 관련된 이전 만남 기억]\n${memSection}\n사용자 메시지 흐름이 자연스러우면 캐릭터 톤으로 한 마디 callback (예: "아까 그놈 또 그러던가요?"). 매 응답마다 박지 마라. 어색하면 그냥 무시.`
      );
    }
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

function composeMessages(persona, personaId, history, userMessage, memories = [], opts = {}) {
  const hint = buildDynamicHint(history, userMessage, personaId, memories, opts);
  const stateBlock = buildStateBlock(history, userMessage, memories);

  const messages = [
    { role: 'system', content: persona.system_prompt },
    // state block — examples 의 schema 와 일치, EXAMPLES 와 짝 맞춰 톤 선택 유도
    { role: 'system', content: stateBlock },
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

// gpt-5.1: reasoning_effort='none' + temperature 자유 (gpt-5 에서 잃었던 레버 부활)
// gpt-5:   reasoning_effort='minimal' + temperature=1 고정
// 그 외:   max_tokens + temperature/penalty 튜닝
function buildChatCompletionParams(messages, model) {
  const isGpt51 = /^gpt-5\.1/i.test(model);
  const isGpt5 = /^gpt-5/i.test(model);
  if (isGpt51) {
    return {
      model,
      messages,
      max_completion_tokens: 450,
      reasoning_effort: 'none',
      temperature: 0.7,
    };
  }
  if (isGpt5) {
    return {
      model,
      messages,
      max_completion_tokens: 450,
      reasoning_effort: 'minimal',
    };
  }
  return {
    model,
    messages,
    temperature: 0.9,
    max_tokens: 400,
    frequency_penalty: 0.2,
    presence_penalty: 0.2,
  };
}

const MAX_VALIDATION_ATTEMPTS = 2;
const CLIENT_CHUNK_SIZE = 50; // 60자씩 끊어 보내 streaming 흉내 (UX 살짝)

/**
 * 페르소나 대화 응답 생성. SSE 로 client 에 emit.
 *
 * 흐름:
 *   1. 응답 생성 (full, non-stream)
 *   2. (D) regex + (A) inline judge 검증
 *   3. fail 이면 1회 재생성, 그래도 fail 이면 그대로 emit (사용자 무한 대기 X)
 *   4. final 텍스트를 chunk 단위로 SSE token 으로 보냄
 */
async function streamChat(sessionId, userMessage, res, opts = {}) {
  const { autoRecommend = false } = opts;
  const session = await getSession(sessionId);
  const persona = PERSONAS[session.persona_id];

  let history = session.conversation_history || [];

  // 메모리 callback — top 2~3 (latency 영향 작게)
  let memories = [];
  if (session.user_id) {
    try {
      memories = await listMemoriesForUser(session.user_id, 3);
    } catch (err) {
      console.error('[chat] 메모리 조회 실패 (무시):', err.message);
    }
  }

  const messages = composeMessages(
    persona,
    session.persona_id,
    history,
    userMessage,
    memories,
    { autoRecommend }
  );
  history.push({ role: 'user', content: userMessage });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const completionParams = buildChatCompletionParams(messages, LLM_MODEL);

  let fullResponse = '';

  try {
    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
      const r = await openai.chat.completions.create(completionParams);
      const text = r.choices[0]?.message?.content?.trim() || '';

      const validation = await validateResponse({
        text,
        personaId: session.persona_id,
        userMessage,
      });

      if (validation.pass) {
        fullResponse = text;
        if (attempt > 1) console.log(`[chat] validation pass on retry (attempt ${attempt})`);
        break;
      }

      console.log(
        `[chat] validation fail (attempt ${attempt}, ${validation.source}): ${validation.reason}`
      );

      if (attempt === MAX_VALIDATION_ATTEMPTS) {
        // 마지막 시도까지 fail — 그대로 emit (사용자 대기 시간 늘리지 않음).
        fullResponse = text;
      }
    }

    // chunk 단위 SSE emit — client 의 token-by-token UI 와 호환
    for (let i = 0; i < fullResponse.length; i += CLIENT_CHUNK_SIZE) {
      const chunk = fullResponse.slice(i, i + CLIENT_CHUNK_SIZE);
      res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
    }

    history.push({ role: 'assistant', content: fullResponse });
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

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