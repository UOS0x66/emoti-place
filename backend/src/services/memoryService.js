/**
 * 사용자 메모리 — 다음 세션에 페르소나가 callback 할 정보 (이름·취향·자주 거론 토픽 등).
 *
 * 흐름:
 *   1. 새 세션 생성 시 → 사용자의 미처리 (memories_extracted=false) 세션이 있으면
 *      그 conversation_history 를 분석해 memories 추출 → user_memory 에 저장 → 세션 표시.
 *   2. 그리팅·DYNAMIC HINT 에서 listMemoriesForUser() 로 top-N 가져와 LLM 컨텍스트에 주입.
 *
 * 추출 모델: gpt-4o-mini (schema-bound JSON).
 */

import pool from '../config/db.js';
import openai from '../config/openai.js';

const EXTRACT_MODEL = process.env.MEMORY_EXTRACT_MODEL || 'gpt-4o-mini';
const MIN_HISTORY_LEN = 4; // 4 메시지 이하인 세션은 추출 가치 낮음
const MAX_MEMORIES_PER_USER = 30; // 사용자당 너무 많이 쌓이면 가지치기 필요

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['fact', 'topic', 'event', 'preference'] },
          content: {
            type: 'string',
            description:
              '한 문장 (50자 이내). "[사용자]는 ~" 형식. 페르소나 1인칭 callback 용. 예: "[사용자]는 회사에서 상사 부조리 때문에 답답해함."',
          },
          importance: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['type', 'content', 'importance'],
        additionalProperties: false,
      },
    },
  },
  required: ['memories'],
  additionalProperties: false,
};

const EXTRACTION_SYSTEM_PROMPT = `당신은 대화에서 페르소나가 다음 만남에 기억하면 좋을 정보를 추출하는 전문가입니다.

[추출 기준]
- fact: 사용자 신상 (직업, 이름, 가족, 친구, 거주지 등)
- topic: 사용자가 자주 거론하는 주제·인물·장소
- event: 인상적 사건 (다툼, 진로 고민, 기쁜 일 등)
- preference: 좋아하는 활동·싫어하는 것·취향

[중요도 (importance)]
- 5: 핵심 사실 (이름, 직업, 큰 사건)
- 3~4: 도움 되는 컨텍스트
- 1~2: 부수적 정보

[규칙]
- 페르소나가 1인칭으로 callback 할 수 있게 자연스러운 문장으로 작성.
- "사용자가 ~ 라고 했다" X. "[사용자]는 ~" 형식 O.
- 한 항목당 한 문장, 50자 이내.
- **5개까지만** 추출. 의미 있는 것만. 추출할 게 별로 없으면 빈 배열 OK.
- 페르소나 발화는 분석 대상 X. 사용자 메시지만 의미 있게 추출.`;

function formatHistoryForExtraction(history) {
  return history
    .filter((m) => m && m.role && m.content)
    .map((m) => `${m.role === 'user' ? '사용자' : '페르소나'}: ${m.content}`)
    .join('\n');
}

/**
 * 대화 히스토리에서 메모리 항목들을 추출한다.
 * @param {Array<{role,content}>} history
 * @returns {Promise<Array<{type, content, importance}>>}
 */
export async function extractMemoriesFromHistory(history) {
  if (!Array.isArray(history) || history.length < MIN_HISTORY_LEN) return [];

  const dialogText = formatHistoryForExtraction(history);
  if (!dialogText.trim()) return [];

  try {
    const res = await openai.chat.completions.create({
      model: EXTRACT_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `[대화 히스토리]\n${dialogText}\n\n위 대화에서 의미 있는 메모리를 JSON 으로 추출하라.`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'memory_extraction', schema: EXTRACTION_SCHEMA, strict: true },
      },
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.memories) ? parsed.memories.slice(0, 5) : [];
  } catch (err) {
    console.error('[memory] 추출 실패:', err.message);
    return [];
  }
}

/**
 * 메모리 항목들을 user_memory 테이블에 저장한다.
 */
export async function saveMemories(userId, memories, sourceSessionId) {
  if (!Array.isArray(memories) || memories.length === 0) return 0;
  let inserted = 0;
  for (const m of memories) {
    if (!m.content || !m.type) continue;
    try {
      await pool.query(
        `INSERT INTO user_memory (user_id, memory_type, content, importance, source_session_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, m.type, m.content, m.importance ?? 3, sourceSessionId || null]
      );
      inserted += 1;
    } catch (err) {
      console.error('[memory] 저장 실패:', err.message);
    }
  }

  // 너무 많이 쌓이면 importance 낮고 오래된 것부터 가지치기
  try {
    await pool.query(
      `DELETE FROM user_memory
        WHERE user_id = $1
          AND memory_id NOT IN (
            SELECT memory_id FROM user_memory
             WHERE user_id = $1
             ORDER BY importance DESC, last_used_at DESC, created_at DESC
             LIMIT $2
          )`,
      [userId, MAX_MEMORIES_PER_USER]
    );
  } catch (err) {
    // 가지치기 실패는 무시
  }
  return inserted;
}

/**
 * 미처리 세션 (memories_extracted=false 이고 충분한 길이) 들을 찾아 메모리 추출 후
 * 처리 완료 표시.
 * @returns {Promise<number>} 처리된 세션 수
 */
export async function processUnprocessedSessionsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT session_id, conversation_history
       FROM session
      WHERE user_id = $1
        AND COALESCE(memories_extracted, false) = false
      ORDER BY created_at DESC
      LIMIT 3`,
    [userId]
  );

  let processed = 0;
  for (const row of rows) {
    const history = row.conversation_history || [];
    // 그리팅 1개 + 실 대화 < 4 면 추출 가치 낮음. 그래도 마크 처리해서 매번 다시 시도 안 함.
    if (history.length >= MIN_HISTORY_LEN) {
      const memories = await extractMemoriesFromHistory(history);
      if (memories.length > 0) {
        await saveMemories(userId, memories, row.session_id);
      }
    }
    await pool.query(
      'UPDATE session SET memories_extracted = true WHERE session_id = $1',
      [row.session_id]
    );
    processed += 1;
  }
  return processed;
}

/**
 * 사용자의 상위 N개 메모리를 가져온다 (importance + 최근성 기준).
 * @param {string} userId
 * @param {number} maxN
 * @returns {Promise<Array<{memory_id, type, content, importance, created_at}>>}
 */
export async function listMemoriesForUser(userId, maxN = 5) {
  if (!userId) return [];
  const { rows } = await pool.query(
    `SELECT memory_id, memory_type AS type, content, importance, created_at
       FROM user_memory
      WHERE user_id = $1
      ORDER BY importance DESC, last_used_at DESC, created_at DESC
      LIMIT $2`,
    [userId, maxN]
  );
  return rows;
}

/**
 * 메모리들이 "사용" 되었음을 표시 (last_used_at 갱신).
 * 우선순위 정렬에서 최신성 신호로 활용.
 */
export async function touchMemories(memoryIds) {
  if (!Array.isArray(memoryIds) || memoryIds.length === 0) return;
  await pool.query(
    `UPDATE user_memory SET last_used_at = NOW() WHERE memory_id = ANY($1::int[])`,
    [memoryIds]
  );
}
