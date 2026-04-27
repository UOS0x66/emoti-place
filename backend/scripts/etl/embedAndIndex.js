/**
 * 3단계: places-loaded.jsonl → OpenAI 임베딩(768d) → Chroma `place_embeddings` UPSERT
 *
 * 실행:
 *   node scripts/etl/embedAndIndex.js
 *   node scripts/etl/embedAndIndex.js --reset   # 컬렉션 초기화 후 재적재
 */

require('dotenv').config();
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { embedBatched, EMBEDDING_MODEL, EMBEDDING_DIM } = require('../../src/etl/embedders/openaiEmbedder');
const {
  upsertEmbeddings,
  resetCollection,
  countCollection,
  COLLECTION_NAME,
} = require('../../src/etl/loaders/chromaPlaceLoader');

async function main() {
  const reset = process.argv.includes('--reset');

  const inPath = 'data/processed/places-loaded.jsonl';
  const records = readFileSync(inPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  console.log(`[etl/embedAndIndex] ${records.length}건 입력 (${inPath})`);
  console.log(`[etl/embedAndIndex] 모델: ${EMBEDDING_MODEL} (${EMBEDDING_DIM}d)`);

  if (reset) {
    console.log(`[etl/embedAndIndex] 컬렉션 ${COLLECTION_NAME} 초기화`);
    await resetCollection();
  }

  const texts = records.map((r) => r.atmosphere_text);
  const t0 = Date.now();
  const embeddings = await embedBatched(texts);
  console.log(`[etl/embedAndIndex] 임베딩 완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const chromaRecords = records.map((r, i) => ({
    place_id: r.place_id,
    name: r.name,
    category: r.category,
    tour_content_id: r.tour_content_id,
    atmosphere_text: r.atmosphere_text,
    embedding: embeddings[i],
  }));

  await upsertEmbeddings(chromaRecords);
  const total = await countCollection();
  console.log(`[etl/embedAndIndex] Chroma 적재 완료, 컬렉션 총 ${total}건`);

  // 임베딩 백업 (재인덱싱 시 OpenAI 재호출 안 하도록)
  const backupPath = 'data/processed/embeddings.jsonl';
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(
    backupPath,
    chromaRecords.map((r) => JSON.stringify({
      place_id: r.place_id,
      tour_content_id: r.tour_content_id,
      name: r.name,
      embedding: r.embedding,
    })).join('\n') + '\n'
  );
  console.log(`[etl/embedAndIndex] 임베딩 백업 → ${backupPath}`);
}

main().catch((err) => { console.error('[etl/embedAndIndex] 실패:', err.message); process.exit(1); });
