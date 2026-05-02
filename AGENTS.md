# AGENTS.md - Emoti-Place Project Guide

## 1. Project Overview

**Emoti-Place** (감정 기반 공감 대화 & 장소 추천 서비스)는 사용자의 감정 상태를 AI 페르소나와의 대화를 통해 분석하고, 심리학적 근거에 기반하여 최적의 장소를 추천하는 **모바일 앱** 서비스이다.

- **팀명**: 0X66
- **개발 기간**: 2026년 3월 ~ 2026년 6월 (4개월)
- **지도교수**: 유하진 교수 (서울시립대학교 컴퓨터과학부)

---

## 2. Team & Roles

| 이름 | 역할 | 담당 |
|------|------|------|
| 김현수 | 팀장 | 데이터 인프라, TourAPI 연동, Vector DB 인덱싱, 프롬프트 최적화, **백엔드 통합 (인계받음)** |
| 김강현 | 팀원 | **프론트엔드** (Flutter), UI/UX, 지도 연동 |
| 서형근 | 팀원 | 테스트 데이터셋(Golden Set) 구축, 품질 검증 |
| 황수진 | 팀원 | (백엔드 인계) |

---

## 3. Work Boundaries (Important)

- **`frontend/` 폴더**: 김강현(프론트엔드)만 수정.
- **`backend/` 폴더**: 김현수(팀장)가 통합 책임. ETL/LLM 모듈 + Express API 서버 일원화.
- 상위 `src/` 폴더: archive 상태 (backend로 모듈 이전 완료 — `backend/src/llm/`, `backend/src/etl/`).

---

## 4. Tech Stack

### Frontend (김강현 담당 - 참고용)
- **Framework**: Flutter (Dart)
- **지도**: Naver Map (`flutter_naver_map`)
- **상태관리**: 현재 `setState` (추후 Provider/Bloc 도입 가능)
- **주요 패키지**: `flutter_svg`, `geolocator`, `permission_handler`, `flutter_dotenv`

### Backend (황수진 담당 - 개발 대상)
- **Runtime**: Node.js
- **Framework**: Express
- **Database (RDB)**: PostgreSQL 16
- **Database (Vector)**: Chroma 0.5+
- **LLM**: Claude API / GPT-4
- **Embedding**: OpenAI text-embedding-3-small (768차원)
- **RAG Pipeline**: LangChain
- **배포**: AWS EC2 (t3.medium)

---

## 5. System Architecture (3-Stage Pipeline)

```
[사용자] → [Flutter App] → [백엔드 API: Node.js + Express]
                                      ↓
                          [LLM: 페르소나 응답 생성 (스트리밍)]
                                      ↓ 대화 종료 / 추천 요청
                    [1단계] 감정 이론 RAG AI → Plutchik 8감정 JSON 추출
                                      ↓
                    [2단계] 감정 관리 이론 RAG AI → 경험 처방 텍스트 생성
                                      ↓
                    [3단계] Embedding → Chroma 시맨틱 검색 → PostgreSQL 후처리 필터
                                      ↓
                          [추천 결과 + 심리학적 사유] → Flutter App
```

### Stage 1: 감정 분석 — **백엔드 통합 완료**
- 모듈: `backend/src/llm/emotionExtractor.js` — `extractEmotionScores(history)` → 8감정 JSON
- 서비스 래퍼: `backend/src/services/emotionService.js`
- LLM: OpenAI `gpt-4o-mini` + structured outputs

### Stage 2: 환경 니즈 도출 — **백엔드 통합 완료 (MBTI 컨텍스트 포함)**
- 모듈: `backend/src/llm/prescriptionGenerator.js` — `generatePrescription(scores, {conversationHistory, mbti})`
- 서비스 래퍼: `backend/src/services/prescriptionService.js` — sessionId로 user.mbti 조회 후 주입
- 반환: `{prescription_text, psych_rationale, referenced_theories, category_hint, keywords_must, keywords_avoid, mbti_signals_applied}`

### Stage 3: 장소 매칭 — **백엔드 통합 완료 (PG join + GPS 필터 포함)**
- 모듈: `backend/src/llm/placeRecommender.js` — Chroma 검색 + 키워드 부스트
- 서비스 래퍼: `backend/src/services/recommendService.js` — Chroma 후보 → PG `place` join → GPS 거리 필터 → 페르소나 사유

---

## 6. Backend API Endpoints

| Method | Endpoint | 입력 | 출력 |
|--------|----------|------|------|
| POST | `/api/session/create` | `{persona_id}` | `{session_id, greeting_message}` |
| POST | `/api/chat/message` | `{session_id, message}` | `{persona_response (stream), emotion_scores}` |
| GET | `/api/emotion/{session_id}` | - | `{plutchik_8_scores, energy, companion, ...}` |
| POST | `/api/recommend` | `{session_id, lat, lng}` | `{places: [{place_id, name, photo, distance, reason, psych_rationale, similarity}], map_data}` |
| POST | `/api/recommend/refresh` | `{session_id, lat, lng}` | `{next_batch_places}` |

- LLM 응답은 **SSE 스트리밍** 방식으로 실시간 출력 (첫 토큰 <= 3초 목표)

---

## 7. Database Schema

### PostgreSQL Tables

**persona**
- `persona_id` (PK), `name`, `system_prompt`, `tone_keywords[]`, `forbidden_words[]`

**session**
- `session_id` (UUID PK), `persona_id` (FK), `emotion_scores` (JSONB), `prescription_text`, `psych_rationale`, `conversation_history` (JSONB), `energy_level`, `companion`, `activity_preference`, `time_preference`, `expires_at`

