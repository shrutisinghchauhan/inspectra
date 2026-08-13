import { embed, embedMany } from "ai";
import { db } from "./db";
import { embeddingModel } from "./ai";

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: embeddingModel, values: texts });
  return embeddings;
}

export interface RetrievedChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  similarity: number;
}

export async function retrieveRelevant(
  repoId: string,
  queryText: string,
  limit = 6,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedText(queryText);
  const literal = toVectorLiteral(queryEmbedding);

  const rows = await db.$queryRaw<RetrievedChunk[]>`
    SELECT id, path, "startLine", "endLine", content,
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM "CodeChunk"
    WHERE "repoId" = ${repoId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `;

  return rows;
}

export async function saveChunkEmbedding(
  chunkId: string,
  embedding: number[],
): Promise<void> {
  const literal = toVectorLiteral(embedding);
  await db.$executeRaw`
    UPDATE "CodeChunk" SET embedding = ${literal}::vector WHERE id = ${chunkId}
  `;
}