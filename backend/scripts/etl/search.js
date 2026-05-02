/**
 * 운영 흐름 시뮬: Chroma 시맨틱 검색 → PostgreSQL 운영조건 조인.
 *
 * 사용법:
 *   node scripts/etl/search.js "혼자 조용히 책 읽기 좋은 곳"
 *   node scripts/etl/search.js "매콤한 한 끼" --category=음식점
 *   node scripts/etl/search.js "가족 산책" --outdoor=true -k 3
 *
 * 옵션:
 *   --category=한식|음식점|카페|문화공간|...
 *   --outdoor=true|false
 *   -k, --k  결과 개수 (기본 5)
 */

import 'dotenv/config';
import pool from '../../src/config/db.js';
import chroma from '../../src/config/chroma.js';
import { embedTexts } from '../../src/etl/embedders/openaiEmbedder.js';

function parseCli(argv) {
  const args = { query: [], k: 5, where: null, outdoor: undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--category=')) args.where = { category: a.split('=')[1] };
    else if (a.startsWith('--outdoor=')) args.outdoor = a.split('=')[1] === 'true';
    else if (a === '-k' || a === '--k') args.k = Number(argv[++i]);
    else if (a.startsWith('--k=')) args.k = Number(a.split('=')[1]);
    else args.query.push(a);
  }
  args.query = args.query.join(' ').trim();
  return args;
}

async function main() {
  const { query, k, where, outdoor } = parseCli(process.argv);
  if (!query) {
    console.error('사용법: node scripts/etl/search.js "쿼리" [--category=음식점] [--outdoor=true] [-k 5]');
    process.exit(1);
  }
  console.log('🔍 쿼리:', query);
  if (where) console.log('   메타필터:', JSON.stringify(where));
  if (outdoor !== undefined) console.log('   야외 필터:', outdoor);

  const [emb] = await embedTexts([query]);
  const collection = await chroma.getCollection({ name: 'place_embeddings' });
  // 야외 필터까지 보려면 후보를 넉넉히 가져와서 후처리
  const fetchN = outdoor !== undefined ? Math.max(k * 10, 50) : k;
  const res = await collection.query({ queryEmbeddings: [emb], nResults: fetchN, where });

  const ids = res.ids[0].map(Number);
  const dists = res.distances[0];

  const placeholders = ids.map((_, i) => '$' + (i + 1)).join(',');
  const db = await pool.query(
    `SELECT place_id, name, category, address, operating_hours, is_outdoor, max_group_size
     FROM place WHERE place_id IN (${placeholders})`,
    ids
  );
  const byId = new Map(db.rows.map((r) => [r.place_id, r]));

  let hits = ids.map((id, i) => ({ ...byId.get(id), sim: 1 - dists[i] }));
  if (outdoor !== undefined) hits = hits.filter((h) => h.is_outdoor === outdoor);
  hits = hits.slice(0, k);

  console.log('\n━━━ 결과 ━━━');
  if (hits.length === 0) console.log('(없음)');
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const hrs = h.operating_hours ? `${h.operating_hours.open || '?'}~${h.operating_hours.close || '?'}` : '시간정보 없음';
    console.log(
      `\n[${i + 1}] sim=${h.sim.toFixed(4)}  ${h.name}` +
      `\n    ${h.category} | ${h.is_outdoor ? '야외' : '실내'} | 운영 ${hrs} | 최대 ${h.max_group_size}명` +
      `\n    ${h.address}`
    );
  }
  await pool.end();
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
