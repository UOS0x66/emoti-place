/**
 * 런타임 응답 검증 — chatService 가 응답 emit 전에 호출.
 *
 * (D) regex 검출: 형식 회귀 (번호 리스트, 매뉴얼 양식, 페르소나 누출 등). 즉시·무료.
 * (A) inline judge: LLM judge 가 캐릭터 일관성·드립 적절성 binary 평가.
 *
 * fail 시 chatService 가 한 번 재생성 → 그래도 fail 이면 그대로 emit.
 */

import openai from '../config/openai.js';
import PERSONAS from '../prompts/personas.js';
import { detectAllRegressions } from '../utils/responseDetectors.js';

const INLINE_JUDGE_MODEL =
  process.env.INLINE_JUDGE_MODEL || process.env.JUDGE_MODEL || 'gpt-4o-mini';

const INLINE_JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    pass: {
      type: 'boolean',
      description:
        '응답이 페르소나 [STYLE]/[VOICE_POOL] 규칙을 어기지 않고, 사용자 발화 문맥에 적절하면 true.',
    },
    break_type: {
      type: 'string',
      enum: [
        'none',
        'persona_break',
        'off_topic',
        'manual_warmth',
        'manual_format',
        'forbidden_ending',
        'other',
      ],
      description:
        'fail 시 결: persona_break(말투·시그니처 어휘 위반) / off_topic(문맥 무시) / manual_warmth(매뉴얼식 위로) / manual_format(번호리스트·매뉴얼 양식) / forbidden_ending(금지 어미). pass 면 none.',
    },
    detail: { type: 'string', description: 'fail 시 짧은 설명 (없으면 빈 문자열)' },
  },
  required: ['pass', 'break_type', 'detail'],
  additionalProperties: false,
};

/**
 * (D) 정규식 회귀 검사. 발견되면 issue 배열, 없으면 빈 배열.
 */
export function detectRegressions(text, personaId) {
  return detectAllRegressions(text, personaId);
}

function buildInlineJudgeParams(personaName, userMessage, response) {
  const system = `당신은 한국어 챗봇 페르소나 응답을 실시간으로 평가하는 엄정한 판사입니다.

[평가 대상 페르소나]
${personaName}

[평가 기준]
- 페르소나 정체성·말투(어미·호칭·시그니처 어휘) 유지하면 pass.
- 매뉴얼식 위로("힘드시겠어요" 등), 번호 리스트(1)/불릿(-)/매뉴얼 양식, 캐릭터 깨짐, 사용자 발화 무시 → fail.
- 한 응답에 한 결만, 짧고 자연스러우면 pass. 장황한 컨설팅 모드면 fail.
- 정치·종교·민감 주제에 과한 드립/딴소리 폭주면 off_topic 으로 fail.

빠르고 객관적으로 채점하라.`;

  const user = `[사용자 마지막 발화]
${userMessage}

[페르소나 응답 — 평가 대상]
${response}

위 응답을 평가 JSON 으로 출력.`;

  const isGpt5 = /^gpt-5/i.test(INLINE_JUDGE_MODEL);
  const baseMessages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const responseFormat = {
    type: 'json_schema',
    json_schema: { name: 'inline_judge', schema: INLINE_JUDGE_SCHEMA, strict: true },
  };

  if (isGpt5) {
    return {
      model: INLINE_JUDGE_MODEL,
      reasoning_effort: 'none',
      temperature: 0.2,
      messages: baseMessages,
      response_format: responseFormat,
    };
  }
  return {
    model: INLINE_JUDGE_MODEL,
    temperature: 0.2,
    messages: baseMessages,
    response_format: responseFormat,
  };
}

/**
 * (A) inline judge. LLM 으로 응답을 평가. 비용 절감 위해 짧은 schema.
 * 실패 시 (네트워크 등) pass 처리 — judge 가 chat 을 막아서면 안 됨.
 */
export async function judgeResponseInline({ personaId, userMessage, response }) {
  const persona = PERSONAS[personaId];
  if (!persona) return { pass: true, break_type: 'none', detail: '' };

  try {
    const r = await openai.chat.completions.create(
      buildInlineJudgeParams(persona.name, userMessage, response)
    );
    const raw = r.choices[0]?.message?.content;
    if (!raw) return { pass: true, break_type: 'none', detail: '' };
    return JSON.parse(raw);
  } catch (err) {
    console.error('[validator] inline judge err (pass-through):', err.message);
    return { pass: true, break_type: 'none', detail: '' };
  }
}

/**
 * 응답 전체 검증: D 먼저 (cheap), 통과 시에만 A (LLM 호출).
 * @returns {Promise<{pass: boolean, reason: string|null, source: 'regex'|'judge'|null}>}
 */
export async function validateResponse({ text, personaId, userMessage }) {
  // D: regex
  const issues = detectRegressions(text, personaId);
  if (issues.length > 0) {
    return { pass: false, reason: issues.join(','), source: 'regex' };
  }
  // A: inline judge
  const j = await judgeResponseInline({ personaId, userMessage, response: text });
  if (!j.pass) {
    return { pass: false, reason: `${j.break_type}:${j.detail}`, source: 'judge' };
  }
  return { pass: true, reason: null, source: null };
}