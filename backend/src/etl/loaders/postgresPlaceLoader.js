/**
 * place 테이블 적재기
 *
 * tour_content_id 를 멱등키로 사용해 UPSERT.
 * 마이그레이션 (tour_content_id UNIQUE 컬럼 추가) 선행 필요:
 *   node scripts/etl/migrate.js
 */

const pool = require('../../config/db');

async function upsertPlaceRows(rows) {
  if (rows.length === 0) return [];
  const ids = [];
  for (const r of rows) {
    const result = await pool.query(
      `
      INSERT INTO place
        (name, category, address, lat, lng, operating_hours, photos,
         atmosphere_text, max_group_size, is_outdoor,
         tour_content_id, tour_content_type_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (tour_content_id) DO UPDATE SET
        name             = EXCLUDED.name,
        category         = EXCLUDED.category,
        address          = EXCLUDED.address,
        lat              = EXCLUDED.lat,
        lng              = EXCLUDED.lng,
        operating_hours  = EXCLUDED.operating_hours,
        photos           = EXCLUDED.photos,
        atmosphere_text  = EXCLUDED.atmosphere_text,
        max_group_size   = EXCLUDED.max_group_size,
        is_outdoor       = EXCLUDED.is_outdoor,
        updated_at       = NOW()
      RETURNING place_id, tour_content_id
      `,
      [
        r.name,
        r.category,
        r.address,
        r.lat,
        r.lng,
        r.operating_hours ? JSON.stringify(r.operating_hours) : null,
        r.photos || [],
        r.atmosphere_text,
        r.max_group_size,
        !!r.is_outdoor,
        r.tour_content_id,
        r.tour_content_type_id,
      ]
    );
    ids.push(result.rows[0]);
  }
  return ids;
}

module.exports = { upsertPlaceRows };
