/**
 * 일회성 백필 스크립트.
 * 이미 적재된 place 행의 summary_text가 비어있을 때,
 * atmosphere_text로부터 buildSummaryText 휴리스틱으로 짧은 요약을 채운다.
 *
 * 멱등: summary_text가 이미 채워진 행은 건드리지 않는다.
 *
 * 실행: node scripts/etl/backfillSummaryText.js
 */

import 'dotenv/config';
import pool from '../../src/config/db.js';
import { buildSummaryText } from '../../src/etl/transformers/atmosphereBuilder.js';

async function main() {
  const { rows } = await pool.query(
    `SELECT place_id, name, atmosphere_text
       FROM place
      WHERE summary_text IS NULL OR summary_text = ''`
  );
  console.log(`[backfill] 대상: ${rows.length}건`);

  let updated = 0;
  for (const r of rows) {
    const summary = buildSummaryText({
      overview: '',
      atmosphereText: r.atmosphere_text || '',
      fallbackTitle: r.name || '',
    });
    if (!summary) continue;
    await pool.query(
      `UPDATE place SET summary_text = $1 WHERE place_id = $2`,
      [summary, r.place_id]
    );
    updated += 1;
  }
  console.log(`[backfill] 갱신: ${updated}건`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
