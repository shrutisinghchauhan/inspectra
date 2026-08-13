import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestRepository } from "@/lib/ingest";

export const maxDuration = 300;

/** Re-index a repo on demand (e.g. from a "Re-sync" button in the dashboard). */
export async function POST(req: NextRequest) {
  const { repoId } = await req.json();
  if (!repoId) {
    return NextResponse.json({ error: "repoId required" }, { status: 400 });
  }

  const repo = await db.repository.findUnique({ where: { id: repoId } });
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  void ingestRepository(repoId).catch((err) =>
    console.error(`[ingest] ${repo.fullName} failed:`, err),
  );

  return NextResponse.json({ ok: true, status: "INGESTING" });
}
