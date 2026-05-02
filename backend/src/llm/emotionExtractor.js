/**
 * Stage 1 — 감정 추출 모듈
 *
 * 입력: 대화 히스토리 (페르소나↔사용자 메시지)
 * 출력: Plutchik 8감정 점수 JSON (각 0.0~1.0, 독립 차원)
 *
 * 동작:
 *   1) `data/psych/processed/chunks.jsonl`에서 plutchik_basic_emotions 청크 로드
 *   2) OpenAI structured outputs로 JSON 스키마 강제 호출
 *   3) 8감정 점수만 반환
 */

import { readFileSync, existsSync } from 'node:fs';
import openai from '../config/openai.js';

export const PLUTCHIK_8 = [
  'joy', 'trust', 'fear', 'surprise',
  'sadness', 'disgust', 'anger', 'anticipation',
];

const PLUTCHIK_KO = {
  joy: '기쁨', trust: '신뢰', fear: '두려움', surprise: '놀람',
  sadness: '슬픔', disgust: '혐오', anger: '분노', anticipation: '기대',
};

const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const CHUNKS_PATH = process.env.PSYCH_CHUNKS_PATH || 'data/psych/processed/chunks.jsonl';

let _plutchikContext = null;
function loadPlutchikContext() {
  if (_plutchikContext !== null) return _plutchikContext;
  if (!existsSync(CHUNKS_PATH)) {
    _plutchikContext = '(Plutchik 청크 미적재 — 일반 상식 기반 추론)';
    return _plutchikContext;
  }
  const lines = readFileSync(CHUNKS_PATH, 'utf8').split('\n').filter(Boolean);
  const chunks = lines
    .map((l) => JSON.parse(l))
    .filter((c) => c.theory === 'plutchik_basic_emotions')
    .sort((a, b) => a.chunk_idx - b.chunk_idx);
  _plutchikContext = chunks.map((c) => c.raw_text).join('\n\n---\n\n');
  return _plutchikContext;
}

const EMOTION_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    PLUTCHIK_8.map((e) => [
      e,
      { type: 'number', minimum: 0, maximum: 1, description: `${PLUTCHIK_KO[e]} 강도 (0.0~1.0)` },
    ])
  ),
  required: PLUTCHIK_8,
  additionalProperties: false,
};

function buildSystemPrompt() {
  const ctx = loadPlutchikContext();
  return `당신은 Plutchik(1980)의 정신진화 감정 이론(psychoevolutionary theory)에 기반해 사용자 대화를 정밀 분석하는 전문가입니다.

[당신의 임무]
대화 메시지(특히 사용자 발화)에서 드러나는 감정을 Plutchik 8가지 기본감정 점수로 추출하세요.

[8가지 기본감정]
- joy(기쁨), trust(신뢰), fear(두려움), surprise(놀람)
- sadness(슬픔), disgust(혐오), anger(분노), anticipation(기대)

[점수 규칙]
1. 각 감정은 0.0~1.0 사이의 강도. 서로 독립 차원이라 합이 1.0일 필요 없음.
2. 강도 가이드:
   - 0.0      : 해당 감정 없음
   - 0.1~0.3 : 약한 단서 (어조에 살짝 묻어남)
   - 0.4~0.6 : 명확한 표현
   - 0.7~1.0 : 강한 표현 (직접 언급, 격한 어조)
3. 명시적 단어가 없어도 맥락/어조에서 추론하세요.
4. 페르소나의 발화는 분석 대상이 아닙니다. **사용자 메시지만** 분석.

[Plutchik 이론 발췌 — 컨텍스트]
${ctx}`;
}

function formatDialog(history) {
  return history
    .map((m) => {
      const role = m.role === 'user' ? '사용자' : (m.role === 'assistant' ? '페르소나' : m.role);
      return `${role}: ${m.content}`;
    })
    .join('\n');
}

/**
 * @param {Array<{role,content}>} conversationHistory
 * @param {Object} [options]
 * @returns {Promise<{joy,trust,fear,surprise,sadness,disgust,anger,anticipation}>}
 */
export async function extractEmotionScores(conversationHistory, options = {}) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    throw new Error('conversationHistory는 비어있지 않은 배열이어야 합니다');
  }
  const dialogText = formatDialog(conversationHistory);

  const res = await openai.chat.completions.create({
    model: options.model || DEFAULT_MODEL,
    temperature: options.temperature ?? 0.2,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: `[대화 히스토리]\n${dialogText}\n\n위 대화에서 사용자가 표현한 감정을 Plutchik 8감정 점수 JSON으로 출력하세요.`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'plutchik_8_scores', schema: EMOTION_SCHEMA, strict: true },
    },
  });

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error('LLM 응답이 비어있습니다');
  const scores = JSON.parse(raw);
  for (const e of PLUTCHIK_8) {
    const v = scores[e];
    if (typeof v !== 'number' || v < 0 || v > 1) {
      throw new Error(`잘못된 점수 ${e}=${v}`);
    }
  }
  return scores;
}
