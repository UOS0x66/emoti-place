/**
 * PGlite 소켓 서버 (Postgres 미설치 환경 임시 검증용)
 *
 * @electric-sql/pglite (Postgres 16 WASM) + pglite-socket으로
 * 진짜 Postgres 와이어 프로토콜을 localhost:5433 에 노출.
 *
 * 기존 backend 코드는 그대로 (`pg.Pool` + DATABASE_URL) 사용.
 *
 * 실행:
 *   node scripts/etl/pgliteServer.js          # foreground
 *   PGDATA_DIR=./pgdata PORT=5433 node ...    # 옵션 변경
 *
 * 데이터 영속화: ./pgdata 디렉토리 (gitignore 처리됨)
 */

import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = Number(process.env.PGLITE_PORT || 5433);
const DATA_DIR = process.env.PGDATA_DIR || './pgdata';

async function main() {
  console.log(`[pglite] PGlite 초기화: ${DATA_DIR}`);
  const db = await PGlite.create({ dataDir: DATA_DIR });

  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: '127.0.0.1',
  });

  await server.start();
  console.log(`[pglite] 소켓 서버 가동: postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  console.log('[pglite] Ctrl+C 로 종료');

  const shutdown = async () => {
    console.log('\n[pglite] 종료 중...');
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('[pglite] 실패:', err); process.exit(1); });
