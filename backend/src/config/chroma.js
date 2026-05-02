import { ChromaClient } from 'chromadb';

const chroma = new ChromaClient({
  host: process.env.CHROMA_HOST || 'localhost',
  port: Number(process.env.CHROMA_PORT || 8000),
  ssl: false,
});

export default chroma;
