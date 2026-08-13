import { createGoogleGenerativeAI } from "@ai-sdk/google";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const embeddingModel = google.textEmbedding("gemini-embedding-001");
export const EMBEDDING_DIMS = 3072;

export const reviewModel = google("gemini-2.0-flash");