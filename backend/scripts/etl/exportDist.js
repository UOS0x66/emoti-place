/**
 * 팀 배포용 데이터 번들 생성
 *
 * 입력: PostgreSQL `place` 테이블 + data/processed/embeddings.jsonl
 * 출력: data/dist/{places.jsonl, embeddings.jsonl, MANIFEST.json, README.md}
 *
 * 받은 팀원이 `npm run etl:restore` 한 번이면 자기 환경에 그대로 복원.
 *
 * 실행:
 *   node scripts/etl/exportDist.js
 */

require('dotenv').config();
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const pool = require('../../src/config/db');
const { EMBEDDING_MODEL, EMBEDDING_DIM } = require('../../src/etl/embedders/openaiEmbedder');

const DIST_DIR = 'data/dist';

async function main() {
  mkdirSync(DIST_DIR, { recursive: true });

  // 1) PostgreSQL place 테이블 → places.jsonl
  const { rows: places } = await pool.query(`
    SELECT
      tour_content_id, tour_content_type_id, name, category, address,
      lat, lng, operating_hours, photos, atmosphere_text,
      max_group_size, is_outdoor
    FROM place
    WHERE tour_content_id IS NOT NULL
    ORDER BY tour_content_id
  `);
  const placesPath = path.join(DIST_DIR, 'places.jsonl');
  writeFileSync(placesPath, places.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`[etl/export] places.jsonl: ${places.length}건 → ${placesPath}`);

  // 2) embeddings.jsonl 재구성 — place_id 의존성을 tour_content_id 키로 변환
  const embRaw = readFileSync('data/processed/embeddings.jsonl', 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // 이미 tour_content_id 들어있음 (embedAndIndex.js 가 백업 시 포함)
  const dimSampled = embRaw[0] && embRaw[0].embedding ? embRaw[0].embedding.length : null;
  const exported = embRaw
    .filter((r) => r.tour_content_id)
    .map((r) => ({ tour_content_id: r.tour_content_id, embedding: r.embedding }));
  const embPath = path.join(DIST_DIR, 'embeddings.jsonl');
  writeFileSync(embPath, exported.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`[etl/export] embeddings.jsonl: ${exported.length}건 → ${embPath}`);

  // 3) 시군구 분포 통계 — gu 추출은 JS에서 (PGlite regex 호환성)
  const distMap = {};
  for (const p of places) {
    const m = (p.address || '').match(/서울특별시\s+([가-힣]+구)/);
    const gu = m ? m[1] : '기타';
    distMap[gu] = distMap[gu] || {};
    distMap[gu][p.category] = (distMap[gu][p.category] || 0) + 1;
  }

  // 4) MANIFEST
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    place_count: places.length,
    embedding_count: exported.length,
    embedding_model: EMBEDDING_MODEL,
    embedding_dim: dimSampled || EMBEDDING_DIM,
    similarity: 'cosine',
    chroma_collection: 'place_embeddings',
    distribution_by_gu: distMap,
    schema_notes: {
      places_jsonl: 'tour_content_id 가 멱등 키. place_id 는 받는 측 DB가 발급.',
      embeddings_jsonl: 'tour_content_id 로 places.jsonl 와 조인.',
      idempotency: 'restoreFromDist.js 가 ON CONFLICT (tour_content_id) DO UPDATE 로 안전 적재.',
    },
  };
  const manifestPath = path.join(DIST_DIR, 'MANIFEST.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[etl/export] MANIFEST.json → ${manifestPath}`);

  // 5) README
  const readme = `# Emoti-Place 장소 데이터 번들

## 무엇이 들어있나
- \`places.jsonl\` — PostgreSQL \`place\` 테이블 행 (${places.length}건)
- \`embeddings.jsonl\` — Chroma \`place_embeddings\` 컬렉션 벡터 (${exported.length}건, ${dimSampled || EMBEDDING_DIM}차원, ${EMBEDDING_MODEL})
- \`MANIFEST.json\` — 메타데이터 (수집 범위, 모델, 생성 시각)

## 어떻게 복원하나
\`\`\`bash
cd backend
npm install
cp .env.example .env  # DATABASE_URL, OPENAI_API_KEY 채우기 (OpenAI 키는 복원만 하면 사용 안 함)
npm run init-db        # place 테이블 등 생성
npm run etl:migrate    # tour_content_id 컬럼/제약 추가
npm run etl:restore    # ★ 여기서 번들 적재 (PostgreSQL + Chroma)
\`\`\`

복원은 멱등합니다 — 중복 실행해도 안전. 기존 데이터는 \`tour_content_id\` 기준으로 갱신되고, 신규 \`tour_content_id\` 는 추가됩니다.

## Chroma 서버 필요
\`\`\`bash
pip install chromadb
chroma run --path ./chroma-data --port 8000
\`\`\`

## 검색 데모
\`\`\`bash
npm run etl:search -- "혼자 조용히 책 읽고 싶은 날"
npm run etl:search -- "친구들이랑 매콤한 한 끼" --category=음식점 -k 3
\`\`\`

## 재생성하려면 (선택)
다른 시군구 추가하거나 atmosphere_text 가공 로직 바꾸려면:
\`\`\`bash
npm run etl:run -- --sigungu=마포  # 마포구 추가 수집·적재·임베딩
npm run etl:export                 # 번들 재생성
\`\`\`

생성 시각: ${new Date().toISOString()}
`;
  writeFileSync(path.join(DIST_DIR, 'README.md'), readme);

  console.log('\n[etl/export] 완료. data/dist/ 디렉토리를 팀에 공유하세요.');
  await pool.end();
}

main().catch((err) => { console.error('[etl/export] 실패:', err); process.exit(1); });
