/**
 * Stage 2 — 환경 처방 서비스 래퍼.
 * src/llm/prescriptionGenerator를 호출. user.mbti와 대화 히스토리를 함께 전달.
 *
 * 추가: 사용자 발화에 명시적 카테고리 욕구 키워드가 있으면 LLM 추론보다 우선해서
 * category_hint 를 강제 override 한다 — LLM 의 temperature 분산으로 음식점 요청에
 * 카페·문화시설이 섞이는 회귀 차단.
 */

import { generatePrescription as generatePrescriptionLLM } from '../llm/prescriptionGenerator.js';
import { getSession } from './sessionService.js';
import pool from '../config/db.js';

// TourAPI contenttypeid: 12=관광지, 14=문화시설, 28=레포츠, 39=음식점 (카페 포함)
const FOOD_KEYWORDS = /점심|저녁|아침|식사|메뉴|맛집|맛있|먹|배고프|허기|한식|양식|중식|일식|분식|뷔페|술자리|안주|술 한|회식|디저트|카페|커피|차 한잔|차한잔|간식|브런치|음료/;
const SPORTS_KEYWORDS = /운동|등산|수영|클라이밍|러닝|조깅|헬스|요가|필라테스|액티비티|체험|땀\s*빼/;
const CULTURE_KEYWORDS = /전시|공연|영화|연극|뮤지컬|박물관|미술관|콘서트|갤러리|전시회/;
const TOUR_KEYWORDS = /산책|구경|둘러|풍경|관광|야경|뷰\s|뷰가|전망|거리\s*걷/;

function inferCategoryHintFromHistory(history) {
  if (!Array.isArray(history)) return null;
  // 최근 5개 user 발화만 본다 — 오래 전 발화의 영향 회피.
  const text = history
    .filter((m) => m.role === 'user')
    .slice(-5)
    .map((m) => m.content || '')
    .join(' ');
  if (!text.trim()) return null;
  if (FOOD_KEYWORDS.test(text)) return '39';
  if (SPORTS_KEYWORDS.test(text)) return '28';
  if (CULTURE_KEYWORDS.test(text)) return '14';
  if (TOUR_KEYWORDS.test(text)) return '12';
  return null;
}

/**
 * @param {string} sessionId
 * @returns {Promise<Object>} prescriptionGenerator 출력 (category_hint 사용자 키워드 우선 override)
 */
export async function generatePrescription(sessionId) {
  const session = await getSession(sessionId);
  if (!session.emotion_scores) {
    const err = new Error('감정 점수가 아직 추출되지 않았습니다.');
    err.status = 400;
    throw err;
  }

  let mbti = null;
  if (session.user_id) {
    const r = await pool.query('SELECT mbti FROM "user" WHERE user_id = $1', [session.user_id]);
    mbti = r.rows[0]?.mbti || null;
  }

  const history = session.conversation_history || [];
  const result = await generatePrescriptionLLM(session.emotion_scores, {
    conversationHistory: history,
    mbti: mbti || undefined,
  });

  // 사용자가 명시한 카테고리 욕구는 LLM 의 emotion/RAG 기반 추론보다 우선.
  // 점심·메뉴 등 음식 신호 → LLM 이 빈 카테고리/관광지로 빠져도 39 로 강제.
  const forced = inferCategoryHintFromHistory(history);
  if (forced && result.category_hint !== forced) {
    console.log(
      `[prescription] category_hint override: "${result.category_hint || ''}" → "${forced}" (사용자 키워드 기반)`
    );
    result.category_hint = forced;
    result.mbti_signals_applied = [
      ...(result.mbti_signals_applied || []),
      `category_forced:${forced}`,
    ];
  }

  return result;
}
