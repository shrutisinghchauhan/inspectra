# Inspectra

AI-powered GitHub code review. Inspectra embeds a repository into a searchable
vector index, and when a pull request opens it retrieves the code surrounding
your change (RAG) and posts inline review comments — catching issues the diff
alone would hide.

## How it works

```
 GitHub PR opened ──webhook──► /api/github/webhook
                                    │
                                    ▼
                          create Review (idempotent per head SHA)
                                    │
                                    ▼
     ┌───────────────────── reviewPullRequest() ─────────────────────┐
     │  1. list changed files + diffs (Octokit)                      │
     │  2. per file: retrieveRelevant() → pgvector cosine search      │
     │  3. generateObject() → structured, line-anchored comments      │
     │  4. pulls.createReview() → inline comments on the PR           │
     └────────────────────────────────────────────────────────────────┘

 Repo connected ──webhook──► ingestRepository()
     fetch source ─► chunk (overlapping windows) ─► embed ─► store in pgvector
```

### Stack

| Layer         | Choice                                             |
| ------------- | -------------------------------------------------- |
| App           | Next.js 15 (App Router), TypeScript                |
| Data          | Postgres + **pgvector**, via Prisma                |
| AI            | Vercel AI SDK (`embed`, `generateObject`)          |
| GitHub        | GitHub App + Octokit (webhooks, inline reviews)    |
| Client        | React Query dashboard                              |

The AI provider is swappable in one file (`src/lib/ai.ts`) — the default is
OpenAI embeddings + `gpt-4o`; drop in `@ai-sdk/anthropic` to use Claude.

## Setup

**1. Database (Postgres with pgvector)**

```bash
docker run -d --name inspectra-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
```

**2. Install + configure**

```bash
npm install
cp .env.example .env   # fill in the values
```

**3. Schema**

```bash
npm run db:push        # creates tables + the vector extension
psql "$DATABASE_URL" -f prisma/pgvector-setup.sql   # ANN index (after first ingest)
```

**4. GitHub App**

Create one at <https://github.com/settings/apps>:

- Permissions: **Contents** (read), **Pull requests** (read & write), **Metadata** (read)
- Subscribe to the **Pull request** webhook event
- Webhook URL → `https://<your-tunnel>/api/github/webhook` (use `ngrok` locally)
- Copy the App ID, generate a private key, and set a webhook secret in `.env`

**5. Run**

```bash
npm run dev
```

Install the App on a repo → it ingests automatically → open a PR to see the
review appear.

## Project layout

```
src/lib/
  ai.ts        provider config (embeddings + review model)
  github.ts    GitHub App client, file fetching, file filters
  chunk.ts     overlapping line-window chunker
  ingest.ts    fetch → chunk → embed → store pipeline
  retrieve.ts  pgvector similarity search + embedding writes
  review.ts    the RAG review engine
src/app/api/
  github/webhook   PR + installation events (drives everything)
  repos/ingest     manual re-index
  repos/status     dashboard data
src/components/
  RepoDashboard.tsx
```

## Notes on production

- **Async processing:** the webhook acknowledges immediately and runs work in
  the background. On serverless, swap the `void handle(...)` calls for a durable
  queue (Inngest, QStash, SQS) — the handlers are written to work as workers.
- **Chunking:** line windows are the robust baseline. AST-based chunking
  (function/class boundaries) improves retrieval and is a natural next step.
- **Repository insights** (the third pillar) can be built on the same index:
  aggregate queries over `CodeChunk` + review history for hotspots and trends.
```
