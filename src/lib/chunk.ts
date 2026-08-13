import { languageFor, type RepoFile } from "./github";

export interface Chunk {
  path: string;
  language: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

const WINDOW = 60; // lines per chunk
const OVERLAP = 12; // lines shared with the previous chunk, to keep context

/**
 * Split a file into overlapping line windows. Overlap means a function that
 * straddles a boundary still lands whole inside at least one chunk — which
 * matters for retrieval quality. A production system might chunk on the AST
 * (functions/classes) instead; line windows are the robust, language-agnostic
 * baseline.
 */
export function chunkFile(file: RepoFile): Chunk[] {
  const lines = file.content.split("\n");
  if (lines.length === 0) return [];

  const language = languageFor(file.path);
  const chunks: Chunk[] = [];
  const step = WINDOW - OVERLAP;

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + WINDOW, lines.length);
    const content = lines.slice(start, end).join("\n");
    if (content.trim().length === 0) continue;

    chunks.push({
      path: file.path,
      language,
      startLine: start + 1, // 1-indexed, matching editors + GitHub
      endLine: end,
      content,
    });

    if (end === lines.length) break;
  }

  return chunks;
}

/** Prefix each chunk with its location so the embedding carries file context. */
export function embeddingInput(chunk: Chunk): string {
  return `File: ${chunk.path} (lines ${chunk.startLine}-${chunk.endLine})\n\n${chunk.content}`;
}
