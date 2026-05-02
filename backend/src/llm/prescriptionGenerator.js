/**
 * Stage 2 — 환경/행동 처방 생성 모듈
 *
 * 입력: Plutchik 8감정 점수 + (옵션) 대화 히스토리 + (옵션) MBTI
 * 출력: { prescription_text, psych_rationale, referenced_theories,
 *         category_hint, keywords_must, keywords_avoid, mbti_signals_applied }
 */

import openai from '../config/openai.js';
import { embedTexts } from '../etl/embedders/openaiEmbedder.js';
import {
  queryByEmbedding,
  PSYCH_COLLECTION_NAME,
} from '../etl/loaders/chromaLoader.js';

const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const DEFAULT_RAG_TOP_K = 6;
const DOMINANT_THRESHOLD = 0.3;

const PRESCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    prescription_text: {
      type: 'string',
      description:
        '추천 장소의 분위기·환경·경험을 한국어로 묘사 (100~250자). 그대로 atmosphere_text 인덱스 의미 쿼리로 사용된다.',
    },
    psych_rationale: {
      type: 'string',
      description: '왜 이런 환경이 도움 되는지 한국어 설명 (80~180자).',
    },
    referenced_theories: {
      type: 'array',
      items: { type: 'string' },
      description:
        '이론 키 (plutchik_basic_emotions, gross_emotion_regulation, behavioral_activation, stress_recovery_theory, attention_restoration_theory, comfort_food_belonging)',
    },
    category_hint: {
      type: 'string',
      enum: ['', '12', '14', '28', '39'],
      description:
        '12=관광지, 14=문화시설, 28=레포츠, 39=음식점. 한 카테고리가 명확히 적합할 때만, 아니면 빈 문자열.',
    },
    keywords_must: {
      type: 'array',
      items: { type: 'string' },
      description: 'atmosphere_text에 포함되어야 할 한국어 어간 1~5개.',
    },
    keywords_avoid: {
      type: 'array',
      items: { type: 'string' },
      description: '들어가면 안 좋을 키워드 0~3개.',
    },
    mbti_signals_applied: {
      type: 'array',
      items: { type: 'string' },
      description: 'MBTI 신호 반영 디버그 (없으면 빈 배열).',
    },
  },
  required: [
    'prescription_text',
    'psych_rationale',
    'referenced_theories',
    'category_hint',
    'keywords_must',
    'keywords_avoid',
    'mbti_signals_applied',
  ],
  additionalProperties: false,
};

function formatScoresKr(scores) {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(', ');
}

function dominantEmotions(scores) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const dom = sorted.filter(([, v]) => v >= DOMINANT_THRESHOLD).slice(0, 3);
  if (dom.length === 0) dom.push(sorted[0]);
  return dom.map(([k, v]) => ({ emotion: k, score: v }));
}

async function retrieveRagContext(scores, topK) {
  const dom = dominantEmotions(scores);
  const queryText = `Environments, activities, and psychological strategies that help with ${dom
    .map((d) => `${d.emotion} (${d.score.toFixed(2)})`)
    .join(' and ')}. Restorative environments, social connection, behavioral activation, emotion regulation.`;

  const [emb] = await embedTexts([queryText]);
  const result = await queryByEmbedding(emb, {
    nResults: topK,
    collectionName: PSYCH_COLLECTION_NAME,
  });

  const docs = result.documents?.[0] || [];
  const metas = result.metadatas?.[0] || [];
  if (docs.length === 0) return '(RAG 컨텍스트 없음 — 일반 상식 기반)';

  return docs
    .map((d, i) => `[${metas[i]?.theory || 'unknown'} #${metas[i]?.chunk_idx ?? '?'}]\n${d}`)
    .join('\n\n---\n\n');
}

