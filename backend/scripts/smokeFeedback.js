/**
 * Step 6 스모크 테스트 — buildUserPreference + recommendPlaces 가중합/제외 동작.
 *
 * 1) 0-LIKE: baseline (alpha=0, no exclude)
 * 2) 1-LIKE: alpha>0, 후보 변화
 * 3) +DISLIKE: 그 ID 가 결과에서 빠짐
 *
 * 임시 사용자/피드백을 만들고, 끝나면 정리한다. PG/Chroma 가 살아있어야 한다.
 */

import 'dotenv/config';
import pool from '../src/config/db.js';
import { buildUserPreference } from '../src/services/feedbackService.js';
import { recommendPlaces } from '../src/llm/placeRecommender.js';

const FAKE_PRESCRIPTION = {
  prescription_text:
    '햇살이 깊게 드는 고즈넉한 실내, 나무 가구와 잔잔한 향이 있는 공간에서 혼자 시간을 보낼 수 있는 곳',
  keywords_must: ['고즈넉', '햇살', '나무'],
  keywords_avoid: [],
  category_hint: '',
};

function ids(list) {
  return list.map((p) => `${p.id}:${p.title.slice(0, 12)} sim=${p.base_similarity.toFixed(3)} α=${p.pref_alpha.toFixed(2)}`);
}

async function pickTwoLikedAndOneDisliked() {
  // 임의의 첫 번째 추천 결과에서 2개를 LIKE, 1개를 DISLIKE 후보로 잡는다.
  const baseline = await recommendPlaces(FAKE_PRESCRIPTION, { nResults: 5 });
  if (baseline.length < 3) throw new Error('baseline 후보가 3개 미만');
  // tour_content_id == chroma id == baseline[i].id
  const tourLikeA = baseline[0].id;
  const tourLikeB = baseline[1].id;
  const tourDislike = baseline[2].id;
  // PG place_id 매핑
  const r = await pool.query(
    `SELECT place_id, tour_content_id FROM place WHERE tour_content_id = ANY($1::varchar[])`,
    [[tourLikeA, tourLikeB, tourDislike]]
  );
  const map = new Map(r.rows.map((row) => [String(row.tour_content_id), row.place_id]));
  return {
    baseline,
    likeA: { tour: String(tourLikeA), placeId: map.get(String(tourLikeA)) },
    likeB: { tour: String(tourLikeB), placeId: map.get(String(tourLikeB)) },
    dislike: { tour: String(tourDislike), placeId: map.get(String(tourDislike)) },
  };
}

async function main() {
  let userId;
  try {
    // 임시 유저 — 트리거되는 외래키 없음. nickname/password 형식만 맞추면 OK.
    const u = await pool.query(
      `INSERT INTO "user" (email, nickname, password_hash)
       VALUES ($1, 'smoke', 'x') RETURNING user_id`,
      [`smoke-${Date.now()}@test.local`]
    );
    userId = u.rows[0].user_id;
    console.log('temp user_id =', userId);

    const { baseline, likeA, likeB, dislike } = await pickTwoLikedAndOneDisliked();
    console.log('\n--- 1) 0-LIKE baseline ---');
    console.log(ids(baseline));
    const pref0 = await buildUserPreference(userId);
    console.log('pref0:', { nLikes: pref0.nLikes, hasVec: !!pref0.preferenceVector, dislikes: pref0.dislikedTourIds });
    if (pref0.nLikes !== 0 || pref0.preferenceVector !== null) throw new Error('0-LIKE 상태가 깨끗하지 않음');

    console.log('\n--- 2) 1-LIKE 추가 후 blend ---');
    if (!likeA.placeId) throw new Error('likeA place_id 매핑 실패 — PG에 없음');
    await pool.query(
      `INSERT INTO user_place_feedback (user_id, place_id, rating) VALUES ($1, $2, 'LIKE')`,
      [userId, likeA.placeId]
    );
    const pref1 = await buildUserPreference(userId);
    console.log('pref1:', { nLikes: pref1.nLikes, vecDim: pref1.preferenceVector?.length, dislikes: pref1.dislikedTourIds });
    const blended1 = await recommendPlaces(FAKE_PRESCRIPTION, {
      nResults: 5,
      preferenceVector: pref1.preferenceVector,
      nLikes: pref1.nLikes,
      excludeIds: pref1.dislikedTourIds,
    });
    console.log(ids(blended1));
    if (blended1[0].pref_alpha === 0) throw new Error('LIKE 1개인데 pref_alpha=0');

    console.log('\n--- 2b) 2-LIKE 후 blend (alpha 증가 확인) ---');
    if (likeB.placeId) {
      await pool.query(
        `INSERT INTO user_place_feedback (user_id, place_id, rating) VALUES ($1, $2, 'LIKE')`,
        [userId, likeB.placeId]
      );
      const pref2 = await buildUserPreference(userId);
      const blended2 = await recommendPlaces(FAKE_PRESCRIPTION, {
        nResults: 5,
        preferenceVector: pref2.preferenceVector,
        nLikes: pref2.nLikes,
        excludeIds: pref2.dislikedTourIds,
      });
      console.log('pref2 nLikes=', pref2.nLikes, 'alpha=', blended2[0].pref_alpha.toFixed(3));
      console.log(ids(blended2));
    }

    console.log('\n--- 3) DISLIKE 추가 후 제외 확인 ---');
    if (!dislike.placeId) throw new Error('dislike place_id 매핑 실패');
    await pool.query(
      `INSERT INTO user_place_feedback (user_id, place_id, rating) VALUES ($1, $2, 'DISLIKE')`,
      [userId, dislike.placeId]
    );
    const pref3 = await buildUserPreference(userId);
    console.log('pref3:', { nLikes: pref3.nLikes, dislikes: pref3.dislikedTourIds });
    const blended3 = await recommendPlaces(FAKE_PRESCRIPTION, {
      nResults: 5,
      preferenceVector: pref3.preferenceVector,
      nLikes: pref3.nLikes,
      excludeIds: pref3.dislikedTourIds,
    });
    console.log(ids(blended3));
    const stillIn = blended3.find((p) => String(p.id) === dislike.tour);
    if (stillIn) throw new Error(`DISLIKE 한 ${dislike.tour} 가 아직 결과에 남아있음`);
    console.log(`✓ DISLIKE 한 ${dislike.tour} 제외 확인`);

    console.log('\n--- 4) upsert: LIKE → DISLIKE 토글 ---');
    await pool.query(
      `INSERT INTO user_place_feedback (user_id, place_id, rating) VALUES ($1, $2, 'DISLIKE')
       ON CONFLICT (user_id, place_id) DO UPDATE SET rating='DISLIKE', updated_at=NOW()`,
      [userId, likeA.placeId]
    );
    const pref4 = await buildUserPreference(userId);
    console.log('pref4:', { nLikes: pref4.nLikes, dislikes: pref4.dislikedTourIds });
    if (!pref4.dislikedTourIds.includes(likeA.tour)) throw new Error('토글 후 DISLIKE 에 없음');
    console.log(`✓ ${likeA.tour} LIKE→DISLIKE 토글 정상`);

    console.log('\n=== 전 시나리오 통과 ===');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    if (userId) {
      await pool.query(`DELETE FROM "user" WHERE user_id = $1`, [userId]);
    }
    await pool.end();
  }
}

main();
