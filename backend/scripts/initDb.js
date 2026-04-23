require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const DDL = `
-- 사용자 테이블
CREATE TABLE IF NOT EXISTS "user" (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nickname VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 페르소나 테이블
CREATE TABLE IF NOT EXISTS persona (
  persona_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  system_prompt TEXT NOT NULL,
  tone_keywords TEXT[] DEFAULT '{}',
  forbidden_words TEXT[] DEFAULT '{}'
);

-- 세션 테이블
CREATE TABLE IF NOT EXISTS session (
  session_id UUID PRIMARY KEY,
  user_id UUID REFERENCES "user"(user_id),
  persona_id INTEGER REFERENCES persona(persona_id),
  emotion_scores JSONB,
  prescription_text TEXT,
  psych_rationale TEXT,
  conversation_history JSONB DEFAULT '[]',
  energy_level VARCHAR(20) DEFAULT 'MEDIUM',
  companion VARCHAR(20) DEFAULT 'ALONE',
  activity_preference VARCHAR(20) DEFAULT 'STATIC',
  time_preference VARCHAR(20) DEFAULT 'NONE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- 장소 테이블
CREATE TABLE IF NOT EXISTS place (
  place_id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  operating_hours JSONB,
  photos TEXT[] DEFAULT '{}',
  atmosphere_text TEXT,
  max_group_size INTEGER,
  is_outdoor BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 심리학 문헌 테이블
CREATE TABLE IF NOT EXISTS psych_reference (
  ref_id SERIAL PRIMARY KEY,
  theory VARCHAR(100),
  source_text TEXT,
  emotion_tags TEXT[] DEFAULT '{}',
  environment_recommendation TEXT
);

-- 추천 이력 테이블
CREATE TABLE IF NOT EXISTS recommendation (
  rec_id SERIAL PRIMARY KEY,
  session_id UUID REFERENCES session(session_id),
  place_id INTEGER REFERENCES place(place_id),
  semantic_similarity DOUBLE PRECISION,
  prescription_text TEXT,
  persona_reason TEXT,
  psych_rationale TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function main() {
  try {
    console.log('데이터베이스 테이블 생성 중...');
    await pool.query(DDL);
    console.log('테이블 생성 완료!');
  } catch (err) {
    console.error('테이블 생성 실패:', err.message);
  } finally {
    await pool.end();
  }
}

main();
