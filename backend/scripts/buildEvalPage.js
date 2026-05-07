/**
 * eval_page.html 템플릿의 임베디드 CASES 배열을 새 결과로 교체해
 * 루트에 eval_page_new.html 로 출력.
 *
 * 사용:
 *   cd backend && node scripts/buildEvalPage.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'eval_page.html');
const RESULTS_PATH = path.join(REPO_ROOT, 'backend', 'data', 'test', 'eval_results.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'eval_page_new.html');

function toCases(results) {
  return results.map((r) => ({
    conversation_id: r.conversation_id,
    title: r.title,
    scenario: r.scenario,
    mbti: r.mbti,
    persona_id: r.persona_id,
    timestamp: r.timestamp,
    conversation: r.conversation,
    emotions: r.emotions || null,
    prescription: r.prescription || null,
    places: r.places || [],
    error: r.error,
  }));
}

const template = readFileSync(TEMPLATE_PATH, 'utf8');
const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
const cases = toCases(results);

const lines = template.split('\n');
let replaced = 0;
const newLines = lines.map((line) => {
  if (line.startsWith('const CASES = [')) {
    replaced += 1;
    return `const CASES = ${JSON.stringify(cases)};`;
  }
  return line;
});

if (replaced !== 1) {
  console.error(`Expected exactly 1 'const CASES = [' line, found ${replaced}`);
  process.exit(1);
}

writeFileSync(OUTPUT_PATH, newLines.join('\n'));
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`  cases: ${cases.length}`);
console.log(`  mbti distribution: ${
  Object.entries(cases.reduce((m, c) => { m[c.mbti] = (m[c.mbti] || 0) + 1; return m; }, {}))
    .map(([k, v]) => `${k}=${v}`).join(', ')
}`);
console.log(`  persona distribution: ${
  Object.entries(cases.reduce((m, c) => { m[c.persona_id] = (m[c.persona_id] || 0) + 1; return m; }, {}))
    .map(([k, v]) => `persona${k}=${v}`).join(', ')
}`);