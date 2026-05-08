/**
 * /api/recommend 메인 서비스 — Stage 1→2→3 풀 파이프라인 + 페르소나 사유.
 *
 * 흐름:
 *   1) 세션 조회 (대화 히스토리 + user_id)
 *   2) Stage 1: extractEmotions(sessionId)
 *   3) Stage 2: generatePrescription(sessionId) — user.mbti 자동 조회
 *   4) Stage 3: recommendPlaces(prescription) — Chroma + 키워드 부스트
 *   5) PG place join + GPS 거리 필터 (5km, 부족시 10km)
 *   6) 페르소나 말투의 추천 사유 생성 (reason.js)
 *   7) recommendation 이력 저장 + 응답
 */

import openai from '../config/openai.js';
import pool from '../config/db.js';
import { getSession, updateSession } from './sessionService.js';
import { extractEmotions } from './emotionService.js';
import { generatePrescription } from './prescriptionService.js';
import { recommendPlaces, computePreferenceAlpha } from '../llm/placeRecommender.js';
import { buildReasonPrompt } from '../prompts/reason.js';
import { buildUserPreference } from './feedbackService.js';
import { haversineKm } from '../utils/geo.js';

const REASON_MODEL = process.env.REASON_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';
const TYPE_LABEL = { '12': '관광지', '14': '문화시설', '28': '레포츠', '39': '음식점' };

