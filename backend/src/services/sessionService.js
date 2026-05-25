import { v4 as uuidv4 } from 'uuid';
import pool from '../config/db.js';
import PERSONAS from '../prompts/personas.js';
import openai from '../config/openai.js';

async function createSession(userId, personaId) {
  const persona = PERSONAS[personaId];
  if (!persona) {
    const err = new Error('존재하지 않는 페르소나입니다.');
    err.status = 400;
    throw err;
  }

  const sessionId = uuidv4();
  const greeting = persona.greeting;
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
  // 권한 검증을 위해 한 번 조회한 뒤 삭제 — 추천 이력 같은 자식 레코드는
  // recommendation.session_id 가 ON DELETE CASCADE 가 아니라서 먼저 비워준다.
  await getSessionForUser(userId, sessionId);
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

export {
  createSession,
  getSession,
  updateSession,
  listSessionsByUser,
  generateSessionTitle,
  getSessionForUser,
  deleteSessionForUser,
  updateSessionTitleForUser,
};
