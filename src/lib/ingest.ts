import { db } from "./db";
import { fetchRepoFiles, installationClient } from "./github";
import { chunkFile, embeddingInput, type Chunk } from "./chunk";
import { embedBatch, saveChunkEmbedding } from "./retrieve";

const EMBED_BATCH = 64;

/**
 * Full ingestion for a repository:
 *   1. pull reviewable source files at the default branch
 *   2. split each into overlapping chunks
 *   3. embed chunks in batches and persist them
 *
 * Designed to be called from an async job (a webhook handler, a queue worker,
 * or a background function) — it updates Repository.status as it goes so the
 * dashboard can poll progress.
 */
export async function ingestRepository(repoId: string): Promise<void> {
  const repo = await db.repository.findUniqueOrThrow({ where: { id: repoId } });

  await db.repository.update({
    where: { id: repoId },
    data: { status: "INGESTING" },
  });

  try {
    const octokit = await installationClient(repo.installationId);
    const { sha, files } = await fetchRepoFiles(
      octokit,
      repo.owner,
      repo.name,
      repo.defaultBranch,
    );

    // Fresh ingest — clear any stale chunks first.
    await db.codeChunk.deleteMany({ where: { repoId } });

    const allChunks: Chunk[] = files.flatMap(chunkFile);

    let stored = 0;
    for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
      const batch = allChunks.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(batch.map(embeddingInput));

      // Insert rows, then attach embeddings (embeddings need raw SQL).
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const row = await db.codeChunk.create({
          data: {
            repoId,
            path: chunk.path,
            language: chunk.language,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
          },
        });
        await saveChunkEmbedding(row.id, vectors[j]);
        stored++;
      }
    }

    await db.repository.update({
      where: { id: repoId },
      data: { status: "READY", lastIngestSha: sha, chunkCount: stored },
    });
  } catch (err) {
    await db.repository.update({
      where: { id: repoId },
      data: { status: "FAILED" },
    });
    throw err;
  }
}
