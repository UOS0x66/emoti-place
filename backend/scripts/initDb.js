import 'dotenv/config';
import { Pool } from 'pg';

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
  mbti CHAR(4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_mbti_format
    CHECK (mbti IS NULL OR mbti ~ '^[EI][SN][TF][JP]$')
);

-- 기존 user 테이블이 이미 있을 경우 mbti 컬럼만 추가
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mbti CHAR(4);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'user_mbti_format'
  ) THEN
    BEGIN
      ALTER TABLE "user" ADD CONSTRAINT user_mbti_format
        CHECK (mbti IS NULL OR mbti ~ '^[EI][SN][TF][JP]$');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

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
  tour_content_id VARCHAR(50) UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  contenttypeid VARCHAR(10),
  cat3 VARCHAR(20),
  sigungucode INTEGER,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  operating_hours JSONB,
  photos TEXT[] DEFAULT '{}',
  atmosphere_text TEXT,
  summary_text VARCHAR(200),
  max_group_size INTEGER,
  is_outdoor BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 place 테이블에 tour_content_id 등 누락 컬럼 추가
ALTER TABLE place ADD COLUMN IF NOT EXISTS tour_content_id VARCHAR(50);
ALTER TABLE place ADD COLUMN IF NOT EXISTS contenttypeid VARCHAR(10);
ALTER TABLE place ADD COLUMN IF NOT EXISTS cat3 VARCHAR(20);
ALTER TABLE place ADD COLUMN IF NOT EXISTS sigungucode INTEGER;
ALTER TABLE place ADD COLUMN IF NOT EXISTS summary_text VARCHAR(200);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'place_tour_content_id_key'
  ) THEN
    BEGIN
      ALTER TABLE place ADD CONSTRAINT place_tour_content_id_key UNIQUE (tour_content_id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

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

-- 사용자 장소 피드백 (개인화 추천 — LIKE 임베딩 평균을 선호 벡터로 사용)
CREATE TABLE IF NOT EXISTS user_place_feedback (
  user_id UUID NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
  rating VARCHAR(10) NOT NULL CHECK (rating IN ('LIKE', 'DISLIKE')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_user_place_feedback_user_rating
  ON user_place_feedback(user_id, rating);

-- 사용자 보관함 (계정별로 추천 받은 장소 모아두기)
CREATE TABLE IF NOT EXISTS user_saved_place (
  user_id UUID NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
  persona_reason TEXT,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_user_saved_place_user_saved
  ON user_saved_place(user_id, saved_at DESC);
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
