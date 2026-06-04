/**
 * Stage 3 — 장소 후보 검색 + 재랭킹
 *
 * 입력: prescriptionGenerator의 출력 객체
 * 동작:
 *   1) prescription_text를 임베딩
 *   2) Chroma place_embeddings 의미 검색 (category_hint면 contenttypeid where 필터)
 *   3) overfetch 후 keywords_must/avoid 부스트 재랭킹
 *   4) 상위 N건 반환
 */

import { embedTexts } from '../etl/embedders/openaiEmbedder.js';
import { queryByEmbedding } from '../etl/loaders/chromaLoader.js';

// 정렬은 시맨틱 임베딩 유사도(base_similarity)만 사용한다.
// keywords_must/avoid 는 LLM이 환경 어휘를 정리하는 디버그/투명성 용도로만 남기고,
// 점수에는 반영하지 않는다 (편향 회피).
//
// overfetch 풀을 크게 잡아 카테고리 다양성 후처리(recommendService) 단계에서
// 카페 같은 한 카테고리가 후보를 독점하는 현상을 완화한다.
const DEFAULT_OVERFETCH_MULT = 12;

// 개인화 가중합 — α = min(0.5, n_likes/20). 처방의 이론 적합성을 절반 이상 잠식하지 않도록 캡.
const PREF_ALPHA_MAX = 0.5;
const PREF_ALPHA_SATURATION = 20;

export function computePreferenceAlpha(nLikes) {
  if (!nLikes || nLikes <= 0) return 0;
  return Math.min(PREF_ALPHA_MAX, nLikes / PREF_ALPHA_SATURATION);
}

function l2Normalize(vec) {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

// (1-α)·prescription + α·preference 후 L2 정규화. α=0 또는 pref 없으면 원본 그대로.
function blendEmbeddings(prescriptionEmb, preferenceEmb, alpha) {
  if (!preferenceEmb || alpha <= 0) return prescriptionEmb;
  if (preferenceEmb.length !== prescriptionEmb.length) return prescriptionEmb;
  const blended = new Array(prescriptionEmb.length);
  for (let i = 0; i < prescriptionEmb.length; i++) {
    blended[i] = (1 - alpha) * prescriptionEmb[i] + alpha * preferenceEmb[i];
  }
  return l2Normalize(blended);
}

/**
 * @param {Object} prescription - prescriptionGenerator 출력
 * @param {Object} [options]
 * @param {number} [options.nResults=5]
 * @param {number} [options.overfetchMultiplier=6]
 * @param {Object} [options.extraWhere] - 추가 where (예: { sigungucode: 11 })
 * @param {number[]} [options.preferenceVector] - 사용자 LIKE 임베딩 평균 (L2 정규화 완료)
 * @param {number} [options.nLikes] - α 자동 계산용 LIKE 수 (preferenceAlpha 직접 지정 시 무시)
 * @param {number} [options.preferenceAlpha] - α 직접 오버라이드 (없으면 nLikes 로 계산)
 * @param {string[]} [options.excludeIds] - 결과에서 제외할 tour_content_id 목록 (DISLIKE)
 * @returns {Promise<Array<{id,title,contenttypeid,sigungucode,cat3,atmosphere_text,base_similarity,boost,score,must_hits,avoid_hits,pref_alpha}>>}
 */
export async function recommendPlaces(prescription, options = {}) {
  const nResults = options.nResults ?? 5;
  const overfetch = nResults * (options.overfetchMultiplier ?? DEFAULT_OVERFETCH_MULT);

  if (!prescription?.prescription_text) {
    throw new Error('prescription.prescription_text 가 필요합니다');
  }

  const [rawEmb] = await embedTexts([prescription.prescription_text]);
  const alpha =
    options.preferenceAlpha != null
      ? Math.max(0, Math.min(PREF_ALPHA_MAX, options.preferenceAlpha))
      : computePreferenceAlpha(options.nLikes ?? 0);
  const qEmb = blendEmbeddings(rawEmb, options.preferenceVector, alpha);
  const excludeSet = new Set((options.excludeIds || []).map((id) => String(id)));

  const whereParts = [];
  if (prescription.category_hint && prescription.category_hint !== '') {
    whereParts.push({ contenttypeid: String(prescription.category_hint) });
  }
  if (options.extraWhere) {
    if (Array.isArray(options.extraWhere)) whereParts.push(...options.extraWhere);
    else whereParts.push(options.extraWhere);
  }
  let where;
  if (whereParts.length === 1) where = whereParts[0];
  else if (whereParts.length > 1) where = { $and: whereParts };

  let result = await queryByEmbedding(qEmb, { nResults: overfetch, where });
  let ids = result.ids?.[0] || [];

  if (ids.length < nResults && where) {
    result = await queryByEmbedding(qEmb, { nResults: overfetch });
    ids = result.ids?.[0] || [];
  }

  const dists = result.distances[0];
  const metas = result.metadatas[0];
  const docs = result.documents[0];

  const must = (prescription.keywords_must || []).map((k) => k.toLowerCase()).filter(Boolean);
  const avoid = (prescription.keywords_avoid || []).map((k) => k.toLowerCase()).filter(Boolean);

  const ranked = ids
    .map((id, i) => {
      if (excludeSet.has(String(id))) return null;
      const baseSim = 1 - dists[i];
      const docLower = (docs[i] || '').toLowerCase();
      const titleLower = (metas[i]?.title || '').toLowerCase();
      // 디버그 카운트 (점수 영향 없음)
      let mustHits = 0;
      let avoidHits = 0;
      for (const kw of must) {
        if (docLower.includes(kw) || titleLower.includes(kw)) mustHits += 1;
      }
      for (const kw of avoid) {
        if (docLower.includes(kw) || titleLower.includes(kw)) avoidHits += 1;
      }
      return {
        id,
        // 메타에 tour_content_id 가 있으면 그것이 PG join 키. 없으면 chroma id 자체.
        // (Chroma 와 PG 가 다른 적재 시점이라 id 자체로는 PG 매칭 불가)
        tour_content_id: metas[i]?.tour_content_id ?? id,
        title: metas[i]?.title || metas[i]?.name || '',
        contenttypeid: metas[i]?.contenttypeid,
        sigungucode: metas[i]?.sigungucode,
        cat3: metas[i]?.cat3 || '',
        atmosphere_text: docs[i] || '',
        base_similarity: baseSim,
        boost: 0,
        score: baseSim, // 시맨틱 유사도만 사용
        must_hits: mustHits,
        avoid_hits: avoidHits,
        pref_alpha: alpha,
      };
    })
    .filter(Boolean);

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, nResults);
}
