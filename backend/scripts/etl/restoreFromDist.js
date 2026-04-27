/**
 * 팀 배포 번들(data/dist/) → 자기 환경 PostgreSQL + Chroma 복원
 *
 * 입력: data/dist/{places.jsonl, embeddings.jsonl, MANIFEST.json}
 * 출력: place 테이블 UPSERT + Chroma place_embeddings 컬렉션 UPSERT
 *
 * 멱등 — 중복 실행 안전.
 *
 * 실행:
 *   node scripts/etl/restoreFromDist.js
 *   node scripts/etl/restoreFromDist.js --reset-chroma   # 컬렉션 비우고 재적재
 */

require('dotenv').config();
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { upsertPlaceRows } = require('../../src/etl/loaders/postgresPlaceLoader');
const {
  upsertEmbeddings,
  resetCollection,
  countCollection,
  COLLECTION_NAME,
} = require('../../src/etl/loaders/chromaPlaceLoader');
const pool = require('../../src/config/db');

const DIST_DIR = 'data/dist';

function readJsonl(p) {
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const reset = process.argv.includes('--reset-chroma');
  const placesPath = path.join(DIST_DIR, 'places.jsonl');
  const embPath = path.join(DIST_DIR, 'embeddings.jsonl');
  const manifestPath = path.join(DIST_DIR, 'MANIFEST.json');

  if (!existsSync(placesPath) || !existsSync(embPath)) {
    throw new Error(`번들이 없습니다. ${DIST_DIR}/ 안에 places.jsonl, embeddings.jsonl 있어야 합니다.`);
  }

  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`[etl/restore] 번들: ${m.place_count}건, ${m.embedding_dim}d, ${m.embedding_model}, 생성 ${m.generated_at}`);
  }

  // 1) PostgreSQL 적재
  const places = readJsonl(placesPath);
  console.log(`[etl/restore] PostgreSQL UPSERT: ${places.length}건`);
  const idMap = await upsertPlaceRows(places); // [{place_id, tour_content_id}]
  const cidToPid = new Map(idMap.map((r) => [r.tour_content_id, r.place_id]));

  // tour_content_id → place 행 (Chroma 메타데이터용)
  const placeByCid = new Map(places.map((p) => [p.tour_content_id, p]));

  // 2) Chroma 적재
  if (reset) {
    console.log(`[etl/restore] Chroma 컬렉션 ${COLLECTION_NAME} 초기화`);
    await resetCollection();
  }

  const embRecords = readJsonl(embPath);
  const chromaRecords = [];
  let skipped = 0;
  for (const e of embRecords) {
    const pid = cidToPid.get(e.tour_content_id);
    const place = placeByCid.get(e.tour_content_id);
    if (!pid || !place) { skipped += 1; continue; }
    chromaRecords.push({
      place_id: pid,
      name: place.name,
      category: place.category,
      tour_content_id: e.tour_content_id,
      atmosphere_text: place.atmosphere_text || '',
      embedding: e.embedding,
    });
  }

  console.log(`[etl/restore] Chroma UPSERT: ${chromaRecords.length}건${skipped ? ` (skip ${skipped})` : ''}`);
  await upsertEmbeddings(chromaRecords);
  const total = await countCollection();
  console.log(`[etl/restore] 완료. Chroma 컬렉션 총 ${total}건`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('[etl/restore] 실패:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
