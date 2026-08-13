<div align="center">

# 🔍 Inspectra

### AI-powered code review that understands your *whole* codebase — not just the diff.

Inspectra embeds an entire repository into a vector index, and when a pull request opens it retrieves the code **surrounding** your change and posts inline review comments — catching issues a line-by-line diff would miss, like a broken call site three files away.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Postgres](https://img.shields.io/badge/Postgres-pgvector-336791?logo=postgresql)](https://github.com/pgvector/pgvector)
[![Gemini](https://img.shields.io/badge/AI-Gemini-4285F4?logo=google)](https://ai.google.dev/)
[![Prisma](https://img.shields.io/badge/ORM-Prisma-2D3748?logo=prisma)](https://www.prisma.io/)

</div>

---

## The problem

Traditional code review tools — and most "AI reviewers" — only look at the **diff**. But the most dangerous bugs aren't *in* the changed lines; they're in what the change **breaks elsewhere**: a renamed function still called in another module, a violated invariant, an inconsistent pattern, a missing null check that another file depended on.

A reviewer who's read the whole codebase catches those. A diff-only tool can't.

## The idea

**Give the AI reviewer the same context a senior engineer has** — the surrounding code — using Retrieval-Augmented Generation (RAG):

1. **Index** the repository once: split every source file into overlapping chunks, embed each with a language model, and store the vectors in Postgres (`pgvector`).
2. On every pull request, **retrieve** the code semantically closest to each changed file via vector similarity search.
3. **Feed** the diff *plus* that retrieved context to the model and ask for structured, line-anchored review comments.
4. **Post** them back to the PR as inline comments, tagged by severity.

---

## Architecture

```
  ┌──────────────┐   PR opened / repo installed    ┌─────────────────────────┐
  │    GitHub     │ ───────── webhook ────────────► │  /api/github/webhook     │
  │   (App +      │                                 │  • verify HMAC signature │
  │   webhooks)   │ ◄──── inline review comments ── │  • respond 200 instantly │
  └──────────────┘                                  │  • do work in background │
                                                    └───────────┬─────────────┘
                                                                │
                        ┌───────────────────────────────────────┼───────────────────────┐
                        ▼                                       ▼                        ▼
              ┌──────────────────┐                   ┌──────────────────┐      ┌──────────────────┐
              │   INGESTION      │                   │    RETRIEVAL     │      │   REVIEW ENGINE  │
              │  fetch source →  │                   │  embed query →   │      │  diff + context  │
              │  chunk (overlap) │                   │  pgvector cosine │      │  → generateObject│
              │  → embed → store │                   │  similarity      │      │  → typed comments│
              └────────┬─────────┘                   └────────┬─────────┘      └────────┬─────────┘
                       │                                       │                        │
                       ▼                                       ▼                        ▼
                 ┌───────────────────────────────────────────────────────────────────────────┐
                 │                    Postgres + pgvector  (via Prisma)                        │
                 │      Repository · CodeChunk[vector(3072)] · Review · ReviewComment          │
                 └───────────────────────────────────────────────────────────────────────────┘
```

### Tech stack

| Layer            | Choice                                                             |
| ---------------- | ----------------------------------------------------------------- |
| **App**          | Next.js 15 (App Router), TypeScript, React 19                     |
| **Database**     | PostgreSQL + **pgvector** extension, accessed via Prisma           |
| **AI**           | Google **Gemini** (`gemini-embedding-001`, `gemini-2.0-flash`) via the Vercel AI SDK |
| **GitHub**       | GitHub App + Octokit — webhooks in, inline reviews out            |
| **Client**       | React Query dashboard with live ingestion/review status           |

---

## Key engineering decisions

These are the choices that make the project more than a wrapper around an API call:

- **RAG over the whole repo, not just the diff.** The core differentiator. Vector similarity search surfaces related code so the model can reason about ripple effects, not just the changed lines.

- **pgvector inside the primary database.** Rather than bolting on a separate vector DB (Pinecone, Weaviate), embeddings live in the same Postgres instance as the relational data — one datastore, transactional consistency, less operational surface. Cosine similarity runs through raw SQL using pgvector's `<=>` operator, since the ORM can't express it.

- **Provider-agnostic AI layer.** Every model call goes through the Vercel AI SDK, so switching embedding/generation providers is a **one-file change** (`src/lib/ai.ts`). The project was built on OpenAI and migrated to Gemini with zero changes outside that file and the vector dimension.

- **Non-blocking, event-driven webhooks.** GitHub enforces a ~10-second webhook timeout, but embedding a repository takes far longer. The handler **verifies the HMAC signature, responds `200` in ~40ms, and performs ingestion/review in the background** — the standard pattern for durable webhook processing.

- **Structured LLM output.** Review comments are generated with `generateObject` against a Zod schema (`path`, `line`, `severity`, `body`), so the model returns typed, validated data instead of free text that needs parsing.

- **Overlapping chunking.** Files are split into line-windows with overlap, so a function straddling a chunk boundary still lands whole inside at least one chunk — which materially improves retrieval quality.

---

## Data model

```prisma
model CodeChunk {
  id        String   @id @default(cuid())
  repoId    String
  path      String
  startLine Int
  endLine   Int
  content   String   @db.Text
  embedding Unsupported("vector(3072)")?   // Gemini embedding dimensions
  repo      Repository @relation(fields: [repoId], references: [id], onDelete: Cascade)
}
```

`Repository`, `Review`, and `ReviewComment` complete the schema — tracking ingestion status, per-PR review runs (idempotent per head commit), and severity-tagged comments.

---

## Getting started

**Prerequisites:** Node 20+, Docker, a Google AI Studio API key, and a GitHub App.

```bash
# 1. Database (Postgres + pgvector)
docker run -d --name inspectra-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16

# 2. Install + configure
npm install
cp .env.example .env        # fill in GEMINI_API_KEY + GitHub App credentials

# 3. Schema
npm run db:push

# 4. Run
npm run dev
```

Expose the local server with a tunnel (e.g. `ngrok http 3000`), point your GitHub App's webhook at `<tunnel>/api/github/webhook`, install the App on a repo, and open a pull request.

See [`.env.example`](./.env.example) for the full list of required environment variables.

> **Note:** All secrets (`GEMINI_API_KEY`, the GitHub App private key, the webhook secret) live in `.env`, which is gitignored. Never commit real credentials.

---

## Project structure

```
src/
├── app/
│   ├── api/github/webhook/   # event-driven entry point (verify → 200 → background)
│   ├── api/repos/            # ingest trigger + dashboard status
│   ├── page.tsx              # dashboard
│   └── globals.css           # design tokens (severity-based visual identity)
├── components/
│   └── RepoDashboard.tsx     # React Query client
└── lib/
    ├── ai.ts                 # provider config (swap providers here)
    ├── github.ts             # GitHub App client + file fetching
    ├── chunk.ts              # overlapping line-window chunker
    ├── ingest.ts             # fetch → chunk → embed → store
    ├── retrieve.ts           # pgvector cosine similarity search
    └── review.ts             # the RAG review engine
```

---

## Roadmap

- [ ] **AST-aware chunking** — split on function/class boundaries instead of line windows for sharper retrieval
- [ ] **Repository insights** — hotspot detection and trend analysis over the chunk index + review history
- [ ] **Durable job queue** — move background work to a queue (Inngest/QStash) for production-grade reliability at scale
- [ ] **Evaluation harness** — a labeled PR benchmark to measure precision/recall of the reviews and ablate retrieval strategies

---

<div align="center">

Built with Next.js, Postgres/pgvector, and Gemini.

</div>
