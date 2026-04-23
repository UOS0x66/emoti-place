const openai = require('../config/openai');
const chroma = require('../config/chroma');
const { buildEnvNeedPrompt } = require('../prompts/envNeed');

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 감정 스코어를 기반으로 심리학 RAG 검색 후 환경 니즈를 도출한다.
 * Stage 2: 환경 니즈 도출 (UC-03.5)
 *
 * 출력 스키마:
 *   {
 *     environment_query: string,   // 벡터 검색용 자연어 쿼리
 *     psych_rationale: string,     // 사용자 노출용 심리학적 근거
 *     applied_theories: string[],  // 적용된 이론 코드 목록
 *   }
 */
async function generatePrescription(emotionScores) {
  // 지배적 감정 추출 (상위 3개, 0.1 초과)
  const emotionKeys = [
    'joy',
    'trust',
    'fear',
    'surprise',
    'sadness',
    'disgust',
    'anger',
    'anticipation',
  ];
  const sorted = emotionKeys
    .map((key) => ({ key, value: emotionScores[key] || 0 }))
    .sort((a, b) => b.value - a.value);
  const dominant = sorted.slice(0, 3).filter((e) => e.value > 0.1);

  // 심리학 문헌 RAG 검색 (psych_embeddings)
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
    console.warn('[EnvNeed] Chroma 연결 실패, RAG 없이 환경 니즈 도출');
  }

  // LLM으로 환경 니즈 도출
  const messages = buildEnvNeedPrompt(emotionScores, psychReferences);

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(content);

  // 하위 호환: recommendService가 prescription_text를 참조하는 구간에 대비
  return {
    environment_query: parsed.environment_query,
    psych_rationale: parsed.psych_rationale,
    applied_theories: parsed.applied_theories || [],
    // @deprecated: 리팩터 이전 필드명. 신규 코드는 environment_query 사용.
    prescription_text: parsed.environment_query,
  };
}

module.exports = { generatePrescription };
