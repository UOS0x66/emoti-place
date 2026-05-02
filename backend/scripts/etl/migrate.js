/**
 * ETL 멱등 적재용 마이그레이션
 *
 * place 테이블에 tour_content_id (UNIQUE), tour_content_type_id 컬럼 추가.
 * initDb.js 에 합치지 않은 이유: 백엔드 영역 침범 방지.
 *
 * 실행: node scripts/etl/migrate.js
 */

import 'dotenv/config';
import pool from '../../src/config/db.js';

async function main() {
  try {
    console.log('[etl/migrate] place 테이블 ETL 컬럼 추가 중...');

    await pool.query(`
      ALTER TABLE place
        ADD COLUMN IF NOT EXISTS tour_content_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tour_content_type_id VARCHAR(10);
    `);

    // 부분 인덱스가 있다면 정리 (ON CONFLICT 추론 불가)
    await pool.query(`DROP INDEX IF EXISTS place_tour_content_id_uniq;`);

    // UNIQUE 제약이 없으면 추가
    const { rows } = await pool.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'place_tour_content_id_uniq';
    `);
    if (rows.length === 0) {
      await pool.query(`
        ALTER TABLE place ADD CONSTRAINT place_tour_content_id_uniq UNIQUE (tour_content_id);
      `);
    }

    await pool.query(`CREATE INDEX IF NOT EXISTS place_category_idx ON place (category);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS place_is_outdoor_idx ON place (is_outdoor);`);

    console.log('[etl/migrate] 완료.');
  } catch (err) {
    console.error('[etl/migrate] 실패:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
