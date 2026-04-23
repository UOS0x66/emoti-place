const openai = require('../config/openai');
const { getSession, updateSession } = require('./sessionService');
const { buildEmotionPrompt } = require('../prompts/emotionExtract');

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 대화 히스토리에서 Plutchik 8감정 스코어를 추출하고 세션에 저장한다.
 *
 * 설계서 라벨 규약:
 * - energy_level: "LOW" | "MEDIUM" | "HIGH"
 * - companion: "ALONE" | "TWO" | "GROUP"
 * - activity_preference: "STATIC" | "ACTIVE"
 * - time_preference: "DAY" | "NIGHT" | "NONE"
 */
async function extractEmotions(sessionId) {
  const session = await getSession(sessionId);
  const history = session.conversation_history || [];

  if (history.length === 0) {
    const err = new Error('대화 히스토리가 비어 있습니다.');
    err.status = 400;
    throw err;
  }

  const messages = buildEmotionPrompt(history);

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  const emotionScores = JSON.parse(content);

  // 세션에 감정 스코어 저장 (설계서 라벨 규약 그대로)
  await updateSession(sessionId, {
    emotion_scores: emotionScores,
    energy_level: emotionScores.energy_level || 'MEDIUM',
    companion: emotionScores.companion || 'ALONE',
    activity_preference: emotionScores.activity_preference || 'STATIC',
    time_preference: emotionScores.time_preference || 'NONE',
  });

  return emotionScores;
}

/**
 * 세션에 저장된 감정 스코어를 조회한다. 없으면 새로 추출한다.
 */
async function getEmotions(sessionId) {
  const session = await getSession(sessionId);

  if (session.emotion_scores) {
    return session.emotion_scores;
  }

  return extractEmotions(sessionId);
}

module.exports = { extractEmotions, getEmotions };