function buildMbtiGuide(mbti) {
  if (!mbti) {
    return '[사용자 MBTI: 미입력] — MBTI 신호는 무시하고 mbti_signals_applied는 빈 배열로 출력하세요.';
  }
  const m = String(mbti).toUpperCase().trim();
  if (!/^[EI][SN][TF][JP]$/.test(m)) {
    return `[사용자 MBTI: ${mbti} (형식 오류, 무시)] — mbti_signals_applied는 빈 배열로 출력하세요.`;
  }
  const ei = m[0] === 'E'
    ? 'E(외향) — 사람·모임·활기찬 분위기 선호. prescription_text에 친구·동행·북적임을 자연스럽게.'
    : 'I(내향) — 조용·한적·혼자 가능한 공간 선호. 사람 적은 시간대, 차분한 분위기.';
  const sn = m[1] === 'S'
    ? 'S(감각) — 구체적·실용적 경험. 명확한 메뉴/체험형/맛집.'
    : 'N(직관) — 이색·예술·상상력 자극. 미술관·테마 공간·이색 카페.';
  const tf = m[2] === 'T'
    ? 'T(사고) — 정보·기능·효율.'
    : 'F(감정) — 분위기·관계·따뜻함.';
  const jp = m[3] === 'J'
    ? 'J(판단) — 예약 가능·정돈된 동선.'
    : 'P(인식) — 즉흥·다양성·골목 탐험.';
  return `[사용자 MBTI: ${m}]
다음 특성을 처방에 반영하세요. 단 emotionScores와 사용자 발화가 우선이며, MBTI는 톤·장소 형태를 갈라주는 보조 신호입니다.
- ${ei}
- ${sn}
- ${tf}
- ${jp}

반영한 신호를 mbti_signals_applied 배열에 짧게 기록하세요.`;
}

function buildSystemPrompt(ragContext, mbti) {
  return `당신은 심리학 이론에 근거해 사용자 감정 상태에 맞는 환경/경험을 처방하는 전문가입니다.

[입력 세 가지를 모두 고려하세요]
1. Plutchik 8감정 점수
2. 대화 히스토리 — 사용자가 직접 표현한 욕구·활동·음식·동행·장소 선호. **여기 명시된 항목은 반드시 처방에 반영합니다.**
3. MBTI — 평소 정체성 신호.

${buildMbtiGuide(mbti)}

[일곱 필드 출력]
1) prescription_text — 100~250자 한국어 자연어. atmosphere_text 의미 쿼리로 사용됨.
2) psych_rationale — 80~180자 한국어 심리학 근거.
3) referenced_theories — 사용한 이론 키.
4) category_hint — 12/14/28/39 중 하나 또는 "". 확신 있을 때만.
5) keywords_must — 어간 1~5개. 부분 문자열 매칭.
6) keywords_avoid — 0~3개.
7) mbti_signals_applied — MBTI 반영 내역.

prescription_text의 이미지와 category_hint/keywords_must는 **같은 방향**을 가리켜야 합니다.

[참고 심리학 컨텍스트]
${ragContext}

[감정→이론 가이드]
- sadness 강함 → behavioral_activation, comfort_food_belonging
- fear/anger/stress 강함 → stress_recovery_theory
- 정신적 피로 → attention_restoration_theory
- 외로움 → comfort_food_belonging
- 감정 전반 조절 → gross_emotion_regulation`;
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return history
    .map((m) => {
      const who = m.role === 'user' ? '사용자' : m.role === 'assistant' ? '페르소나' : m.role;
      return `${who}: ${m.content}`;
    })
    .join('\n');
}

/**
 * @param {Object} emotionScores
 * @param {Object} [options]
 * @param {Array<{role,content}>} [options.conversationHistory]
 * @param {string} [options.mbti]
 * @returns {Promise<Object>}
 */
export async function generatePrescription(emotionScores, options = {}) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    throw new Error('emotionScores 객체가 필요합니다');
  }

  const ragContext = await retrieveRagContext(
    emotionScores,
    options.ragTopK ?? DEFAULT_RAG_TOP_K
  );
  const dialogStr = formatHistory(options.conversationHistory);

  const userPromptParts = [
    `[Plutchik 8감정 점수]\n${formatScoresKr(emotionScores)}`,
  ];
  if (dialogStr) {
    userPromptParts.push(
      `[대화 히스토리 — 사용자 직접 발화의 욕구·선호를 우선 반영하세요]\n${dialogStr}`
    );
  }
  userPromptParts.push(
    `위 입력에 맞는 환경/경험 처방을 JSON으로 출력하세요. 사용자가 명시한 활동/음식/동행은 반드시 prescription_text/category_hint/keywords_must에 반영하세요.`
  );

  const res = await openai.chat.completions.create({
    model: options.model || DEFAULT_MODEL,
    temperature: options.temperature ?? 0.6,
    messages: [
      { role: 'system', content: buildSystemPrompt(ragContext, options.mbti) },
      { role: 'user', content: userPromptParts.join('\n\n') },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'prescription', schema: PRESCRIPTION_SCHEMA, strict: true },
    },
  });

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('LLM 응답이 비어있습니다');
  return JSON.parse(raw);
}
