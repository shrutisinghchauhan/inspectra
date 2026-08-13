-- Run once against your database (or let `prisma migrate dev` pick up the
-- extension via the schema). Prisma can create the extension, but the ANN
-- index below is easiest to add by hand after the first migration.

CREATE EXTENSION IF NOT EXISTS vector;

-- Approximate-nearest-neighbour index for fast cosine similarity search.
-- Build this AFTER you have ingested a repo (ivfflat needs data to train the lists).
-- Tune `lists` to roughly sqrt(number_of_rows).
CREATE INDEX IF NOT EXISTS code_chunk_embedding_idx
  ON "CodeChunk"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
