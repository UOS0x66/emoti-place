const openai = require('../config/openai');
const chroma = require('../config/chroma');
const { buildPrescriptionPrompt } = require('../prompts/prescription');

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 감정 스코어를 기반으로 심리학 RAG 검색 후 경험 처방을 생성한다.
 * Stage 2: 감정 관리 이론 RAG AI
 */
async function generatePrescription(emotionScores) {
  // 지배적 감정 추출 (상위 2~3개)
  const emotionKeys = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation'];
  const sorted = emotionKeys
    .map((key) => ({ key, value: emotionScores[key] || 0 }))
    .sort((a, b) => b.value - a.value);
  const dominant = sorted.slice(0, 3).filter((e) => e.value > 0.1);

  // 심리학 문헌 RAG 검색
  let psychReferences = [];
  try {
    const collection = await chroma.getCollection({ name: 'psych_embeddings' });
    const queryText = dominant.map((e) => `${e.key}: ${e.value}`).join(', ');

    const results = await collection.query({
      queryTexts: [queryText],
      nResults: 3,
    });

    if (results.documents && results.documents[0]) {
      psychReferences = results.documents[0];
    }
  } catch {
    // Chroma 미연결 시 RAG 없이 진행
    console.warn('[Prescription] Chroma 연결 실패, RAG 없이 처방 생성');
  }

  // LLM으로 경험 처방 생성
  const messages = buildPrescriptionPrompt(emotionScores, psychReferences);

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  return JSON.parse(content);
}

module.exports = { generatePrescription };
