const openai = require('../config/openai');
const chroma = require('../config/chroma');
const pool = require('../config/db');
const { getSession, updateSession } = require('./sessionService');
const { extractEmotions } = require('./emotionService');
const { generatePrescription } = require('./prescriptionService');
const { buildReasonPrompt } = require('../prompts/reason');
const { haversineKm } = require('../utils/geo');

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 3단계 파이프라인 전체를 실행하여 장소를 추천한다.
 *
 * Stage 1: 감정 추출 (PROMPT_EMOTION)
 * Stage 2: 환경 니즈 도출 (PROMPT_ENVNEED) — 출력: environment_query + psych_rationale
 * Stage 3: 벡터 검색 + PostgreSQL 필터 + 페르소나별 추천 사유 생성 (PROMPT_REASON)
 */
async function recommend(sessionId, lat, lng) {
  const session = await getSession(sessionId);

  // ── Stage 1: 감정 추출 ──
  const emotionScores = await extractEmotions(sessionId);

  // ── Stage 2: 환경 니즈 도출 ──
  const prescription = await generatePrescription(emotionScores);

  // 세션에 처방 저장
  await updateSession(sessionId, {
    prescription_text: prescription.environment_query,
    psych_rationale: prescription.psych_rationale,
  });

  // ── Stage 3: 장소 매칭 ──
  let places = [];

  try {
    // 3-1: Chroma 벡터 검색 (environment_query로 임베딩)
    const collection = await chroma.getCollection({ name: 'place_embeddings' });

    const results = await collection.query({
      queryTexts: [prescription.environment_query],
      nResults: 10,
    });

    if (results.ids && results.ids[0] && results.ids[0].length > 0) {
      const placeIds = results.ids[0];
      const similarities = results.distances ? results.distances[0] : [];

      // 3-2: PostgreSQL에서 장소 메타데이터 로드 + GPS 필터
      const placeholders = placeIds.map((_, i) => `$${i + 1}`).join(', ');
      const dbResult = await pool.query(
        `SELECT * FROM place WHERE place_id IN (${placeholders})`,
        placeIds
      );

      // GPS 거리 계산 및 필터 (5km, 부족 시 10km)
      let filtered = dbResult.rows.map((p) => ({
        ...p,
        distance_km: haversineKm(lat, lng, p.lat, p.lng),
        semantic_similarity: similarities[placeIds.indexOf(String(p.place_id))] || 0,
      }));

      let withinRange = filtered.filter((p) => p.distance_km <= 5);
      if (withinRange.length < 3) {
        withinRange = filtered.filter((p) => p.distance_km <= 10);
      }

      // 유사도 순 정렬, 상위 5개
      places = withinRange
        .sort((a, b) => a.semantic_similarity - b.semantic_similarity)
        .slice(0, 5);
    }
  } catch {
    console.warn('[Recommend] Chroma 연결 실패, PostgreSQL에서 직접 검색');
    const dbResult = await pool.query(`SELECT * FROM place ORDER BY random() LIMIT 5`);
    places = dbResult.rows.map((p) => ({
      ...p,
      distance_km: haversineKm(lat, lng, p.lat, p.lng),
      semantic_similarity: 0,
    }));
  }

  // ── 페르소나 추천 사유 생성 (PROMPT_REASON) ──
  const placesWithReasons = await generatePersonaReasons(
    session.persona_id,
    places,
    prescription.psych_rationale
  );

  // 추천 이력 저장
  for (const place of placesWithReasons) {
    await pool.query(
      `INSERT INTO recommendation (session_id, place_id, semantic_similarity, prescription_text, persona_reason, psych_rationale)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        place.place_id,
        place.semantic_similarity,
        prescription.environment_query,
        place.persona_reason,
        prescription.psych_rationale,
      ]
    );
  }

  return {
    places: placesWithReasons.map((p) => ({
      place_id: p.place_id,
      name: p.name,
      category: p.category,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      photo: p.photos ? p.photos[0] : null,
      distance: Math.round(p.distance_km * 100) / 100,
      atmosphere_text: p.atmosphere_text,
      operating_hours: p.operating_hours,
      max_group_size: p.max_group_size,
      is_outdoor: p.is_outdoor,
      reason: p.persona_reason,
      psych_rationale: prescription.psych_rationale,
      similarity: p.semantic_similarity,
    })),
    emotion_scores: emotionScores,
    prescription: {
      environment_query: prescription.environment_query,
      psych_rationale: prescription.psych_rationale,
      applied_theories: prescription.applied_theories,
    },
  };
}

/**
 * PROMPT_REASON을 사용하여 페르소나 말투의 추천 사유를 생성한다.
 */
async function generatePersonaReasons(personaId, places, psychRationale) {
  if (places.length === 0) return [];

  const messages = buildReasonPrompt(personaId, places, psychRationale);

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  try {
    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);
    const reasons = Array.isArray(parsed) ? parsed : parsed.reasons || parsed.items || [];

    // place_id 매칭 방식으로 결합
    const reasonMap = new Map();
    for (const r of reasons) {
      if (r && r.place_id != null) {
        reasonMap.set(Number(r.place_id), r.persona_reason || '');
      }
    }

    return places.map((p) => ({
      ...p,
      persona_reason:
        reasonMap.get(Number(p.place_id)) || '이 공간이 지금의 당신에게 적합합니다.',
    }));
  } catch {
    return places.map((p) => ({
      ...p,
      persona_reason: '이 공간이 지금의 당신에게 적합합니다.',
    }));
  }
}

module.exports = { recommend };
