const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { signToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

async function signup(email, nickname, password) {
  const existing = await pool.query(
    'SELECT user_id FROM "user" WHERE email = $1',
    [email]
  );
  if (existing.rows.length > 0) {
    const err = new Error('이미 등록된 이메일입니다.');
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO "user" (email, nickname, password_hash)
     VALUES ($1, $2, $3) RETURNING user_id`,
    [email, nickname, passwordHash]
  );

  const userId = result.rows[0].user_id;
  const token = signToken(userId);
  return { user_id: userId, token, nickname };
}

async function login(email, password) {
  const result = await pool.query(
    'SELECT user_id, nickname, password_hash FROM "user" WHERE email = $1',
    [email]
  );
  if (result.rows.length === 0) {
    const err = new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    err.status = 401;
    throw err;
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    const err = new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    err.status = 401;
    throw err;
  }

  const token = signToken(user.user_id);
  return { user_id: user.user_id, token, nickname: user.nickname };
}

module.exports = { signup, login };
