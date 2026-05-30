/**
 * 페르소나 톤 평가 하네스.
 *
 * conversations.json 의 각 대화에 대해, 사용자 발화 시점마다
 * 현재 페르소나 프롬프트 + CHAT_MODEL 로 응답을 생성한 다음
 * gpt-4o-mini 가 판사 역할로 4축 채점한다.
 *
 *   - 응답 길이 (자수)
 *   - 매뉴얼 위로 침입 (regex 검출)
 *   - 클로저 질문 패턴 (regex)
 *   - 드립 출현률 + 드립 자연스러움 (judge)
 *   - 캐릭터 일관성 (judge 1~5)
 *   - 문맥 정합성 (judge 1~5)
 *
 * 결과: backend/data/test/persona_eval_results.json + 콘솔 요약.
 * HTML 보고서: buildPersonaEvalPage.js 로 별도 생성.
 *
 * 비용: 약 20 대화 × 4 turn = 80 chat 호출 (CHAT_MODEL) + 80 judge 호출 (gpt-4o-mini).
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import openai from '../src/config/openai.js';
import PERSONAS from '../src/prompts/personas.js';
import { composeMessages } from '../src/services/chatService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CHAT_MODEL = process.env.CHAT_MODEL || process.env.LLM_MODEL || 'gpt-5';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'gpt-4o-mini';

// 매뉴얼식 위로/공감 패턴 — SHARED_CORE 에서 금지한 문구들
const MANUAL_WARMTH_PATTERNS = [
  '힘드시겠', '이해합니다', '그러셨군요', '마음이 아프', '많이 속상',
  '많이 힘드', '도움이 되', '한 상태시군', '마음이 무거', '많이 지치셨',
];

// 클로저 질문 패턴 — 응답 끝의 안전모드 질문 클로저
const CLOSING_PATTERNS_END = [
  /더\s*(이야기|말씀|얘기)/, /말씀해\s*(주|보)/, /알려주\s*[실세]/,
  /들려주\s*[실세]/, /어떤\s*일/, /왜\s*그/, /뭐가\s*그/, /어땠/,
];

function detectManualWarmth(text) {
  return MANUAL_WARMTH_PATTERNS.find((p) => (text || '').includes(p)) || null;
}

function detectClosingQuestion(text) {
  const t = (text || '').trim();
  if (!t) return null;
  // 응답이 ? 로 끝남
  if (/[?？]\s*$/.test(t)) return 'ends_with_question';
  // 마지막 한 줄(또는 마지막 60자) 안에 후속 정보 요청 패턴
  const tail = t.slice(-60);
  for (const p of CLOSING_PATTERNS_END) {
    if (p.test(tail)) return p.toString();
  }
  return null;
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    drip_present: {
      type: 'boolean',
      description: '응답에 드립·과장·놀림·딴소리 등 캐릭터 코미디가 1개 이상 포함됐는가',
    },
    drip_quality: {
      type: 'integer', minimum: 0, maximum: 5,
      description:
        '드립의 자연스러움/적절성. 없으면 0. 어색하거나 맥락 안 맞으면 1~2. 자연스럽고 적절하면 4~5.',
    },
    character_consistency: {
      type: 'integer', minimum: 1, maximum: 5,
      description:
        '페르소나의 말투(어미·호칭·시그니처 표현)와 캐릭터 정체성을 얼마나 잘 유지했는가. 1=완전 깨짐, 5=완벽.',
    },
    context_coherence: {
      type: 'integer', minimum: 1, maximum: 5,
      description:
        '직전 사용자 발화의 의미·욕구를 얼마나 잘 받아쳤는가. 1=무관/문맥 무시, 5=정확히 받아침.',
    },
    notes: { type: 'string', description: '눈에 띄는 점 한 줄 (선택, 없으면 빈 문자열)' },
  },
  required: ['drip_present', 'drip_quality', 'character_consistency', 'context_coherence', 'notes'],
  additionalProperties: false,
};

async function generatePersonaResponse(personaId, history, userMessage) {
  const persona = PERSONAS[personaId];
  const messages = composeMessages(persona, personaId, history, userMessage);
  const isGpt5 = /^gpt-5/i.test(CHAT_MODEL);
  const params = isGpt5
    ? {
        model: CHAT_MODEL,
        messages,
        max_completion_tokens: 450,
        reasoning_effort: 'minimal',
      }
    : {
        model: CHAT_MODEL,
        messages,
        temperature: 0.9,
        max_tokens: 400,
        frequency_penalty: 0.2,
        presence_penalty: 0.2,
      };
  const r = await openai.chat.completions.create(params);
  return r.choices[0]?.message?.content?.trim() || '';
}

async function judgeResponse({ personaName, scenario, history, userMessage, response }) {
  const judgeSystem = `당신은 한국어 챗봇 페르소나 응답을 평가하는 엄정한 전문가입니다.

[평가 대상 페르소나]
${personaName}

[평가 원칙]
- 페르소나는 심리 상담사가 아닌 캐릭터다. 매뉴얼식 위로("힘드시겠어요", "이해합니다" 등)는 캐릭터 깨짐으로 본다.
- 응답은 캐릭터의 평이한 반응이 기본이고, 드립은 적재적소에 들어가야 한다. 매번 드립이거나 전혀 없으면 둘 다 감점 요소.
- 클로저 질문("더 말씀해주세요?", "어떤 일이세요?" 등) 은 안전모드로의 회귀로 본다.
- 한국어 자연스러움, 합성어 사고, 어미 일관성 모두 캐릭터 일관성에 포함된다.

객관적으로 채점하라.`;

  const historyText = history
    .map((m) => `${m.role === 'user' ? '사용자' : '페르소나'}: ${m.content}`)
    .join('\n');

  const judgeUser = `[시나리오]
${scenario}

[직전 대화 히스토리]
${historyText}

[사용자 마지막 발화]
${userMessage}

[페르소나 응답 — 평가 대상]
${response}

위 응답을 JSON 으로 채점하라.`;

  const r = await openai.chat.completions.create({
    model: JUDGE_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: judgeSystem },
      { role: 'user', content: judgeUser },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'persona_judgement', schema: JUDGE_SCHEMA, strict: true },
    },
  });
  return JSON.parse(r.choices[0].message.content);
}

function summarize(allTurns) {
  if (allTurns.length === 0) return {};
  const n = allTurns.length;
  const avg = (key) => allTurns.reduce((s, t) => s + key(t), 0) / n;
  return {
    n,
    avg_length: avg((t) => t.metrics.length).toFixed(1),
    drip_rate: ((100 * allTurns.filter((t) => t.judgement?.drip_present).length) / n).toFixed(1) + '%',
    avg_drip_quality: avg((t) => t.judgement?.drip_quality ?? 0).toFixed(2),
    avg_character_consistency: avg((t) => t.judgement?.character_consistency ?? 0).toFixed(2),
    avg_context_coherence: avg((t) => t.judgement?.context_coherence ?? 0).toFixed(2),
    manual_warmth_hits: allTurns.filter((t) => t.metrics.manual_warmth).length,
    closing_question_hits: allTurns.filter((t) => t.metrics.closing_question).length,
  };
}

async function main() {
  const inputPath = path.join(ROOT, 'data', 'test', 'conversations.json');
  const outputPath = path.join(ROOT, 'data', 'test', 'persona_eval_results.json');
  const data = JSON.parse(readFileSync(inputPath, 'utf8'));

  console.log(`CHAT_MODEL=${CHAT_MODEL}, JUDGE_MODEL=${JUDGE_MODEL}`);
  console.log(`대화 수: ${data.conversations.length}\n`);

  const results = [];
  const startedAt = Date.now();

  for (let ci = 0; ci < data.conversations.length; ci++) {
    const conv = data.conversations[ci];
    const personaName = PERSONAS[conv.persona_id].name;
    console.log(`[${ci + 1}/${data.conversations.length}] id=${conv.id} "${conv.title}" (${personaName})`);

    const turns = [];
    const msgs = conv.messages;
    // msgs[0] = 그리팅, msgs[1] = 사용자, msgs[2] = 페르소나, ...
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].role !== 'user') continue;
      const history = msgs.slice(0, i); // 그리팅 + 이전 user/assistant 쌍들
      const userMsg = msgs[i].content;
      const t0 = Date.now();

      let response = '';
      let judgement = null;
      try {
        response = await generatePersonaResponse(conv.persona_id, history, userMsg);
      } catch (e) {
        console.error(`    chat ERR: ${e.message}`);
        continue;
      }
      const responseLen = response.length;
      const manualWarmth = detectManualWarmth(response);
      const closingQuestion = detectClosingQuestion(response);

      try {
        judgement = await judgeResponse({
          personaName,
          scenario: conv.scenario,
          history,
          userMessage: userMsg,
          response,
        });
      } catch (e) {
        console.error(`    judge ERR: ${e.message}`);
      }

      const turnIdx = Math.floor(i / 2) + 1;
      const tags = [];
      if (manualWarmth) tags.push(`WARMTH:${manualWarmth}`);
      if (closingQuestion) tags.push('CLOSER:Q');
      if (judgement) {
        tags.push(
          `drip=${judgement.drip_present ? judgement.drip_quality : 'X'}`,
          `consist=${judgement.character_consistency}`,
          `ctx=${judgement.context_coherence}`
        );
      }
      console.log(`    turn ${turnIdx}: ${responseLen}자 | ${tags.join(' · ')} (${Date.now() - t0}ms)`);

      turns.push({
        turn_idx: turnIdx,
        history,
        user_message: userMsg,
        original_response: msgs[i + 1]?.content || null,
        generated_response: response,
        metrics: {
          length: responseLen,
          manual_warmth: manualWarmth,
          closing_question: closingQuestion,
        },
        judgement,
      });
    }

    results.push({
      conversation_id: conv.id,
      title: conv.title,
      scenario: conv.scenario,
      persona_id: conv.persona_id,
      persona_name: personaName,
      turns,
    });

    // 중간 저장
    writeFileSync(outputPath, JSON.stringify(results, null, 2));
  }

  // 요약
  const allTurns = results.flatMap((r) => r.turns);
  const summary = summarize(allTurns);
  console.log('\n=== 전체 요약 ===');
  console.log(JSON.stringify(summary, null, 2));

  // 페르소나별
  console.log('\n=== 페르소나별 ===');
  for (const pid of [1, 2, 3]) {
    const personaTurns = results.filter((r) => r.persona_id === pid).flatMap((r) => r.turns);
    if (personaTurns.length === 0) continue;
    console.log(`\n[${PERSONAS[pid].name}]`);
    console.log(JSON.stringify(summarize(personaTurns), null, 2));
  }

  const finalOutput = { meta: { chat_model: CHAT_MODEL, judge_model: JUDGE_MODEL, ran_at: new Date().toISOString() }, summary, results };
  writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));
  console.log(`\nWrote ${outputPath} (${((Date.now() - startedAt) / 1000).toFixed(1)}초)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});