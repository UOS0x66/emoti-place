/**
 * Chroma `place_embeddings` 컬렉션 적재기.
 *
 * AGENTS.md 사양: id=place_id, embedding=float[768], metadata={place_id, category}
 * cosine 거리 기준.
 */

const chroma = require('../../config/chroma');
const { EMBEDDING_MODEL } = require('../embedders/openaiEmbedder');

const COLLECTION_NAME = 'place_embeddings';

async function getOrCreateCollection() {
  return chroma.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: {
      embedding_model: EMBEDDING_MODEL,
      'hnsw:space': 'cosine',
    },
    embeddingFunction: null,
  });
}

/**
 * @param {Array<{place_id, category, embedding, atmosphere_text, name, tour_content_id?}>} records
 */
async function upsertEmbeddings(records) {
  if (records.length === 0) return;
  const collection = await getOrCreateCollection();

  const ids = records.map((r) => String(r.place_id));
  const embeddings = records.map((r) => r.embedding);
  const metadatas = records.map((r) => ({
    place_id: Number(r.place_id),
    category: r.category || '',
    name: r.name || '',
    tour_content_id: r.tour_content_id || '',
  }));
  const documents = records.map((r) => r.atmosphere_text || '');

  await collection.upsert({ ids, embeddings, metadatas, documents });
}

async function resetCollection() {
  try {
    await chroma.deleteCollection({ name: COLLECTION_NAME });
  } catch {
    // 없으면 무시
  }
}

async function countCollection() {
  const collection = await getOrCreateCollection();
  return collection.count();
}

module.exports = {
  COLLECTION_NAME,
  getOrCreateCollection,
  upsertEmbeddings,
  resetCollection,
  countCollection,
};