**place**
- `place_id` (PK), `name`, `category`, `address`, `lat`, `lng`, `operating_hours` (JSONB), `photos[]`, `atmosphere_text`, `max_group_size`, `is_outdoor`, `updated_at`

**psych_reference**
- `ref_id` (PK), `theory`, `source_text`, `emotion_tags[]`, `environment_recommendation`

**recommendation**
- `rec_id` (PK), `session_id` (FK), `place_id` (FK), `semantic_similarity`, `prescription_text`, `persona_reason`, `psych_rationale`, `created_at`

### Chroma Collections

**place_embeddings** (구축 완료, 819건 / 2026-05 기준)
- `id=contentid` (TourAPI contentid, 향후 PG `place_id`와 1:1 매핑 예정)
- `embedding=float[768]` (atmosphere_text 임베딩, `text-embedding-3-small` + `dimensions=768`)
- `metadata={contenttypeid, sigungucode, cat3, title}` — 사전 필터(카테고리/지역)에 사용
- 거리: 코사인. 적재 스크립트: `scripts/load-to-chroma.js`

**psych_embeddings** (구축 완료, 709청크 / 2026-05 기준)
- `id=ref_id` (예: `behavioral_activation_72`)
- `embedding=float[768]` (source_text 임베딩 — 청크 본문 앞에 `[theory, emotions: ...]` 헤더 prepend 후 임베딩)
- `metadata={theory, primary_emotion, emotion_tags, source_pdf, chunk_idx}`
- 소스: `papers/` 폴더의 PDF 6종 (709청크 분포)
  - behavioral_activation: 224 (Dimidjian 2011 / 우울증 → 행동활성화)
  - gross_emotion_regulation: 184 (Gross 2015 / 감정 조절 전반)
  - stress_recovery_theory: 152 (Ulrich 1984 / 스트레스 회복)
  - attention_restoration_theory: 94 (Kaplan 1989 / 주의 회복)
  - comfort_food_belonging: 51 (Troisi & Gabriel 2011 / 컴포트 푸드)
  - plutchik_basic_emotions: 4 (Plutchik 1980 / 8감정 분류)
- 적재 스크립트: `scripts/build-psych-index.js`

---

## 8. Personas (3종)

| 페르소나 | 설명 | 악센트 색상 |
|----------|------|------------|
| 의리 있는 조폭 동생 | 거친 말투지만 따뜻한 형/누나 캐릭터 | `#C8A020` (Gold) |
| 냉철한 논리 로봇 | 논리적이고 차가운 분석가 캐릭터 | `#00E5FF` (Cyan) |
| 푸근한 할멈 | 따뜻하고 푸근한 할머니 캐릭터 | `#E8762A` (Orange) |

---

## 9. Frontend Current Status (참고용 - 수정 금지)

### 구현 완료
- Splash, Login, Signup, Permission, PersonaSelection, Chat, Map 화면 UI
- Naver Map 연동 (마커 + 장소 정보 패널)
- 위치 권한 처리
- PlaceCard 위젯 (장소 추천 카드)

### 미구현 (백엔드 API 연동 대기)
- 로그인/회원가입 API 호출
- 세션 생성 API 호출 (`POST /api/session/create`)
- LLM 채팅 API 호출 (`POST /api/chat/message`) 
- 장소 추천 API 호출 (`POST /api/recommend`)
- 사용자 인증 토큰 관리

### 프론트엔드 파일 구조
```
frontend/lib/
├── main.dart
├── screens/
│   ├── splash_screen.dart
│   ├── permission_screen.dart
│   ├── login_screen.dart
│   ├── signup_screen.dart
│   ├── persona_selection_screen.dart
│   ├── chat_screen.dart
│   └── map_screen.dart
└── widgets/
    └── place_card.dart
```

---

## 10. External APIs & Services

| 서비스 | 용도 | 비고 |
|--------|------|------|
| Claude API / GPT-4 | LLM 추론 (페르소나 응답, 감정 추출, 추천 사유) | 주 엔진 |
| OpenAI Embedding API | text-embedding-3-small, 768차원 벡터 변환 | 경험 처방 + 장소 임베딩 |
| TourAPI (공공데이터포털) | 장소 데이터 수집 | 무료 |
| Naver Map API | 프론트엔드 지도 표시 | 프론트엔드에서 사용 |

---

## 11. Quality Targets

| 항목 | 목표치 | 비중 |
|------|--------|------|
| 감정 파라미터 추출 정확도 (F1-Score) | >= 0.85 | 25% |
| 장소 추천 정합성 (상위 3개 정답률) | >= 60% | 35% |
| 페르소나 어투 일관성 | >= 95% | 15% |
| 사용자 경험 만족도 (5점 만점) | >= 4.2 | 25% |
| LLM 첫 토큰 응답 시간 | <= 3초 | - |
| 추천 사유 심리학 근거 포함율 | >= 90% | - |

---

## 12. Development Guidelines

- **백엔드 개발 언어**: JavaScript (Node.js + Express, ESM)
- 백엔드 진입점: `cd emoti-place/backend && npm start`
- 로컬 PG 미설치 환경: `npm run pglite` 로 `127.0.0.1:5433`에 PGlite 소켓 서버 기동
- Chroma 데이터는 상위 `chroma-data/`에 위치 — `chroma run --path "C:/Ai/files (1)/chroma-data" --host localhost --port 8000`
- `frontend/` 폴더는 읽기 전용으로 참고만 한다 (API 스펙 확인 등).
- API 응답 형식은 프론트엔드의 기대 형식과 일치시켜야 한다.
- LLM 응답은 SSE(Server-Sent Events) 스트리밍으로 구현한다.
- 환경 변수는 `backend/.env` 파일로 관리한다.
