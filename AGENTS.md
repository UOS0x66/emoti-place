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
| 김현수 | 팀장 | 데이터 인프라, TourAPI 연동, Vector DB 인덱싱, 프롬프트 최적화 |
| 김강현 | 팀원 | **프론트엔드** (Flutter), UI/UX, 지도 연동 |
| 서형근 | 팀원 | 백엔드 아키텍처 설계, 테스트 데이터셋(Golden Set) 구축, 품질 검증 |
| 황수진 | 팀원 | **백엔드** 서버 개발, LLM 연동, 클라우드 배포 |

---

## 3. Work Boundaries (Important)

- **`frontend/` 폴더**: 김강현(프론트엔드)만 수정. 백엔드 개발자는 절대 수정하지 않는다.
- **`backend/` 폴더**: 황수진(백엔드)만 수정. 프론트엔드 개발자는 절대 수정하지 않는다.
- 이 규칙은 팀 합의 사항이므로 반드시 준수한다.

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

### Stage 1: 감정 분석
- 대화 히스토리에서 Plutchik 8감정(Joy, Trust, Fear, Surprise, Sadness, Disgust, Anger, Anticipation) 스코어를 0.0~1.0으로 추출
- RAG 지식: Plutchik(1980) 문헌

### Stage 2: 환경 니즈 도출
- 8감정 JSON → 심리학 RAG 검색 → 경험 처방 텍스트 + 추천 근거 생성
- RAG 지식: Gross(2015), BA(Martell 2010), ART(Kaplan 1989), SRT(Ulrich 1984), Comfort Food(Troisi & Gabriel 2011), Social Eating(Fischler 2011)

### Stage 3: 장소 매칭
- 경험 처방 텍스트를 임베딩 → Chroma `place_embeddings`에서 코사인 유사도 검색 → 상위 10개
- PostgreSQL에서 GPS 반경(5km, 부족 시 10km) + 영업시간 + 동행 인원 후처리 필터 → 최종 3~5개

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

**place_embeddings**
- `id=place_id`, `embedding=float[768]` (atmosphere_text 임베딩), `metadata={place_id, category}`

**psych_embeddings**
- `id=ref_id`, `embedding=float[768]` (source_text 임베딩), `metadata={theory, emotion_tags}`

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
- LLM 채팅 API 호출 (`POST /api/chat/message`) - 현재 mock 데이터 사용
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

- **백엔드 개발 언어**: JavaScript (Node.js + Express)
- `backend/` 폴더 안에서만 작업한다.
- `frontend/` 폴더는 읽기 전용으로 참고만 한다 (API 스펙 확인 등).
- API 응답 형식은 프론트엔드의 기대 형식과 일치시켜야 한다.
- LLM 응답은 SSE(Server-Sent Events) 스트리밍으로 구현한다.
- 환경 변수는 `.env` 파일로 관리한다 (API 키, DB 접속 정보 등).
- PostgreSQL + Chroma 두 DB를 함께 운영한다.
