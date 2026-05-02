/**
 * OpenAI 임베딩 래퍼
 *
 * AGENTS.md 사양: text-embedding-3-small, 768차원.
 *  - text-embedding-3-small의 native 차원은 1536이지만,
 *    `dimensions` 파라미터로 768로 truncate (Matryoshka 표현).
 */

import openai from '../../config/openai.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 768;
const DEFAULT_BATCH_SIZE = 100;

async function embedTexts(texts, { model = EMBEDDING_MODEL, dimensions = EMBEDDING_DIM, retries = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await openai.embeddings.create({ model, input: texts, dimensions });
      return res.data.map((d) => d.embedding);
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
  }
  throw new Error(`OpenAI 임베딩 실패 (${retries}회 재시도): ${lastError && lastError.message}`);
}

async function embedBatched(texts, { batchSize = DEFAULT_BATCH_SIZE, ...opts } = {}) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const embs = await embedTexts(slice, opts);
    out.push(...embs);
  }
  return out;
}

export { embedTexts, embedBatched, EMBEDDING_MODEL, EMBEDDING_DIM };
