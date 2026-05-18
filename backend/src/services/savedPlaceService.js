/**
 * 사용자 보관함 서비스.
 *
 * 모델:
 *   - user_saved_place: (user_id, place_id) UNIQUE PK.
 *   - 저장 시점의 persona_reason 도 같이 박제해두어, 나중에 다시 보관함을 열 때
 *     원래 추천 받았던 사유 그대로 보여준다.
 */

import pool from '../config/db.js';

export async function savePlace(userId, placeId, personaReason = null) {
  const r = await pool.query(
    `INSERT INTO user_saved_place (user_id, place_id, persona_reason, saved_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, place_id) DO UPDATE
       SET persona_reason = COALESCE(EXCLUDED.persona_reason, user_saved_place.persona_reason),
           saved_at = NOW()
     RETURNING user_id, place_id, persona_reason, saved_at`,
    [userId, placeId, personaReason]
  );
  return r.rows[0];
}

export async function unsavePlace(userId, placeId) {
  await pool.query(
    `DELETE FROM user_saved_place WHERE user_id = $1 AND place_id = $2`,
    [userId, placeId]
  );
}

export async function listSavedPlaces(userId) {
  const { rows } = await pool.query(
    `SELECT s.place_id, s.persona_reason, s.saved_at,
            p.tour_content_id, p.name, p.category, p.address, p.lat, p.lng,
            p.operating_hours, p.photos, p.atmosphere_text, p.summary_text,
            p.max_group_size, p.is_outdoor
       FROM user_saved_place s
       JOIN place p ON p.place_id = s.place_id
      WHERE s.user_id = $1
      ORDER BY s.saved_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    place_id: r.place_id,
    tour_content_id: r.tour_content_id,
    name: r.name,
    category: r.category,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    photo: Array.isArray(r.photos) && r.photos.length > 0 ? r.photos[0] : null,
    atmosphere_text: r.atmosphere_text,
    summary_text: r.summary_text,
    operating_hours: r.operating_hours,
    max_group_size: r.max_group_size,
    is_outdoor: r.is_outdoor,
    reason: r.persona_reason,
    saved_at: r.saved_at,
  }));
}
