import { v4 as uuidv4 } from 'uuid';
import pool from '../config/db.js';
import PERSONAS from '../prompts/personas.js';
import openai from '../config/openai.js';
import { haversineKm } from '../utils/geo.js';
import {
  processUnprocessedSessionsForUser,
  listMemoriesForUser,
} from './memoryService.js';

/**
 * 사용자에게 다시 인사할 때, 최근 메모리를 자연스럽게 callback 하는 그리팅을 생성.
 * 메모리 없으면 기본 그리팅 그대로 반환.
 *
 * 모델·system_prompt 는 채팅과 동일하게 — 페르소나 [STYLE]/[VOICE_POOL]/[GUARDRAILS]/[BEHAVIOR]
 * 규칙이 그대로 적용되어야 그리팅도 캐릭터에 맞는 톤이 나온다.
 */
async function generateGreetingWithMemory(personaId, defaultGreeting, memories) {
  if (!Array.isArray(memories) || memories.length === 0) return defaultGreeting;

  const persona = PERSONAS[personaId];
  const memoryText = memories
    .slice(0, 2)
    .map((m, i) => `${i + 1}. (${m.type}, 중요도 ${m.importance}) ${m.content}`)
    .join('\n');

  const taskPrompt = `[이번 응답은 사용자와 다시 만난 첫 인사(그리팅) 입니다.]

[기본 그리팅 (스타일·말투 참고)]
"${defaultGreeting}"

[사용자 메모리 — 이전 만남에서 알게 된 것]
${memoryText}

[그리팅 작성 규칙]
- 1~2문장, 80자 이내.
- 위 메모리 중 가장 강한 한 가지만 캐릭터 톤으로 자연스럽게 callback (그때 ~ 어떻게 됐어? / 아까 그 ~ 또? 같은 결).
- 메모리 두 개 동시에 박지 마라.
- 메모리가 어색하면 그냥 기본 그리팅 톤으로.
- **위 시스템 프롬프트의 [STYLE] / [VOICE_POOL] / 금지 어미 규칙을 절대 어기지 마라.**

그리팅 한 줄(또는 2문장) 만 출력. 다른 설명·따옴표 X.`;

  const model = process.env.CHAT_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';
  const isGpt51 = /^gpt-5\.1/i.test(model);
  const isGpt5 = /^gpt-5/i.test(model);

  const baseMessages = [
    { role: 'system', content: persona.system_prompt },
    { role: 'user', content: taskPrompt },
  ];
  let params;
  if (isGpt51) {
    params = {
      model,
      messages: baseMessages,
      max_completion_tokens: 250,
      reasoning_effort: 'none',
      temperature: 0.7,
    };
  } else if (isGpt5) {
    params = {
      model,
      messages: baseMessages,
      max_completion_tokens: 250,
      reasoning_effort: 'minimal',
    };
  } else {
    params = {
      model,
      temperature: 0.7,
      max_tokens: 150,
      messages: baseMessages,
    };
  }

  try {
    const res = await openai.chat.completions.create(params);
    const out = res.choices[0]?.message?.content?.trim();
    return out && out.length > 0 ? out : defaultGreeting;
  } catch (err) {
    console.error('[session] 메모리 그리팅 생성 실패:', err.message);
    return defaultGreeting;
  }
}

async function createSession(userId, personaId) {
  const persona = PERSONAS[personaId];
  if (!persona) {
    const err = new Error('존재하지 않는 페르소나입니다.');
    err.status = 400;
    throw err;
  }

  // (1) 미처리 세션이 있으면 메모리 lazy 추출
  if (userId) {
    try {
      await processUnprocessedSessionsForUser(userId);
    } catch (err) {
      console.error('[session] 메모리 추출 단계 실패 (무시):', err.message);
    }
  }

  // (2) 메모리 기반 그리팅 생성. 메모리 없거나 실패 시 기본 그리팅.
  let greeting = persona.greeting;
  if (userId) {
    try {
      const memories = await listMemoriesForUser(userId, 3);
      if (memories.length > 0) {
        greeting = await generateGreetingWithMemory(personaId, persona.greeting, memories);
      }
    } catch (err) {
      console.error('[session] 그리팅 메모리 조회 실패 (기본 사용):', err.message);
    }
  }

  const sessionId = uuidv4();
  const initialHistory = [{ role: 'assistant', content: greeting }];

  await pool.query(
    `INSERT INTO session (session_id, user_id, persona_id, conversation_history, message_count)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, userId, personaId, JSON.stringify(initialHistory), 0]
  );

  return { session_id: sessionId, greeting_message: greeting };
}

async function getSession(sessionId) {
  const result = await pool.query(
    'SELECT * FROM session WHERE session_id = $1',
    [sessionId]
  );
  if (result.rows.length === 0) {
    const err = new Error('세션을 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  return result.rows[0];
}

async function updateSession(sessionId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${idx}`);
    values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    idx++;
  }
  values.push(sessionId);

  await pool.query(
    `UPDATE session SET ${fields.join(', ')} WHERE session_id = $${idx}`,
    values
  );
}

