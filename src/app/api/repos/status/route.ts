import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Lightweight snapshot the dashboard polls via React Query. */
export async function GET() {
  const repos = await db.repository.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          prNumber: true,
          status: true,
          summary: true,
          commentCount: true,
          createdAt: true,
        },
      },
    },
  });

  // BigInt (githubId, installationId) isn't JSON-serializable by default.
  const safe = repos.map((r: (typeof repos)[number]) => ({
    ...r,
    githubId: r.githubId.toString(),
    installationId: r.installationId.toString(),
  }));

  return NextResponse.json({ repos: safe });
}
