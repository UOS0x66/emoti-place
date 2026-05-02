/**
 * Chroma 적재기 (loaders 레이어) — 두 컬렉션 통합 지원
 *
 *   - place_embeddings (Stage 3) 메타: contenttypeid/sigungucode/cat3/title
 *   - psych_embeddings (Stage 2 RAG) 메타: theory/primary_emotion/emotion_tags/source_pdf/chunk_idx
 */

import chroma from '../../config/chroma.js';
import { EMBEDDING_MODEL } from '../embedders/openaiEmbedder.js';

export const COLLECTION_NAME = 'place_embeddings';
export const PSYCH_COLLECTION_NAME = 'psych_embeddings';

export async function getOrCreateCollection(name = COLLECTION_NAME) {
  return chroma.getOrCreateCollection({
    name,
    metadata: {
      embedding_model: EMBEDDING_MODEL,
      'hnsw:space': 'cosine',
    },
    embeddingFunction: null,
  });
}

/**
 * place_embeddings 적재 — atmosphere_text + 카테고리/지역 메타.
 */
export async function upsertRecords(records, extraMetaByContentid = {}) {
  if (records.length === 0) return;
  const collection = await getOrCreateCollection(COLLECTION_NAME);
  const ids = records.map((r) => String(r.contentid));
  const embeddings = records.map((r) => r.embedding);
  const metadatas = records.map((r) => {
    const extra = extraMetaByContentid[r.contentid] || {};
    return {
      contenttypeid: String(r.contenttypeid),
      title: r.title,
      ...extra,
    };
  });
  const documents = records.map((r) => r.atmosphere_text || '');
  await collection.upsert({ ids, embeddings, metadatas, documents });
}

/**
 * psych_embeddings 적재.
 */
export async function upsertPsychChunks(chunks, embeddings) {
  if (chunks.length === 0) return;
  if (chunks.length !== embeddings.length) {
    throw new Error(`청크/임베딩 개수 불일치: ${chunks.length} vs ${embeddings.length}`);
  }
  const collection = await getOrCreateCollection(PSYCH_COLLECTION_NAME);
  const ids = chunks.map((c) => c.ref_id);
  const metadatas = chunks.map((c) => ({
    theory: c.theory,
    primary_emotion: c.primary_emotion,
    emotion_tags: c.emotion_tags,
    source_pdf: c.source_pdf,
    chunk_idx: c.chunk_idx,
  }));
  const documents = chunks.map((c) => c.raw_text);
  await collection.upsert({ ids, embeddings, metadatas, documents });
}

export async function queryByEmbedding(
  queryEmbedding,
  { nResults = 5, where, collectionName = COLLECTION_NAME } = {}
) {
  const collection = await getOrCreateCollection(collectionName);
  return collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
    where,
  });
}

export async function resetCollection(name = COLLECTION_NAME) {
  try {
    await chroma.deleteCollection({ name });
  } catch (err) {
    // 없으면 무시
  }
}
