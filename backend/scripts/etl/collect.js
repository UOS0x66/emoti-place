/**
 * 1단계: TourAPI → backend/data/raw/*.jsonl 덤프
 *
 * 실행:
 *   node scripts/etl/collect.js                              # 서울 전체, 4 카테고리
 *   node scripts/etl/collect.js --sigungu=dongdaemun         # 동대문구만
 *   node scripts/etl/collect.js --sigungu=11                 # 시군구코드 직접
 *   node scripts/etl/collect.js --category=restaurant        # 음식점만
 *   node scripts/etl/collect.js --sigungu=dongdaemun --category=restaurant --limit=50
 */

import 'dotenv/config';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TARGET_CONTENT_TYPES, AREA_CODE, SEOUL_SIGUNGU, fetchAreaBasedListAll, fetchPlaceFullDetails } from '../../src/etl/fetchers/tourApiClient.js';

const CATEGORY_ALIAS = {
  restaurant: { id: TARGET_CONTENT_TYPES.RESTAURANT, label: 'restaurant' },
  tourist:    { id: TARGET_CONTENT_TYPES.TOURIST_SPOT, label: 'tourist' },
  cultural:   { id: TARGET_CONTENT_TYPES.CULTURAL,    label: 'cultural' },
  leports:    { id: TARGET_CONTENT_TYPES.LEPORTS,     label: 'leports' },
};

function resolveSigungu(value) {
  if (value === undefined) return undefined;
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && asNum > 0) return asNum;
  const key = String(value).toUpperCase();
  if (SEOUL_SIGUNGU[key] !== undefined) return SEOUL_SIGUNGU[key];
  throw new Error(`알 수 없는 시군구: ${value}`);
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  const catArg = args.category;
  const categories = catArg
    ? [CATEGORY_ALIAS[catArg.toLowerCase()]].filter(Boolean)
    : Object.values(CATEGORY_ALIAS);
  if (catArg && categories.length === 0) {
    throw new Error(`알 수 없는 카테고리: ${catArg}`);
  }
  const limit = args.limit ? Number(args.limit) : Infinity;
  if (Number.isNaN(limit) || limit <= 0) throw new Error(`--limit 양수`);
  const sigunguCode = resolveSigungu(args.sigungu);
  return { categories, limit, sigunguCode };
}

async function collectCategory({ id, label }, areaCode, sigunguCode, limit) {
  const sigSuffix = sigunguCode ? `-sigungu${sigunguCode}` : '';
  const outPath = `data/raw/tour-${label}-area${areaCode}${sigSuffix}.jsonl`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, '');

  console.log(`\n[etl/collect] ${label} → ${outPath}`);
  let count = 0, failed = 0;
  const t0 = Date.now();

  for await (const item of fetchAreaBasedListAll({
    areaCode, sigunguCode, contentTypeId: id, numOfRows: 100,
  })) {
    if (count >= limit) break;
    let details = null;
    try {
      details = await fetchPlaceFullDetails(item.contentid, item.contenttypeid);
    } catch (err) {
      failed += 1;
      console.warn(`   [skip] ${item.contentid} ${item.title}: ${err.message}`);
    }
    const record = {
      contentid: item.contentid,
      contenttypeid: item.contenttypeid,
      list: item,
      common: details && details.common,
      intro: details && details.intro,
      info: details && details.info,
      _fetched_at: new Date().toISOString(),
    };
    await appendFile(outPath, JSON.stringify(record) + '\n');
    count += 1;
    if (count % 20 === 0) {
      console.log(`   ... ${count}건 (${((Date.now() - t0) / 1000).toFixed(1)}s, 실패 ${failed})`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`[etl/collect] ${label}: ${count}건 (실패 ${failed}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return { label, count, failed };
}

async function main() {
  const { categories, limit, sigunguCode } = parseArgs(process.argv);
  const areaCode = AREA_CODE.SEOUL;
  console.log(`[etl/collect] areaCode=${areaCode}${sigunguCode ? ` sigungu=${sigunguCode}` : ''}, categories=${categories.map((c) => c.label).join(',')}, limit=${limit === Infinity ? 'all' : limit}`);
  const results = [];
  for (const cat of categories) {
    results.push(await collectCategory(cat, areaCode, sigunguCode, limit));
  }
  console.log('\n[etl/collect] 결과:');
  for (const r of results) console.log(`   ${r.label.padEnd(12)} ${r.count}건 (실패 ${r.failed})`);
}

main().catch((err) => { console.error('[etl/collect] 실패:', err.message); process.exit(1); });
