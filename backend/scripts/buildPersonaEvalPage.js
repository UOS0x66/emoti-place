/**
 * persona_eval_results.json → persona_eval_page.html
 *
 * 각 대화별로:
 *   - 시나리오 / 페르소나 표시
 *   - turn 별 사용자 발화 / 페르소나 응답 / 메트릭 / judge 점수
 *
 * 상단에 전체 요약 + 페르소나별 요약 박스.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RESULTS_PATH = path.resolve(__dirname, '..', 'data', 'test', 'persona_eval_results.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'persona_eval_page.html');

const data = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));

const HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>페르소나 톤 평가</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; background: #f5f5f7; color: #1d1d1f; }
  header { position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,0.94); backdrop-filter: blur(8px); border-bottom: 1px solid #e5e5ea; padding: 14px 20px; }
  header h1 { margin: 0 0 8px; font-size: 17px; font-weight: 700; }
  .meta { font-size: 12px; color: #6e6e73; }
  main { padding: 16px 20px 60px; max-width: 1200px; margin: 0 auto; }

  .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 22px; }
  .summary-box { background: white; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .summary-box h3 { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: #1d1d1f; }
  .summary-box.persona-box { border-left: 4px solid #007aff; }
  .summary-box.persona-1 { border-left-color: #ff3b30; }
  .summary-box.persona-2 { border-left-color: #5856d6; }
  .summary-box.persona-3 { border-left-color: #ff9500; }
  .metric { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
  .metric .label { color: #6e6e73; }
  .metric .val { font-variant-numeric: tabular-nums; font-weight: 600; color: #1d1d1f; }

  .conv { background: white; border-radius: 10px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; }
  .conv-head { padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 10px; user-select: none; }
  .conv-head:hover { background: #fafafa; }
  .conv-head .badge { font-size: 10px; padding: 2px 7px; border-radius: 4px; font-weight: 700; }
  .badge.persona-1 { background: #ff3b30; color: white; }
  .badge.persona-2 { background: #5856d6; color: white; }
  .badge.persona-3 { background: #ff9500; color: white; }
  .conv-head .id { font-size: 11px; color: #aeaeb2; min-width: 24px; }
  .conv-head .title { font-size: 14px; font-weight: 600; flex: 1; }
  .conv-head .scenario { font-size: 12px; color: #6e6e73; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 2; }
  .conv-head .summary-chips { display: flex; gap: 6px; font-size: 11px; color: #6e6e73; }
  .chip { padding: 2px 6px; background: #f2f2f7; border-radius: 4px; }
  .chip.flag { background: #ffebee; color: #ff3b30; font-weight: 600; }
  .conv-head .arrow { font-size: 11px; color: #aeaeb2; transition: transform 0.15s; }
  .conv.open .conv-head .arrow { transform: rotate(90deg); }

  .conv-body { display: none; padding: 0 16px 16px; }
  .conv.open .conv-body { display: block; }

  .turn { border-top: 1px solid #f0f0f0; padding: 12px 0; }
  .turn:first-child { border-top: none; padding-top: 6px; }
  .turn-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .turn-head .num { font-size: 10px; font-weight: 700; padding: 2px 6px; background: #1d1d1f; color: white; border-radius: 3px; }
  .turn-head .metric-line { font-size: 11px; color: #6e6e73; display: flex; gap: 10px; }
  .turn-head .metric-line .v { font-weight: 600; color: #1d1d1f; }
  .turn-head .metric-line .flag { color: #ff3b30; font-weight: 700; }

  .msg { font-size: 13px; line-height: 1.55; margin: 4px 0; padding: 8px 12px; border-radius: 8px; }
  .msg.history { background: #f9f9fc; color: #6e6e73; font-size: 12px; max-height: 80px; overflow: auto; }
  .msg.user { background: #e3f2fd; color: #003a87; }
  .msg.user .role { font-size: 10px; font-weight: 700; color: #007aff; }
  .msg.original { background: #fff7e6; color: #5c4317; border-left: 3px solid #ff9500; }
  .msg.original .role { font-size: 10px; font-weight: 700; color: #ff9500; }
  .msg.generated { background: #e8f5e9; color: #1b3d1e; border-left: 3px solid #34c759; font-weight: 500; }
  .msg.generated .role { font-size: 10px; font-weight: 700; color: #34c759; }
  .msg .role { display: block; margin-bottom: 3px; }

  .judge-notes { font-size: 11px; color: #6e6e73; font-style: italic; margin-top: 4px; }

  .filter-bar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
  .filter-bar select, .filter-bar input { padding: 6px 10px; border: 1px solid #d2d2d7; border-radius: 6px; background: white; font-size: 12px; }
  .filter-bar button { padding: 6px 12px; border: 0; border-radius: 6px; background: #1d1d1f; color: white; font-size: 12px; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>페르소나 톤 평가</h1>
  <div class="meta" id="meta"></div>
</header>
<main>
  <div class="summary-grid" id="summary-grid"></div>

  <div class="filter-bar">
    <select id="filter-persona">
      <option value="">전체 페르소나</option>
      <option value="1">조폭 동생</option>
      <option value="2">논리 로봇</option>
      <option value="3">욕쟁이 할멈</option>
    </select>
    <button id="toggle-all">전체 펼치기/접기</button>
  </div>

  <div id="conv-list"></div>
</main>

<script>
const DATA = ${JSON.stringify(data)};

const META = DATA.meta || {};
document.getElementById('meta').innerHTML =
  'CHAT_MODEL: <b>' + (META.chat_model || '?') + '</b> · JUDGE: <b>' + (META.judge_model || '?') + '</b> · ' +
  (META.ran_at ? new Date(META.ran_at).toLocaleString('ko-KR') : '');

function renderSummary() {
  const s = DATA.summary || {};
  const personas = {1: '조폭 동생', 2: '논리 로봇', 3: '욕쟁이 할멈'};
  const html = [\`
    <div class="summary-box">
      <h3>전체 (n=\${s.n})</h3>
      \${metricRow('평균 길이', s.avg_length + '자')}
      \${metricRow('드립 출현률', s.drip_rate)}
      \${metricRow('드립 품질', s.avg_drip_quality + '/5')}
      \${metricRow('캐릭터 일관성', s.avg_character_consistency + '/5')}
      \${metricRow('문맥 정합성', s.avg_context_coherence + '/5')}
      \${metricRow('매뉴얼 위로', s.manual_warmth_hits + '건')}
      \${metricRow('클로저 질문', s.closing_question_hits + '건')}
      \${metricRow('번호 리스트', (s.numbered_list_hits ?? 0) + '건')}
      \${metricRow('불릿 리스트', (s.bullet_list_hits ?? 0) + '건')}
      \${metricRow('매뉴얼 양식', (s.manual_pattern_hits ?? 0) + '건')}
      \${metricRow('페르소나 누출', (s.persona_leak_hits ?? 0) + '건')}
    </div>
  \`];

  for (const pid of [1, 2, 3]) {
    const turns = DATA.results.filter(r => r.persona_id === pid).flatMap(r => r.turns);
    if (turns.length === 0) continue;
    const ps = summarize(turns);
    html.push(\`
      <div class="summary-box persona-box persona-\${pid}">
        <h3>\${personas[pid]} (n=\${ps.n})</h3>
        \${metricRow('평균 길이', ps.avg_length + '자')}
        \${metricRow('드립 출현률', ps.drip_rate)}
        \${metricRow('드립 품질', ps.avg_drip_quality + '/5')}
        \${metricRow('캐릭터 일관성', ps.avg_character_consistency + '/5')}
        \${metricRow('문맥 정합성', ps.avg_context_coherence + '/5')}
        \${metricRow('매뉴얼 위로', ps.manual_warmth_hits + '건')}
        \${metricRow('클로저 질문', ps.closing_question_hits + '건')}
        \${metricRow('번호 리스트', (ps.numbered_list_hits ?? 0) + '건')}
        \${metricRow('불릿 리스트', (ps.bullet_list_hits ?? 0) + '건')}
        \${metricRow('매뉴얼 양식', (ps.manual_pattern_hits ?? 0) + '건')}
        \${metricRow('페르소나 누출', (ps.persona_leak_hits ?? 0) + '건')}
      </div>
    \`);
  }
  document.getElementById('summary-grid').innerHTML = html.join('');
}

function summarize(turns) {
  const n = turns.length;
  const avg = fn => turns.reduce((s, t) => s + (fn(t) || 0), 0) / n;
  return {
    n,
    avg_length: avg(t => t.metrics.length).toFixed(1),
    drip_rate: (100 * turns.filter(t => t.judgement && t.judgement.drip_present).length / n).toFixed(1) + '%',
    avg_drip_quality: avg(t => t.judgement && t.judgement.drip_quality).toFixed(2),
    avg_character_consistency: avg(t => t.judgement && t.judgement.character_consistency).toFixed(2),
    avg_context_coherence: avg(t => t.judgement && t.judgement.context_coherence).toFixed(2),
    manual_warmth_hits: turns.filter(t => t.metrics.manual_warmth).length,
    closing_question_hits: turns.filter(t => t.metrics.closing_question).length,
    numbered_list_hits: turns.filter(t => t.metrics.numbered_list).length,
    bullet_list_hits: turns.filter(t => t.metrics.bullet_list).length,
    manual_pattern_hits: turns.filter(t => t.metrics.manual_pattern).length,
    persona_leak_hits: turns.filter(t => t.metrics.persona_leak).length,
  };
}

function metricRow(label, val) {
  return '<div class="metric"><span class="label">' + label + '</span><span class="val">' + val + '</span></div>';
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderConvs(filterPersona) {
  const list = filterPersona ? DATA.results.filter(r => r.persona_id == filterPersona) : DATA.results;
  const html = list.map(conv => {
    const turnFlags = [];
    if (conv.turns.some(t => t.metrics.manual_warmth)) turnFlags.push('<span class="chip flag">위로침입</span>');
    if (conv.turns.some(t => t.metrics.closing_question)) turnFlags.push('<span class="chip flag">클로저Q</span>');
    const avgLen = (conv.turns.reduce((s,t)=>s+t.metrics.length,0)/conv.turns.length).toFixed(0);
    const dripRate = (100*conv.turns.filter(t=>t.judgement && t.judgement.drip_present).length/conv.turns.length).toFixed(0);

    return \`
      <div class="conv" data-id="\${conv.conversation_id}">
        <div class="conv-head" onclick="this.parentElement.classList.toggle('open')">
          <span class="badge persona-\${conv.persona_id}">P\${conv.persona_id}</span>
          <span class="id">#\${conv.conversation_id}</span>
          <span class="title">\${escapeHtml(conv.title)}</span>
          <span class="scenario">\${escapeHtml(conv.scenario)}</span>
          <span class="summary-chips">
            <span class="chip">avg \${avgLen}자</span>
            <span class="chip">drip \${dripRate}%</span>
            \${turnFlags.join('')}
          </span>
          <span class="arrow">▶</span>
        </div>
        <div class="conv-body">
          \${conv.turns.map(t => renderTurn(t)).join('')}
        </div>
      </div>
    \`;
  }).join('');
  document.getElementById('conv-list').innerHTML = html;
}

function renderTurn(t) {
  const j = t.judgement || {};
  const flags = [];
  if (t.metrics.manual_warmth) flags.push('<span class="flag">위로침입:' + escapeHtml(t.metrics.manual_warmth) + '</span>');
  if (t.metrics.closing_question) flags.push('<span class="flag">클로저Q</span>');

  const historyText = (t.history || []).slice(-3).map(m =>
    (m.role === 'user' ? '🙋' : '🤖') + ' ' + escapeHtml(m.content)
  ).join('<br>');

  return \`
    <div class="turn">
      <div class="turn-head">
        <span class="num">turn \${t.turn_idx}</span>
        <div class="metric-line">
          <span><span class="v">\${t.metrics.length}</span>자</span>
          <span>drip <span class="v">\${j.drip_present ? j.drip_quality : 'X'}</span></span>
          <span>consist <span class="v">\${j.character_consistency ?? '?'}</span></span>
          <span>ctx <span class="v">\${j.context_coherence ?? '?'}</span></span>
          \${flags.join(' ')}
        </div>
      </div>
      \${t.history && t.history.length > 1 ? '<div class="msg history">' + historyText + '</div>' : ''}
      <div class="msg user"><span class="role">USER</span>\${escapeHtml(t.user_message)}</div>
      \${t.original_response ? '<div class="msg original"><span class="role">ORIGINAL (대화데이터)</span>' + escapeHtml(t.original_response) + '</div>' : ''}
      <div class="msg generated"><span class="role">GENERATED (현재 프롬프트 + 모델)</span>\${escapeHtml(t.generated_response)}</div>
      \${j.notes ? '<div class="judge-notes">judge: ' + escapeHtml(j.notes) + '</div>' : ''}
    </div>
  \`;
}

document.getElementById('filter-persona').addEventListener('change', e => renderConvs(e.target.value));
document.getElementById('toggle-all').addEventListener('click', () => {
  const convs = document.querySelectorAll('.conv');
  const allOpen = Array.from(convs).every(c => c.classList.contains('open'));
  convs.forEach(c => c.classList.toggle('open', !allOpen));
});

renderSummary();
renderConvs('');
</script>
</body>
</html>
`;

writeFileSync(OUTPUT_PATH, HTML);
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`  대화 ${data.results.length}개 · 총 ${data.results.reduce((s, r) => s + r.turns.length, 0)} turn`);