const openai = require('../config/openai');
const { getSession, updateSession } = require('./sessionService');
const { buildEmotionPrompt } = require('../prompts/emotionExtract');

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 대화 히스토리에서 Plutchik 8감정 스코어를 추출하고 세션에 저장한다.
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

  // 세션에 감정 스코어 저장
  await updateSession(sessionId, {
    emotion_scores: emotionScores,
    energy_level: emotionScores.energy || 'medium',
    companion: emotionScores.companion || 'alone',
    activity_preference: emotionScores.activity_preference || 'passive',
    time_preference: emotionScores.time_preference || 'any',
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
