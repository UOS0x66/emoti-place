/**
 * ETL 전체 오케스트레이터: collect → loadPlaces → embedAndIndex
 *
 * 사용 예:
 *   node scripts/etl/runEtl.js --sigungu=dongdaemun
 *   node scripts/etl/runEtl.js --sigungu=11 --reset-chroma
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

function run(scriptName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, scriptName), ...args], {
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${scriptName} exited ${code}`))
    );
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const passThrough = argv.filter((a) => !['--reset-chroma'].includes(a));
  const resetChroma = argv.includes('--reset-chroma');

  console.log('━━━ [1/3] collect ━━━');
  await run('collect.js', passThrough);

  console.log('\n━━━ [2/3] loadPlaces (PostgreSQL) ━━━');
  await run('loadPlaces.js', passThrough);

  console.log('\n━━━ [3/3] embedAndIndex (Chroma) ━━━');
  await run('embedAndIndex.js', resetChroma ? ['--reset'] : []);

  console.log('\n[etl/runEtl] 전체 완료.');
}

main().catch((err) => { console.error('[etl/runEtl] 실패:', err.message); process.exit(1); });
