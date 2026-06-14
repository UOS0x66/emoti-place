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
import {
  detectManualWarmth,
  detectClosingQuestion,
  detectNumberedList,
  detectBulletList,
  detectManualPattern,
  detectPersonaLeak,
  detectVerbatimCopy,
} from '../src/utils/responseDetectors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CHAT_MODEL = process.env.CHAT_MODEL || process.env.LLM_MODEL || 'gpt-5';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'gpt-4o-mini';

// 회귀 검출기는 backend/src/utils/responseDetectors.js 의 import 로 일원화됨.

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
  const isGpt51 = /^gpt-5\.1/i.test(CHAT_MODEL);
  const isGpt5 = /^gpt-5/i.test(CHAT_MODEL);
  let params;
  if (isGpt51) {
    params = {
      model: CHAT_MODEL,
      messages,
      max_completion_tokens: 450,
      reasoning_effort: 'none',
      temperature: 0.7,
    };
  } else if (isGpt5) {
    params = {
      model: CHAT_MODEL,
      messages,
      max_completion_tokens: 450,
      reasoning_effort: 'minimal',
    };
  } else {
    params = {
      model: CHAT_MODEL,
      messages,
      temperature: 0.9,
      max_tokens: 400,
      frequency_penalty: 0.2,
      presence_penalty: 0.2,
    };
  }
  const r = await openai.chat.completions.create(params);
  return r.choices[0]?.message?.content?.trim() || '';
}

function buildJudgeParams(messages) {
  const isGpt5Family = /^gpt-5/i.test(JUDGE_MODEL);
  // gpt-5/gpt-5.1: reasoning_effort='none' 이면 temperature 풀려서 일관 채점용 0.2 사용 가능.
  // 그 외 모델 (gpt-4o-mini 등): 그냥 temperature 0.2.
  if (isGpt5Family) {
    return {
      model: JUDGE_MODEL,
      reasoning_effort: 'none',
      temperature: 0.2,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'persona_judgement', schema: JUDGE_SCHEMA, strict: true },
      },
    };
  }
  return {
    model: JUDGE_MODEL,
    temperature: 0.2,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'persona_judgement', schema: JUDGE_SCHEMA, strict: true },
    },
  };
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

  const r = await openai.chat.completions.create(
    buildJudgeParams([
      { role: 'system', content: judgeSystem },
      { role: 'user', content: judgeUser },
    ])
  );
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
    numbered_list_hits: allTurns.filter((t) => t.metrics.numbered_list).length,
    bullet_list_hits: allTurns.filter((t) => t.metrics.bullet_list).length,
    manual_pattern_hits: allTurns.filter((t) => t.metrics.manual_pattern).length,
    persona_leak_hits: allTurns.filter((t) => t.metrics.persona_leak).length,
    verbatim_copy_hits: allTurns.filter((t) => t.metrics.verbatim_copy).length,
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
      const numberedList = detectNumberedList(response);
      const bulletList = detectBulletList(response);
      const manualPattern = detectManualPattern(response);
      const personaLeak = detectPersonaLeak(response, conv.persona_id);
      const verbatimCopy = detectVerbatimCopy(response, conv.persona_id);

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
      if (numberedList) tags.push('NUM_LIST');
      if (bulletList) tags.push('BULLETS');
      if (manualPattern) tags.push(`MANUAL:${manualPattern}`);
      if (personaLeak) tags.push(`LEAK:${personaLeak}`);
      if (verbatimCopy) tags.push(`VERBATIM:${verbatimCopy}`);
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
          numbered_list: numberedList,
          bullet_list: bulletList,
          manual_pattern: manualPattern,
          persona_leak: personaLeak,
          verbatim_copy: verbatimCopy,
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