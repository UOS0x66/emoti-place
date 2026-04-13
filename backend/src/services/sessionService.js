const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const PERSONAS = require('../prompts/personas');

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
    `INSERT INTO session (session_id, user_id, persona_id, conversation_history)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, personaId, JSON.stringify(initialHistory)]
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

module.exports = { createSession, getSession, updateSession };
