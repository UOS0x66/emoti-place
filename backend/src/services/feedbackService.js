/**
 * 사용자 장소 피드백 서비스 (개인화 추천의 데이터 레이어).
 *
 * 모델:
 *   - LIKE/DISLIKE 두 신호만 (UNIQUE user_id+place_id, PK 복합).
 *   - LIKE 한 장소들의 atmosphere 임베딩 평균을 사용자 선호 벡터로 사용.
 *   - DISLIKE 는 결과 후보에서 tour_content_id 로 제외 (벡터에는 영향 X).
 */

import pool from '../config/db.js';
import { getOrCreateCollection, COLLECTION_NAME } from '../etl/loaders/chromaLoader.js';

const VALID_RATINGS = new Set(['LIKE', 'DISLIKE']);

function meanVector(vectors) {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

function l2Normalize(vec) {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export async function upsertFeedback(userId, placeId, rating) {
  const upper = String(rating || '').toUpperCase();
  if (!VALID_RATINGS.has(upper)) {
    const err = new Error(`rating은 LIKE 또는 DISLIKE 여야 합니다 (받은값: ${rating})`);
    err.status = 400;
    throw err;
  }
  const r = await pool.query(
    `INSERT INTO user_place_feedback (user_id, place_id, rating, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, place_id) DO UPDATE
       SET rating = EXCLUDED.rating, updated_at = NOW()
     RETURNING user_id, place_id, rating, updated_at`,
    [userId, placeId, upper]
  );
  return r.rows[0];
}

export async function deleteFeedback(userId, placeId) {
  await pool.query(
    `DELETE FROM user_place_feedback WHERE user_id = $1 AND place_id = $2`,
    [userId, placeId]
  );
}

/**
 * 사용자의 LIKE/DISLIKE 를 모아 선호 벡터 + 제외 ID 목록을 반환.
 *
 * @param {string|null} userId
 * @returns {Promise<{
 *   preferenceVector: number[]|null,
 *   nLikes: number,            // 실제로 임베딩이 발견된 LIKE 수
 *   dislikedTourIds: string[], // Chroma ID 공간 (= tour_content_id) 으로 제외용
 * }>}
 */
export async function buildUserPreference(userId) {
  const empty = { preferenceVector: null, nLikes: 0, dislikedTourIds: [] };
  if (!userId) return empty;

  const { rows } = await pool.query(
    `SELECT f.place_id, f.rating, p.tour_content_id
       FROM user_place_feedback f
       JOIN place p ON p.place_id = f.place_id
      WHERE f.user_id = $1
        AND p.tour_content_id IS NOT NULL`,
    [userId]
  );
  if (rows.length === 0) return empty;

  const likedTourIds = rows
    .filter((r) => r.rating === 'LIKE')
    .map((r) => String(r.tour_content_id));
  const dislikedTourIds = rows
    .filter((r) => r.rating === 'DISLIKE')
    .map((r) => String(r.tour_content_id));

  if (likedTourIds.length === 0) {
    return { preferenceVector: null, nLikes: 0, dislikedTourIds };
  }

  const collection = await getOrCreateCollection(COLLECTION_NAME);
  const got = await collection.get({
    ids: likedTourIds,
    include: ['embeddings'],
  });
  const embs = (got.embeddings || []).filter((e) => Array.isArray(e) && e.length > 0);

  if (embs.length === 0) {
    // LIKE 는 있지만 Chroma 에 임베딩이 없으면 선호 벡터 형성 불가 → 비개인화 동작.
    return { preferenceVector: null, nLikes: 0, dislikedTourIds };
  }

  const mean = meanVector(embs);
  const preferenceVector = l2Normalize(mean);
  return {
    preferenceVector,
    nLikes: embs.length,
    dislikedTourIds,
  };
}
