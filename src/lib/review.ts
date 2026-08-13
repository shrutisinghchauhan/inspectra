import { generateObject } from "ai";
import { z } from "zod";
import { db } from "./db";
import { installationClient } from "./github";
import { reviewModel } from "./ai";
import { retrieveRelevant, type RetrievedChunk } from "./retrieve";

const commentSchema = z.object({
  summary: z.string().describe("2-4 sentence overall assessment of the PR."),
  comments: z
    .array(
      z.object({
        path: z.string().describe("File path exactly as it appears in the diff."),
        line: z
          .number()
          .int()
          .describe("Line number in the NEW version of the file."),
        severity: z.enum(["INFO", "SUGGESTION", "WARNING", "BLOCKER"]),
        body: z.string().describe("The review comment. Be specific and actionable."),
      }),
    )
    .max(15),
});

export async function reviewPullRequest(reviewId: string): Promise<void> {
  const review = await db.review.findUniqueOrThrow({
    where: { id: reviewId },
    include: { repo: true },
  });
  const { repo } = review;

  await db.review.update({ where: { id: reviewId }, data: { status: "RUNNING" } });

  try {
    const octokit = await installationClient(repo.installationId);

    const changedFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: repo.owner,
      repo: repo.name,
      pull_number: review.prNumber,
      per_page: 100,
    });

    const reviewable = changedFiles.filter(
      (f) => f.patch && f.status !== "removed",
    );

    const contextBlocks: string[] = [];
    for (const file of reviewable) {
      const related = await retrieveRelevant(repo.id, file.patch!.slice(0, 2000), 4);
      contextBlocks.push(renderContext(file.filename, related));
    }

    const diffText = reviewable
      .map((f) => `### ${f.filename} (${f.status})\n\`\`\`diff\n${f.patch}\n\`\`\``)
      .join("\n\n");

    const { object } = await generateObject({
      model: reviewModel,
      schema: commentSchema,
      system: SYSTEM_PROMPT,
      prompt: [
        `Repository: ${repo.fullName}`,
        `Pull request #${review.prNumber}`,
        "",
        "## Changed files (unified diff)",
        diffText,
        "",
        "## Related code retrieved from the wider codebase",
        contextBlocks.join("\n\n"),
        "",
        "Review the diff. Anchor each comment to a real line in the NEW file version.",
      ].join("\n"),
    });

    await db.reviewComment.createMany({
      data: object.comments.map((c) => ({
        reviewId,
        path: c.path,
        line: c.line,
        severity: c.severity,
        body: formatBody(c.severity, c.body),
      })),
    });

    await octokit.rest.pulls.createReview({
      owner: repo.owner,
      repo: repo.name,
      pull_number: review.prNumber,
      commit_id: review.headSha,
      event: "COMMENT",
      body: `**Inspectra review**\n\n${object.summary}`,
      comments: object.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: "RIGHT" as const,
        body: formatBody(c.severity, c.body),
      })),
    });

    await db.review.update({
      where: { id: reviewId },
      data: {
        status: "COMPLETED",
        summary: object.summary,
        commentCount: object.comments.length,
      },
    });
  } catch (err) {
    await db.review.update({
      where: { id: reviewId },
      data: { status: "FAILED", error: (err as Error).message },
    });
    throw err;
  }
}

function renderContext(filename: string, chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return `(no related code found for ${filename})`;
  const parts = chunks.map(
    (c) =>
      `// ${c.path}:${c.startLine}-${c.endLine} (similarity ${c.similarity.toFixed(2)})\n${c.content}`,
  );
  return `Context for ${filename}:\n${parts.join("\n---\n")}`;
}

const SEVERITY_LABEL: Record<string, string> = {
  INFO: "Info",
  SUGGESTION: "Suggestion",
  WARNING: "Warning",
  BLOCKER: "Blocker",
};

function formatBody(severity: string, body: string): string {
  return `**${SEVERITY_LABEL[severity] ?? severity}** — ${body}`;
}

const SYSTEM_PROMPT = `You are Inspectra, a senior engineer reviewing a pull request.
You are given the PR's unified diff plus related code retrieved from the wider
codebase via semantic search. Use that context to catch issues the diff alone
would hide: broken call sites, violated invariants, inconsistent patterns,
missing error handling, and security or correctness bugs.

Rules:
- Only comment on lines that appear in the diff.
- Anchor every comment to a real line number in the NEW file version.
- Be specific and actionable; suggest the fix, not just the problem.
- Prefer a few high-value comments over many trivial ones.
- Use severity honestly.
- If the PR looks clean, return an empty comments array and say so in the summary.`;