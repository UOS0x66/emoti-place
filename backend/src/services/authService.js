import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import { signToken } from '../utils/jwt.js';

const SALT_ROUNDS = 10;

async function signup(email, nickname, password, mbti = null) {
  const existing = await pool.query(
    'SELECT user_id FROM "user" WHERE email = $1',
    [email]
  );
  if (existing.rows.length > 0) {
    const err = new Error('이미 등록된 이메일입니다.');
    err.status = 409;
    throw err;
  }

  let normalizedMbti = null;
  if (mbti) {
    const m = String(mbti).toUpperCase().trim();
    if (!/^[EI][SN][TF][JP]$/.test(m)) {
      const err = new Error('MBTI 형식이 올바르지 않습니다 (예: INFJ)');
      err.status = 400;
      throw err;
    }
    normalizedMbti = m;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO "user" (email, nickname, password_hash, mbti)
     VALUES ($1, $2, $3, $4) RETURNING user_id, mbti`,
    [email, nickname, passwordHash, normalizedMbti]
  );

  const userId = result.rows[0].user_id;
  const token = signToken(userId);
  return { user_id: userId, token, nickname, mbti: result.rows[0].mbti };
}

async function login(email, password) {
  const result = await pool.query(
    'SELECT user_id, nickname, password_hash, mbti FROM "user" WHERE email = $1',
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
  return { user_id: user.user_id, token, nickname: user.nickname, mbti: user.mbti };
}

async function updateMbti(userId, mbti) {
  let normalized = null;
  if (mbti !== null && mbti !== undefined && mbti !== '') {
    const m = String(mbti).toUpperCase().trim();
    if (!/^[EI][SN][TF][JP]$/.test(m)) {
      const err = new Error('MBTI 형식이 올바르지 않습니다 (예: INFJ)');
      err.status = 400;
      throw err;
    }
    normalized = m;
  }

  const result = await pool.query(
    `UPDATE "user" SET mbti = $1 WHERE user_id = $2 RETURNING user_id, mbti`,
    [normalized, userId]
  );
  if (result.rows.length === 0) {
    const err = new Error('사용자를 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  return { user_id: result.rows[0].user_id, mbti: result.rows[0].mbti };
}

export { signup, login, updateMbti };
