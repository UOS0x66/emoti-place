/**
 * Eval pipeline runner — backend/data/test/conversations.json 의 대화 N개를
 * Stage1(emotion) → Stage2(prescription, MBTI 반영) → Stage3(place + 페르소나 사유)
 * 풀 파이프라인으로 돌려 backend/data/test/eval_results.json 으로 저장.
 *
 * MBTI 배분: id 홀수 → INFJ, 짝수 → ISTP (10/10).
 * GPS 기준점: 서울시청 (37.5665, 126.9780) — 모든 케이스 동일.
 *
 * 사용:
 *   cd backend && node scripts/runEvalPipeline.js
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import openai from '../src/config/openai.js';
import pool from '../src/config/db.js';
import { extractEmotionScores } from '../src/llm/emotionExtractor.js';
import { generatePrescription } from '../src/llm/prescriptionGenerator.js';
import { recommendPlaces } from '../src/llm/placeRecommender.js';
import { buildReasonPrompt } from '../src/prompts/reason.js';
import { haversineKm } from '../src/utils/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;
const TYPE_LABEL = { '12': '관광지', '14': '문화시설', '28': '레포츠', '39': '음식점' };
const REASON_MODEL = process.env.REASON_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';

function extractReasonArray(p) {
  if (Array.isArray(p)) return p;
  if (p && typeof p === 'object') {
    for (const k of ['reasons', 'items', 'places', 'results', 'recommendations', 'data']) {
      if (Array.isArray(p[k])) return p[k];
    }
    for (const v of Object.values(p)) if (Array.isArray(v)) return v;
  }
  return [];
}

async function processCase(conv, mbti) {
  const history = conv.messages;

  const emotions = await extractEmotionScores(history);
  const prescription = await generatePrescription(emotions, {
    conversationHistory: history,
    mbti,
  });

  const candidates = await recommendPlaces(prescription, { nResults: 10 });

  let placesOut = [];
  if (candidates.length > 0) {
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
          distance_km:
            pg.lat != null && pg.lng != null
              ? haversineKm(DEFAULT_LAT, DEFAULT_LNG, Number(pg.lat), Number(pg.lng))
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

    const within5 = enriched.filter((p) => p.distance_km == null || p.distance_km <= 5);
    let filtered =
      within5.length >= 3
        ? within5
        : enriched.filter((p) => p.distance_km == null || p.distance_km <= 10);
    if (filtered.length === 0) filtered = enriched;

    filtered.sort((a, b) => (b.chroma_score ?? 0) - (a.chroma_score ?? 0));
    const TOP_N = 5;
    const PER_CATEGORY_LIMIT = 2;
    const top = [];
    const overflow = [];
    const categoryCount = new Map();
    for (const p of filtered) {
      const cat = p.category || p.category_label || '기타';
      const c = categoryCount.get(cat) || 0;
      if (c < PER_CATEGORY_LIMIT && top.length < TOP_N) {
        top.push(p);
        categoryCount.set(cat, c + 1);
      } else {
        overflow.push(p);
      }
    }
    for (const p of overflow) {
      if (top.length >= TOP_N) break;
      const cat = p.category || p.category_label || '기타';
      const c = categoryCount.get(cat) || 0;
      if (c >= PER_CATEGORY_LIMIT) continue;
      top.push(p);
      categoryCount.set(cat, c + 1);
    }

    const reasonInput = top.map((p) => ({
      place_id: p.place_id ?? `tour_${p.tour_content_id}`,
      name: p.name,
      category: p.category_label || p.category,
      atmosphere_text: p.atmosphere_text,
    }));

    let parsed = {};
    try {
      const messages = buildReasonPrompt(conv.persona_id, reasonInput, prescription.psych_rationale);
      const response = await openai.chat.completions.create({
        model: REASON_MODEL,
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      parsed = JSON.parse(response.choices[0].message.content);
    } catch (err) {
      // 사유 LLM 실패해도 장소는 살림 — 기본 문구로 채움
    }

    const reasonMap = new Map();
    for (const r of extractReasonArray(parsed)) {
      if (r && r.place_id != null) {
        reasonMap.set(String(r.place_id), r.persona_reason || '');
      }
    }

    placesOut = top.map((p) => {
      const key = String(p.place_id ?? `tour_${p.tour_content_id}`);
      return {
        name: p.name,
        category: p.category || p.category_label,
        address: p.address,
        photo: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
        distance_km: p.distance_km != null ? Math.round(p.distance_km * 100) / 100 : null,
        atmosphere_text: p.atmosphere_text,
        summary_text: p.summary_text || null,
        is_outdoor: p.is_outdoor,
        similarity: p.chroma_base_similarity,
        score: p.chroma_score,
        keyword_hits: p.chroma_must_hits,
        persona_reason: reasonMap.get(key) || '이 공간이 지금의 당신에게 적합합니다.',
      };
    });
  }

  return { emotions, prescription, places: placesOut };
}

async function main() {
  const inputPath = path.join(ROOT, 'data', 'test', 'conversations.json');
  const outputPath = path.join(ROOT, 'data', 'test', 'eval_results.json');
  const data = JSON.parse(readFileSync(inputPath, 'utf8'));
  const convs = data.conversations;

  const results = [];
  const startedAt = Date.now();
  for (let i = 0; i < convs.length; i++) {
    const conv = convs[i];
    const mbti = conv.id % 2 === 1 ? 'INFJ' : 'ISTP';
    const tag = `[${i + 1}/${convs.length}] id=${conv.id} "${conv.title}" persona=${conv.persona_id} mbti=${mbti}`;
    console.log(tag);
    const t0 = Date.now();
    try {
      const out = await processCase(conv, mbti);
      console.log(`  ✓ ${Date.now() - t0}ms · ${out.places.length} places · top_emotion=${
        Object.entries(out.emotions).sort((a, b) => b[1] - a[1])[0][0]
      } · cat_hint="${out.prescription.category_hint}"`);
      results.push({
        conversation_id: conv.id,
        title: conv.title,
        scenario: conv.scenario,
        mbti,
        persona_id: conv.persona_id,
        timestamp: new Date().toISOString(),
        conversation: conv.messages,
        emotions: out.emotions,
        prescription: out.prescription,
        places: out.places,
      });
      // 중간 저장 — 도중 끊겨도 누적된 만큼 살림
      writeFileSync(outputPath, JSON.stringify(results, null, 2));
    } catch (err) {
      console.error(`  ✗ ERR: ${err.message}`);
      results.push({
        conversation_id: conv.id,
        title: conv.title,
        scenario: conv.scenario,
        mbti,
        persona_id: conv.persona_id,
        timestamp: new Date().toISOString(),
        conversation: conv.messages,
        error: err.message,
      });
      writeFileSync(outputPath, JSON.stringify(results, null, 2));
    }
  }

  console.log(`\nWrote ${outputPath}`);
  console.log(`Total: ${results.length} cases · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});