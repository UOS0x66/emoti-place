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

// 긍정 정서가 우세하면 RAG 쿼리에 회복 이론(SRT/ART/BA) 어휘를 넣지 않는다.
// 그렇지 않으면 joy/anticipation 케이스에도 stress_recovery 청크가 빨려들어와
// LLM이 referenced_theories 에 SRT/ART 를 잘못 넣게 된다.
function isPositiveDominant(scores) {
  const pos = (scores.joy || 0) + (scores.anticipation || 0) + (scores.trust || 0);
  const neg =
    (scores.sadness || 0) + (scores.fear || 0) + (scores.anger || 0) + (scores.disgust || 0);
  return pos >= 0.5 && pos > neg;
}

async function retrieveRagContext(scores, topK) {
  const dom = dominantEmotions(scores);
  const domStr = dom.map((d) => `${d.emotion} (${d.score.toFixed(2)})`).join(' and ');
  const queryText = isPositiveDominant(scores)
    ? `Environments, activities, and psychological strategies that help SAVOR and SHARE positive feelings of ${domStr}. Savoring, capitalization, positive event sharing, social connection, celebratory and lively environments.`
    : `Environments, activities, and psychological strategies that help with ${domStr}. Restorative environments, social connection, behavioral activation, emotion regulation.`;

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

[중요: 카테고리 다양성 / 카페 편향 회피]
- prescription_text에 "카페", "식당", "음식점", "주점" 같은 카테고리 명사를 **직접 호명하지 마세요.**
  대신 그 환경의 속성(조용함·자연광·고즈넉함·소담한 분위기·열린 시야·나무 향·잔잔한 음악 등)으로 묘사하세요.
- "쉬고 싶다 / 차분하게 있고 싶다 / 위로받고 싶다" 같은 막연한 휴식·회복 욕구를 곧바로 카페로 매핑하지 마세요.
  Kaplan ART와 Ulrich SRT가 가리키는 회복 환경의 풀에는 카페 외에도 도서관, 책방, 정원, 공원, 한옥/전통 공간,
  미술관, 전망대, 강가·산책로, 작은 박물관, 기도실, 명상 공간 등 다양한 후보가 있습니다.
  사용자 발화에 음료·식사·맛 키워드가 명시되지 않았다면 카페·음식점 외 후보를 우선 고려하세요.
- keywords_must 에는 "카페", "음식점" 같은 카테고리명을 넣지 마세요.
  대신 형용사·환경 어휘 (예: "조용한", "고즈넉한", "한적한", "햇살", "나무", "자연광", "전통", "소담", "열린", "빛")를 쓰세요.
- category_hint 는 사용자 발화에 명확히 매핑되는 단서가 있을 때만 채우세요:
  · 39(음식점): 식사·메뉴·맛·허기·술자리 등 음식 관련 욕구가 명시
  · 28(레포츠): 운동·움직임·체험·액티비티 욕구
  · 14(문화시설): 전시·공연·문화 체험 욕구
  · 12(관광지): 풍경·산책·둘러보기 욕구
  · 그 외 막연한 회복 욕구 → 빈 문자열("")로 두어 다양한 카테고리에 매칭되게 합니다.

[참고 심리학 컨텍스트]
${ragContext}

[감정→이론 가이드]
- joy/anticipation/trust 우세 (긍정 정서) → 활기·축하·공유·소셜 환경.
  · **stress_recovery_theory, attention_restoration_theory, behavioral_activation 사용 금지** — 이 세 이론은 부정 정서·정신적 피로·우울을 위한 회복/활성화 이론으로, 긍정 정서엔 부적합.
  · 사용 가능: gross_emotion_regulation 의 "savoring/capitalization(긍정 정서를 의식적으로 음미·공유해 증폭)" 측면.
  · prescription_text 도 "회복/평온/조용" 어휘 대신 "활기·생동감·함께·공유·자랑·축하·기념" 어휘로 작성.
- sadness 강함 → behavioral_activation, comfort_food_belonging
  ※ comfort_food_belonging 은 사용자가 음식 욕구를 직접 표현했을 때만 적용. 일반적 슬픔/지침에는 ART·BA를 우선.
- fear/anger/stress 강함 → stress_recovery_theory (자연 요소가 핵심)
- 정신적 피로 → attention_restoration_theory (Soft Fascination)
- 외로움 → comfort_food_belonging *또는* 사람의 온기가 느껴지는 공동 공간 (반드시 음식점 아님)
- 감정 전반 조절 → gross_emotion_regulation

[잘못된 이론 매핑 회피 — 긍정 정서에 회복 이론 적용 금지]
나쁜 예시 — joy 0.6, anticipation 0.4 (긍정 우세)에 SRT/ART 매핑:
  referenced_theories: ["stress_recovery_theory", "attention_restoration_theory"]
  prescription_text: "조용한 정원에서 자연을 느끼며 마음을 가라앉혀..."
  ← 스트레스나 정신적 피로가 없는데 회복/평온 이미지를 처방. 잘못됨.
좋은 예시 — joy 0.6, anticipation 0.4 (긍정 우세):
  referenced_theories: ["gross_emotion_regulation"]
  prescription_text: "친구들과 함께 기분을 마음껏 즐길 수 있는 활기찬 공간, 사진으로 남기고 싶은 분위기와 생동감 있는 풍경이 어우러진 곳"
  keywords_must: ["활기", "생동감", "함께", "풍경"]

[좋은 처방 / 나쁜 처방 예시]
나쁜 예시 — 모든 부정 정서에 카페 매핑:
  prescription_text: "조용하고 따뜻한 카페에서 차 한 잔 하며 마음을 정리..."
  keywords_must: ["카페", "조용", "따뜻"]
  category_hint: "39"

좋은 예시 — 환경 속성 중심, 카테고리 미고정:
  prescription_text: "햇살이 깊게 드는 고즈넉한 실내, 나무 가구와 잔잔한 향이 있는 공간에서 혼자 시간을 보낼 수 있는 곳"
  keywords_must: ["고즈넉", "햇살", "나무", "조용"]
  category_hint: ""

좋은 예시 — 사용자가 직접 "차 마시고 싶다" 표현한 경우만:
  prescription_text: "..."
  keywords_must: ["차", "조용", "햇살"]
  category_hint: "39"`;
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