async function listSessionsByUser(userId) {
  const result = await pool.query(
    `SELECT session_id, persona_id, title, created_at, expires_at, message_count
     FROM session
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// 세션 상세(대화 히스토리 포함). 본인 소유인지 검증한다.
async function getSessionForUser(userId, sessionId) {
  const result = await pool.query(
    `SELECT session_id, user_id, persona_id, title, conversation_history,
            message_count, created_at, expires_at
       FROM session
      WHERE session_id = $1`,
    [sessionId]
  );
  if (result.rows.length === 0) {
    const err = new Error('세션을 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  const row = result.rows[0];
  if (row.user_id !== userId) {
    const err = new Error('접근 권한이 없습니다.');
    err.status = 403;
    throw err;
  }
  return row;
}

async function deleteSessionForUser(userId, sessionId) {
  // 권한 검증을 위해 한 번 조회한 뒤 삭제.
  // 세션을 지우면 그 세션에서 파생된 메모리·추천도 같이 사라져야 한다 (사용자 의도).
  // FK 가 CASCADE 이지만 명시적으로 지워 의도를 코드에 남긴다.
  await getSessionForUser(userId, sessionId);
  await pool.query('DELETE FROM user_memory WHERE source_session_id = $1', [sessionId]);
  await pool.query('DELETE FROM recommendation WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM session WHERE session_id = $1', [sessionId]);
}

async function updateSessionTitleForUser(userId, sessionId, title) {
  const trimmed = (title || '').trim();
  if (!trimmed) {
    const err = new Error('제목은 비어 있을 수 없습니다.');
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 100) {
    const err = new Error('제목은 100자 이하여야 합니다.');
    err.status = 400;
    throw err;
  }
  await getSessionForUser(userId, sessionId);
  await pool.query(
    'UPDATE session SET title = $1 WHERE session_id = $2',
    [trimmed, sessionId]
  );
  return trimmed;
}

async function generateSessionTitle(conversationHistory) {
  const userMessages = conversationHistory
    .filter(m => m.role === 'user')
    .slice(0, 3);

  if (userMessages.length === 0) return '(제목 없음)';

  const context = userMessages.map(m => m.content).join(' | ');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '사용자의 대화를 보고 5단어 이내의 간단한 한국어 제목을 생성하세요. 제목만 반환하세요.',
        },
        { role: 'user', content: context },
      ],
      max_tokens: 20,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() || '(제목 없음)';
  } catch (err) {
    console.error('타이틀 생성 실패:', err.message);
    return '(제목 없음)';
  }
}

/**
 * 세션 resume 시 추천 카드를 복원하기 위한 조회.
 * recommendation 테이블의 가장 최근 배치(=같은 추천 호출에서 나온 5장)만 반환한다.
 * 같은 created_at 가 정확히 일치하지 않을 수 있어 ±5초 윈도우로 묶는다.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {number|null} userLat - 사용자 현재 위도 (없으면 distance_km = null)
 * @param {number|null} userLng - 사용자 현재 경도
 */
async function listLatestRecommendationsForSession(userId, sessionId, userLat, userLng) {
  await getSessionForUser(userId, sessionId);

  const latest = await pool.query(
    'SELECT MAX(created_at) AS t FROM recommendation WHERE session_id = $1',
    [sessionId]
  );
  if (!latest.rows[0] || latest.rows[0].t == null) return [];

  // 같은 배치 (보통 같은 ms) 가 보장 안 될 수 있어 5초 윈도우로 묶는다.
  const cutoff = new Date(new Date(latest.rows[0].t).getTime() - 5000);

  const result = await pool.query(
    `SELECT r.place_id, r.semantic_similarity, r.persona_reason, r.psych_rationale, r.created_at,
            p.tour_content_id, p.name, p.category, p.address, p.lat, p.lng,
            p.photos, p.atmosphere_text, p.summary_text, p.operating_hours,
            p.max_group_size, p.is_outdoor
       FROM recommendation r
       JOIN place p ON p.place_id = r.place_id
      WHERE r.session_id = $1
        AND r.created_at >= $2
      ORDER BY r.created_at, r.rec_id`,
    [sessionId, cutoff]
  );

  const hasLoc =
    typeof userLat === 'number' &&
    typeof userLng === 'number' &&
    Number.isFinite(userLat) &&
    Number.isFinite(userLng);

  return result.rows.map((row) => ({
    place_id: row.place_id,
    tour_content_id: row.tour_content_id,
    name: row.name,
    category: row.category,
    address: row.address,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    photo: Array.isArray(row.photos) && row.photos.length > 0 ? row.photos[0] : null,
    distance_km:
      hasLoc && row.lat != null && row.lng != null
        ? Math.round(haversineKm(userLat, userLng, Number(row.lat), Number(row.lng)) * 100) / 100
        : null,
    atmosphere_text: row.atmosphere_text,
    summary_text: row.summary_text,
    operating_hours: row.operating_hours,
    max_group_size: row.max_group_size,
    is_outdoor: row.is_outdoor,
    reason: row.persona_reason,
    psych_rationale: row.psych_rationale,
    similarity: row.semantic_similarity,
  }));
}

export {
  createSession,
  getSession,
  updateSession,
  listSessionsByUser,
  generateSessionTitle,
  getSessionForUser,
  deleteSessionForUser,
  updateSessionTitleForUser,
  listLatestRecommendationsForSession,
};
