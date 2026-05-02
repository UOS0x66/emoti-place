/**
 * Stage 1 — 감정 추출 서비스 래퍼.
 * src/llm/emotionExtractor를 호출해 8감정 점수를 추출하고 세션에 저장한다.
 */

import { extractEmotionScores } from '../llm/emotionExtractor.js';
import { getSession, updateSession } from './sessionService.js';

/**
 * 세션의 대화 히스토리에서 감정을 추출하고 저장한다.
 * @param {string} sessionId
 * @returns {Promise<Object>} Plutchik 8감정 점수
 */
export async function extractEmotions(sessionId) {
  const session = await getSession(sessionId);
  const history = session.conversation_history || [];
  if (history.length === 0) {
    const err = new Error('대화 히스토리가 비어 있습니다.');
    err.status = 400;
    throw err;
  }

  const scores = await extractEmotionScores(history);
  await updateSession(sessionId, { emotion_scores: scores });
  return scores;
}

/**
 * 세션에 저장된 감정 스코어 조회. 없으면 새로 추출.
 */
export async function getEmotions(sessionId) {
  const session = await getSession(sessionId);
  if (session.emotion_scores) return session.emotion_scores;
  return extractEmotions(sessionId);
}
