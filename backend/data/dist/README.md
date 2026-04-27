# Emoti-Place 장소 데이터 번들

## 무엇이 들어있나
- `places.jsonl` — PostgreSQL `place` 테이블 행 (819건)
- `embeddings.jsonl` — Chroma `place_embeddings` 컬렉션 벡터 (819건, 768차원, text-embedding-3-small)
- `MANIFEST.json` — 메타데이터 (수집 범위, 모델, 생성 시각)

## 어떻게 복원하나
```bash
cd backend
npm install
cp .env.example .env  # DATABASE_URL, OPENAI_API_KEY 채우기 (OpenAI 키는 복원만 하면 사용 안 함)
npm run init-db        # place 테이블 등 생성
npm run etl:migrate    # tour_content_id 컬럼/제약 추가
npm run etl:restore    # ★ 여기서 번들 적재 (PostgreSQL + Chroma)
```

복원은 멱등합니다 — 중복 실행해도 안전. 기존 데이터는 `tour_content_id` 기준으로 갱신되고, 신규 `tour_content_id` 는 추가됩니다.

## Chroma 서버 필요
```bash
pip install chromadb
chroma run --path ./chroma-data --port 8000
```

## 검색 데모
```bash
npm run etl:search -- "혼자 조용히 책 읽고 싶은 날"
npm run etl:search -- "친구들이랑 매콤한 한 끼" --category=음식점 -k 3
```

## 재생성하려면 (선택)
다른 시군구 추가하거나 atmosphere_text 가공 로직 바꾸려면:
```bash
npm run etl:run -- --sigungu=마포  # 마포구 추가 수집·적재·임베딩
npm run etl:export                 # 번들 재생성
```

생성 시각: 2026-04-27T08:06:40.137Z
