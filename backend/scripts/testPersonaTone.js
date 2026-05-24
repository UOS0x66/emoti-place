/**
 * 페르소나 톤 빠른 검증 (인증·세션·DB 우회 + chatService 로직 시뮬레이션)
 *
 * personas.js + fewshotExamples.js + chatService 의 composeMessages를 그대로 사용해
 * 실제 채팅과 동일한 메시지 구조로 LLM 호출.
 *
 * 실행: node scripts/testPersonaTone.js
 */

import 'dotenv/config';
import openai from '../src/config/openai.js';
import PERSONAS from '../src/prompts/personas.js';
import { composeMessages } from '../src/services/chatService.js';

const MODEL = process.env.LLM_MODEL || 'gpt-4o';

// 멀티턴 시나리오: 메타 반응·격분 반복·일상 가벼움까지 커버
const SCENARIOS = [
  { label: '인사', user: '안녕' },
  { label: '부정·일상 (격분 유발)', user: '오늘 부장이 나한테 또 뭐라하더라' },
  { label: '메타 외마디 (직전 봇 응답 의문)', user: '뭐?' },
  { label: '같은 격분 토픽 재진입', user: '아 내가 안한거를 했다고 뒤집어 씌우네' },
  { label: '가벼운 일상', user: '점심 뭐 먹지' },
  { label: '추천 직접 요구', user: '어디 좋은 데 좀 알려줘' },
];

function flagsFor(reply) {
  const tags = [];
  if (/[?？]|입니까$|있어\?|어떠세요|뭐예요|뭐야|뭔 일|무슨 일|어떠냐|있으냐|뭐꼬|뭐여/i.test(reply))
    tags.push('❓질문');
  return tags.length ? tags.join(' ') : '';
}

async function runPersona(personaId) {
  const persona = PERSONAS[personaId];
  console.log(`\n\n${'━'.repeat(72)}`);
  console.log(`◆ ${personaId}. ${persona.name}`);
  console.log('━'.repeat(72));

  const history = [{ role: 'assistant', content: persona.greeting }];
  console.log(`\n[그리팅]\n  ${persona.greeting}`);

  for (const sc of SCENARIOS) {
    const messages = composeMessages(persona, personaId, history, sc.user);

    const res = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.85,
      max_tokens: 400,
      frequency_penalty: 0.4,
      presence_penalty: 0.3,
    });

    const reply = res.choices[0].message.content.trim();
    history.push({ role: 'user', content: sc.user });
    history.push({ role: 'assistant', content: reply });

    const flag = flagsFor(reply) || '✅';
    console.log(`\n[${sc.label}] ${flag}`);
    console.log(`  USER: ${sc.user}`);
    console.log(`  BOT : ${reply.split('\n').join('\n        ')}`);

    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  console.log(`Model: ${MODEL}`);
  for (const pid of [1, 2, 3]) {
    await runPersona(pid);
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('\n\n━━━ 완료 ━━━');
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
