/**
 * 2단계: data/raw/*.jsonl → atmosphere_text 가공 → PostgreSQL `place` 테이블 UPSERT
 *
 * 출력: data/processed/places-loaded.jsonl
 *   각 줄 = { place_id, tour_content_id, name, category, atmosphere_text }
 *   다음 단계(embedAndIndex.js)가 이 파일을 읽어 임베딩을 만든다.
 *
 * 실행:
 *   node scripts/etl/loadPlaces.js                 # data/raw 전체
 *   node scripts/etl/loadPlaces.js --sigungu=11    # 동대문구 파일만
 */

import 'dotenv/config';
import { readdir, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { buildAtmosphereText } from '../../src/etl/transformers/atmosphereBuilder.js';
import { mapToPlaceRow } from '../../src/etl/transformers/placeMapper.js';
import { upsertPlaceRows } from '../../src/etl/loaders/postgresPlaceLoader.js';
import { SEOUL_SIGUNGU } from '../../src/etl/fetchers/tourApiClient.js';
import pool from '../../src/config/db.js';

function resolveSigungu(value) {
  if (value === undefined) return undefined;
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && asNum > 0) return asNum;
  const key = String(value).toUpperCase();
  return SEOUL_SIGUNGU[key];
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const rawDir = 'data/raw';
  const outPath = 'data/processed/places-loaded.jsonl';
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, '');

  let files = (await readdir(rawDir)).filter((f) => f.endsWith('.jsonl'));
  if (args.sigungu) {
    const code = resolveSigungu(args.sigungu);
    if (code === undefined) throw new Error(`알 수 없는 시군구: ${args.sigungu}`);
    files = files.filter((f) => f.includes(`sigungu${code}`));
  }
  if (files.length === 0) {
    console.warn('[etl/loadPlaces] 변환할 파일이 없습니다.');
    return;
  }

  // raw → place row + atmosphere_text 통합
  const rows = [];
  const quality = { rich: 0, thin: 0, minimal: 0 };
  for (const file of files) {
    const lines = (await readFile(join(rawDir, file), 'utf8')).split('\n').filter(Boolean);
    console.log(`[etl/loadPlaces] ${file}: ${lines.length}건`);
    for (const line of lines) {
      const record = JSON.parse(line);
      const atm = buildAtmosphereText(record);
      const placeRow = mapToPlaceRow(record, atm.atmosphere_text);
      rows.push(placeRow);
      quality[atm.quality] += 1;
    }
  }

  console.log(`[etl/loadPlaces] PostgreSQL UPSERT: ${rows.length}건`);
  const ids = await upsertPlaceRows(rows);

  // 다음 단계로 넘길 정보 저장 (place_id ↔ tour_content_id 매핑 + atmosphere_text)
  let lines = '';
  for (let i = 0; i < rows.length; i++) {
    lines += JSON.stringify({
      place_id: ids[i].place_id,
      tour_content_id: ids[i].tour_content_id,
      name: rows[i].name,
      category: rows[i].category,
      atmosphere_text: rows[i].atmosphere_text,
    }) + '\n';
  }
  await appendFile(outPath, lines);

  console.log(`[etl/loadPlaces] 완료: ${rows.length}건 → ${outPath}`);
  console.log(`   품질: rich=${quality.rich}, thin=${quality.thin}, minimal=${quality.minimal}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[etl/loadPlaces] 실패:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
