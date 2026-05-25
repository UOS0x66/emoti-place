# Emoti-Place 백엔드 셋업 가이드

코드 + API 키만 있으면 30분 안에 로컬에서 풀 흐름이 돌아갑니다. 데이터(Chroma + TourAPI raw)는 repo 안에 같이 들어있어서 별도 zip 없습니다.

---

## 0. 준비물

### 0.1 직접 발급 (또는 팀장에게 받기)
- `OPENAI_API_KEY` — **자기 거 발급 권장 (비용 발생)**. https://platform.openai.com/api-keys
- `TOUR_API_SERVICE_KEY` — TourAPI 재수집 안 할 거면 비워둬도 OK

### 0.2 시스템 요구사항
- **Node.js 18+** (https://nodejs.org)
- **Python 3.10+** + `pip install chromadb` (Chroma 서버용)
- (옵션) PostgreSQL 16 — 없으면 PGlite 자동 사용 (별도 설치 불필요)

---

## 1. 코드 받기

```powershell
git clone https://github.com/UOS0x66/emoti-place.git
cd emoti-place
git checkout front
```

> 작업 브랜치는 `front`입니다. `main` 아님.

---

## 2. 데이터 위치 확인

Chroma 벡터 DB와 TourAPI 원본은 repo 안에 같이 포함되어 있어서 별도 풀기 작업이 필요 없습니다.

```text
emoti-place/
├─ chroma-data/                 ← Chroma DB (place 1781 + psych 709)
└─ backend/
   └─ data/
      └─ raw/                   ← TourAPI 원본 jsonl 84개 (서울 24구)
```

확인:
```powershell
ls chroma-data           # chroma.sqlite3 + 컬렉션 폴더들
ls backend/data/raw      # tour-*.jsonl 84개
```

---

## 3. 백엔드 의존성 설치

```powershell
cd backend
npm install
```

`bcrypt`가 네이티브 컴파일 필요해서 처음엔 좀 걸립니다.

---

## 4. `.env` 작성

```powershell
copy .env.example .env
notepad .env
```

최소한 채울 것:
```ini
OPENAI_API_KEY=sk-...                # ← 본인 키
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
CHROMA_HOST=localhost
CHROMA_PORT=8000
JWT_SECRET=아무거나-긴-문자열
LLM_MODEL=gpt-4o-mini                # 감정/처방/추천사유 등 schema-bound JSON 단계
CHAT_MODEL=gpt-5                     # 페르소나 채팅 (instruction-following 중요해서 분리)
TOUR_API_SERVICE_KEY=                # 비워둬도 OK (raw 재수집할 일 없으면)
```

---

## 5. 의존 서비스 기동 (각각 새 PowerShell 창)

### 터미널 A — DB (PGlite, PG 미설치 환경 권장)
```powershell
cd C:\...\emoti-place\backend
npm run pglite
```
→ `[pglite] 소켓 서버 가동: postgresql://...:5433/postgres` 뜨면 OK

### 터미널 B — Chroma 벡터 DB

repo 안의 `chroma-data/` 를 가리키도록 띄웁니다. emoti-place 디렉토리에서:
```powershell
chroma run --path .\chroma-data --host localhost --port 8000
```
→ `Connect to Chroma at: http://localhost:8000` 뜨면 OK

> ⚠️ **path 가 repo 내부 `./chroma-data` 인지 꼭 확인.** 외부 위치를 가리키면 옛 데이터(819건)만 보이거나 빈 컬렉션이 떠서, 추천 카드 일부가 정보 없이 뜨거나 후보 풀이 좁아집니다.

---

## 6. 데이터베이스 초기화 (최초 1회)

새 PowerShell 창에서:
```powershell
cd C:\...\emoti-place\backend
npm run init-db          # 테이블 생성 (user/session/place/recommendation + feedback/saved 등)
npm run seed-personas    # 페르소나 3종 시드
npm run etl:load-places  # raw → PG place 1781건 UPSERT
```

마지막 명령 끝에 `PostgreSQL UPSERT: 1781건` 뜨면 정상.

> Chroma 도 같은 1781건 (`b29baa3` 커밋에 포함되어 있음). PG/Chroma 카운트가 비슷해야 추천 카드 정보가 정상으로 채워집니다.

---

## 7. 백엔드 서버 기동

```powershell
npm start
```
→ `[Emoti-Place] Server running on port 3000`

---

## 8. 동작 확인

브라우저 → **http://localhost:3000**

테스트 콘솔이 뜹니다.
1. **회원가입** (이메일/닉네임/비번 + 옵션 MBTI)
2. **페르소나 선택** (조폭 동생 / 논리 로봇 / 욕쟁이 할멈)
3. **채팅** 2~3턴 (감정 누적용)
4. **추천 요청** (좌표 자동/수동) → 장소 카드 5개

응답에 사진·거리·사유·8감정 점수·처방 7필드가 모두 차야 정상.

---

## 자주 나오는 에러

| 증상 | 원인 / 해결 |
|---|---|
| `ECONNREFUSED ::1:5432` 또는 `127.0.0.1:5433` | PGlite/PostgreSQL 안 떠있음 → 5단계 터미널 A |
| `ECONNREFUSED 127.0.0.1:8000` | Chroma 안 떠있음 → 5단계 터미널 B |
| `Collection not found: place_embeddings` | Chroma `--path` 경로 잘못. repo 안 `./chroma-data` 가리키는지 확인 |
| Chroma 카운트가 819 (1781이어야 함) | `--path` 가 repo 밖 옛 chroma-data 가리키는 중. `./chroma-data` 로 재기동 |
| `OPENAI_API_KEY 미설정` | `.env`에 키 안 채움 |
| 추천 카드에 사진/거리 없음 | `etl:load-places` 안 돌렸거나 PG가 비어있음. `psql`로 `SELECT COUNT(*) FROM place;` 확인 (1781) |
| `pgdata` 락 걸림 (PGlite 재시작 안 됨) | `backend/pgdata/` 폴더 통째로 삭제 후 `init-db`부터 다시 |
| MBTI가 추천에 안 반영 | 회원가입/PATCH로 MBTI 등록했는지 확인. 응답 `prescription.mbti_signals_applied` 비어있으면 user 테이블에 mbti NULL |

---

## 폴더 구조 (받은 후)

```text
emoti-place/                       ← git repo
├─ backend/                        ← 메인 작업 영역
│  ├─ src/
│  │  ├─ llm/                      # Stage 1/2/3 LLM 모듈
│  │  ├─ services/                 # auth, chat, emotion, prescription, recommend, feedback, saved
│  │  ├─ routes/                   # /api/* 엔드포인트
│  │  └─ etl/                      # raw → PG/Chroma 적재 파이프라인
│  ├─ scripts/                     # init-db, seedPersonas, etl/* 등
│  ├─ data/
│  │  ├─ raw/                      # TourAPI 원본 84개 jsonl (서울 24구, repo 포함)
│  │  └─ psych/processed/          # chunks.jsonl (Stage 1 RAG, repo 포함)
│  ├─ public/                      # 테스트 콘솔
│  ├─ pgdata/                      # PGlite Postgres 데이터 (자동 생성)
│  └─ .env                         # 본인 API 키
├─ chroma-data/                    # Chroma 벡터 DB (1781 places + 709 psych, repo 포함)
└─ frontend/                       # Flutter (별도 작업 영역)
```

---

## 변경 사항 요약 (front 브랜치에서 새로 추가된 것)

- 회원가입 시 MBTI 입력 (옵션) — `POST /api/auth/signup` body에 `mbti` 필드
- MBTI 변경 — `PATCH /api/auth/mbti`
- 처방·추천 응답에 `mbti_signals_applied` 포함 (디버그용)
- 페르소나 채팅 = **공감 대화 전용**. 장소 추천은 별도 `/api/recommend` 엔드포인트
- 테스트 웹 UI — `http://localhost:3000`에서 풀 흐름 검증 가능

자세한 변경 내역: `git log --oneline front`

---

문제 생기면 김현수에게 연락 주세요.
