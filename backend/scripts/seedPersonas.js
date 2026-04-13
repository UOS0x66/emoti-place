require('dotenv').config();
const { Pool } = require('pg');
const PERSONAS = require('../src/prompts/personas');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  try {
    console.log('페르소나 데이터 시드 중...');

    for (const [id, persona] of Object.entries(PERSONAS)) {
      await pool.query(
        `INSERT INTO persona (persona_id, name, system_prompt, tone_keywords, forbidden_words)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (persona_id) DO UPDATE SET
           name = EXCLUDED.name,
           system_prompt = EXCLUDED.system_prompt,
           tone_keywords = EXCLUDED.tone_keywords,
           forbidden_words = EXCLUDED.forbidden_words`,
        [
          Number(id),
          persona.name,
          persona.system_prompt,
          persona.tone_keywords,
          persona.forbidden_words,
        ]
      );
      console.log(`  ✓ ${persona.name} (ID: ${id})`);
    }

    console.log('페르소나 시드 완료!');
  } catch (err) {
    console.error('시드 실패:', err.message);
  } finally {
    await pool.end();
  }
}

main();
