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
import { recommendPlaces } from '../llm/placeRecommender.js';
import { buildReasonPrompt } from '../prompts/reason.js';
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

  const candidates = await recommendPlaces(prescription, { nResults: 10 });
  if (candidates.length === 0) return emptyResult(emotionScores, prescription);

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

  filtered.sort((a, b) => (b.chroma_score ?? 0) - (a.chroma_score ?? 0));
  const top = filtered.slice(0, 5);

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
      category: p.category_label || p.category,
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
  };
}

function emptyResult(scores, prescription) {
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
