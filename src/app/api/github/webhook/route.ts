import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { ingestRepository } from "@/lib/ingest";
import { reviewPullRequest } from "@/lib/review";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const event = req.headers.get("x-github-event") ?? "";

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw);

  // Respond to GitHub IMMEDIATELY; do heavy work in the background so we
  // never hit GitHub's ~10s webhook timeout.
  void handleEvent(event, payload).catch((err) =>
    console.error(`[webhook] ${event} failed:`, err),
  );

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: string, payload: any) {
  switch (event) {
    case "installation":
    case "installation_repositories":
      return registerRepos(payload);
    case "pull_request":
      return handlePullRequest(payload);
    default:
      return;
  }
}

async function registerRepos(payload: any) {
  const installationId = payload.installation?.id;
  const repos = payload.repositories ?? payload.repositories_added ?? [];

  for (const r of repos) {
    const [owner, name] = r.full_name.split("/");
    const record = await db.repository.upsert({
      where: { fullName: r.full_name },
      update: { installationId },
      create: {
        githubId: r.id,
        owner,
        name,
        fullName: r.full_name,
        installationId,
        status: "PENDING",
      },
    });
    await ingestRepository(record.id).catch((err) =>
      console.error(`[ingest] ${r.full_name} failed:`, err),
    );
  }
}

async function handlePullRequest(payload: any) {
  const action = payload.action;
  if (!["opened", "synchronize", "reopened"].includes(action)) return;

  const fullName = payload.repository.full_name;
  const repo = await db.repository.findUnique({ where: { fullName } });
  if (!repo) return;

  // If the repo isn't ingested yet, ingest it now (then continue to review).
  if (repo.status !== "READY") {
    await ingestRepository(repo.id).catch((err) =>
      console.error(`[ingest-on-pr] ${fullName} failed:`, err),
    );
  }

  const prNumber = payload.pull_request.number;
  const headSha = payload.pull_request.head.sha;

  const review = await db.review.upsert({
    where: { repoId_prNumber_headSha: { repoId: repo.id, prNumber, headSha } },
    update: {},
    create: { repoId: repo.id, prNumber, headSha, status: "QUEUED" },
  });

  if (review.status === "QUEUED") {
    await reviewPullRequest(review.id);
  }
}

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}