/**
 * Stage 2 — 환경 처방 서비스 래퍼.
 * src/llm/prescriptionGenerator를 호출. user.mbti와 대화 히스토리를 함께 전달.
 */

import { generatePrescription as generatePrescriptionLLM } from '../llm/prescriptionGenerator.js';
import { getSession } from './sessionService.js';
import pool from '../config/db.js';

/**
 * @param {string} sessionId
 * @returns {Promise<Object>} prescriptionGenerator 출력 그대로
 */
export async function generatePrescription(sessionId) {
  const session = await getSession(sessionId);
  if (!session.emotion_scores) {
    const err = new Error('감정 점수가 아직 추출되지 않았습니다.');
    err.status = 400;
    throw err;
  }

  let mbti = null;
  if (session.user_id) {
    const r = await pool.query('SELECT mbti FROM "user" WHERE user_id = $1', [session.user_id]);
    mbti = r.rows[0]?.mbti || null;
  }

  return generatePrescriptionLLM(session.emotion_scores, {
    conversationHistory: session.conversation_history || [],
    mbti: mbti || undefined,
  });
}
