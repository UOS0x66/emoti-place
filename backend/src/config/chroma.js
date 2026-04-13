const { ChromaClient } = require('chromadb');

const chroma = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000',
});

module.exports = chroma;