export async function recommend(sessionId, lat, lng) {
  const session = await getSession(sessionId);

  let emotionScores = session.emotion_scores;
  if (!emotionScores) emotionScores = await extractEmotions(sessionId);

  const prescription = await generatePrescription(sessionId);
  await updateSession(sessionId, {
    prescription_text: prescription.prescription_text,
    psych_rationale: prescription.psych_rationale,
  });

  const pref = await buildUserPreference(session.user_id);
  const personalization = {
    n_likes: pref.nLikes,
    pref_alpha: computePreferenceAlpha(pref.nLikes),
    excluded_dislikes: pref.dislikedTourIds.length,
  };
  const candidates = await recommendPlaces(prescription, {
    nResults: 10,
    preferenceVector: pref.preferenceVector,
    nLikes: pref.nLikes,
    excludeIds: pref.dislikedTourIds,
  });
  if (candidates.length === 0) return emptyResult(emotionScores, prescription, personalization);

  // Chroma의 contentid → PG의 tour_content_id 매핑
  const tourIds = candidates.map((c) => String(c.id));
  const dbResult = await pool.query(
    `SELECT * FROM place WHERE tour_content_id = ANY($1::varchar[])`,
    [tourIds]
  );
  const byTourId = new Map(dbResult.rows.map((r) => [String(r.tour_content_id), r]));

  const enriched = candidates.map((c) => {
    const pg = byTourId.get(String(c.id));
    if (pg) {
      return {
        ...pg,
        atmosphere_text: pg.atmosphere_text || c.atmosphere_text,
        chroma_score: c.score,
        chroma_base_similarity: c.base_similarity,
        chroma_must_hits: c.must_hits,
        category_label: TYPE_LABEL[c.contenttypeid] || pg.category || '',
        distance_km: (pg.lat != null && pg.lng != null)
          ? haversineKm(lat, lng, Number(pg.lat), Number(pg.lng))
          : null,
      };
    }
    return {
      place_id: null,
      tour_content_id: c.id,
      name: c.title,
      category: c.cat3,
      address: null,
      lat: null,
      lng: null,
      operating_hours: null,
      photos: [],
      atmosphere_text: c.atmosphere_text,
      chroma_score: c.score,
      chroma_base_similarity: c.base_similarity,
      chroma_must_hits: c.must_hits,
      category_label: TYPE_LABEL[c.contenttypeid] || '',
      distance_km: null,
    };
  });

  // GPS 5km 필터, 부족하면 10km, 좌표 없는 건 통과
  const within5 = enriched.filter((p) => p.distance_km == null || p.distance_km <= 5);
  let filtered = within5.length >= 3
    ? within5
    : enriched.filter((p) => p.distance_km == null || p.distance_km <= 10);
  if (filtered.length === 0) filtered = enriched;

  // chroma_score 내림차순 정렬 후 카테고리 다양성 적용.
  // 같은 카테고리가 최대 2개까지만 상위 결과에 들어가도록 라운드-로빈식으로 픽.
  // 분산 후 5개를 못 채우면(카테고리 풀이 너무 좁음) overflow에서 점수순으로 보충.
  filtered.sort((a, b) => (b.chroma_score ?? 0) - (a.chroma_score ?? 0));
  const TOP_N = 5;
  const PER_CATEGORY_LIMIT = 2;
  const top = [];
  const overflow = [];
  const categoryCount = new Map();
  for (const p of filtered) {
    // 다양성 키는 PG의 세밀한 category를 우선 (카페 vs 음식점 vs 주점 분리).
    // category_label은 contenttypeid 4개로 너무 거칠어 모두 같은 그룹으로 묶임.
    const cat = p.category || p.category_label || '기타';
    const c = categoryCount.get(cat) || 0;
    if (c < PER_CATEGORY_LIMIT && top.length < TOP_N) {
      top.push(p);
      categoryCount.set(cat, c + 1);
    } else {
      overflow.push(p);
    }
  }
  // overflow에서도 카테고리 max 2 강제 — 편향(카페 등 한 카테고리 쏠림) 완전 차단.
  // candidates 풀이 좁아 5개를 못 채우면 그대로 더 적은 결과를 반환한다.
  for (const p of overflow) {
    if (top.length >= TOP_N) break;
    const cat = p.category || p.category_label || '기타';
    const c = categoryCount.get(cat) || 0;
    if (c >= PER_CATEGORY_LIMIT) continue;
    top.push(p);
    categoryCount.set(cat, c + 1);
  }

  const placesWithReasons = await generatePersonaReasons(
    session.persona_id,
    top,
    prescription.psych_rationale
  );

  for (const p of placesWithReasons) {
    if (p.place_id != null) {
      await pool.query(
        `INSERT INTO recommendation
           (session_id, place_id, semantic_similarity, prescription_text, persona_reason, psych_rationale)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          p.place_id,
          p.chroma_base_similarity ?? 0,
          prescription.prescription_text,
          p.persona_reason,
          prescription.psych_rationale,
        ]
      );
    }
  }

  return {
    places: placesWithReasons.map((p) => ({
      place_id: p.place_id,
      tour_content_id: p.tour_content_id,
      name: p.name,
      // 응답 카테고리도 더 세밀한 PG category 우선 (카페/음식점/주점 분리).
      // category_label은 contenttypeid 4개 그룹이라 사용자에게 보여지는 분류로는 거침.
      category: p.category || p.category_label,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      photo: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
      distance_km: p.distance_km != null ? Math.round(p.distance_km * 100) / 100 : null,
      atmosphere_text: p.atmosphere_text,
      summary_text: p.summary_text || null,
      operating_hours: p.operating_hours,
      max_group_size: p.max_group_size,
      is_outdoor: p.is_outdoor,
      reason: p.persona_reason,
      similarity: p.chroma_base_similarity,
      score: p.chroma_score,
      keyword_hits: p.chroma_must_hits,
    })),
    emotion_scores: emotionScores,
    prescription: {
      prescription_text: prescription.prescription_text,
      psych_rationale: prescription.psych_rationale,
      referenced_theories: prescription.referenced_theories,
      category_hint: prescription.category_hint,
      keywords_must: prescription.keywords_must,
      keywords_avoid: prescription.keywords_avoid,
      mbti_signals_applied: prescription.mbti_signals_applied,
    },
    personalization,
  };
}

function emptyResult(scores, prescription, personalization) {
  return {
    places: [],
    emotion_scores: scores,
    prescription: {
      prescription_text: prescription.prescription_text,
      psych_rationale: prescription.psych_rationale,
      referenced_theories: prescription.referenced_theories,
      category_hint: prescription.category_hint,
      keywords_must: prescription.keywords_must,
      keywords_avoid: prescription.keywords_avoid,
      mbti_signals_applied: prescription.mbti_signals_applied,
    },
    personalization: personalization || { n_likes: 0, pref_alpha: 0, excluded_dislikes: 0 },
  };
}

async function generatePersonaReasons(personaId, places, psychRationale) {
  if (places.length === 0) return [];

  const reasonInput = places.map((p) => ({
    place_id: p.place_id ?? `tour_${p.tour_content_id}`,
    name: p.name,
    category: p.category_label || p.category,
    atmosphere_text: p.atmosphere_text,
  }));

  const messages = buildReasonPrompt(personaId, reasonInput, psychRationale);

  let parsed;
  try {
    const response = await openai.chat.completions.create({
      model: REASON_MODEL,
      messages,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });
    parsed = JSON.parse(response.choices[0].message.content);
  } catch (err) {
    return places.map((p) => ({
      ...p,
      persona_reason: '이 공간이 지금의 당신에게 적합합니다.',
    }));
  }

  // LLM이 response_format=json_object 강제로 인해 배열을 키로 감싸 보내는 경우가 있음.
  // 알려진 키 후보를 먼저 시도하고, 못 찾으면 객체의 첫 배열을 자동으로 사용한다.
  function extractReasonArray(p) {
    if (Array.isArray(p)) return p;
    if (p && typeof p === 'object') {
      for (const k of ['reasons', 'items', 'places', 'results', 'recommendations', 'data']) {
        if (Array.isArray(p[k])) return p[k];
      }
      for (const v of Object.values(p)) {
        if (Array.isArray(v)) return v;
      }
    }
    return [];
  }

  const reasonMap = new Map();
  const reasons = extractReasonArray(parsed);
  for (const r of reasons) {
    if (r && r.place_id != null) {
      reasonMap.set(String(r.place_id), r.persona_reason || '');
    }
  }

  return places.map((p) => {
    const key = String(p.place_id ?? `tour_${p.tour_content_id}`);
    return {
      ...p,
      persona_reason: reasonMap.get(key) || '이 공간이 지금의 당신에게 적합합니다.',
    };
  });
}
