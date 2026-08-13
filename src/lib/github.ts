import { App } from "octokit";

/**
 * A single GitHub App instance. Each connected repo is accessed through its
 * *installation* token, which the App mints on demand — that's what scopes
 * Inspectra to only the repos a user has installed it on.
 */
export const githubApp = new App({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  webhooks: { secret: process.env.GITHUB_WEBHOOK_SECRET! },
});

/** Octokit client scoped to one App installation. */
export async function installationClient(installationId: number | bigint) {
  return githubApp.getInstallationOctokit(Number(installationId));
}

export interface RepoFile {
  path: string;
  content: string;
}

/**
 * Pull the full file tree for a repo at a given ref, then fetch the blobs we
 * care about. Skips binaries, vendored code, and anything oversized so we only
 * embed source the model can reason about.
 */
export async function fetchRepoFiles(
  octokit: Awaited<ReturnType<typeof installationClient>>,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ sha: string; files: RepoFile[] }> {
  const branch = await octokit.rest.repos.getBranch({ owner, repo, branch: ref });
  const treeSha = branch.data.commit.commit.tree.sha;
  const headSha = branch.data.commit.sha;

  const tree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "true",
  });

  const wanted = tree.data.tree.filter(
    (entry) =>
      entry.type === "blob" &&
      typeof entry.path === "string" &&
      isReviewable(entry.path) &&
      (entry.size ?? 0) <= MAX_FILE_BYTES,
  );

  const files: RepoFile[] = [];
  for (const entry of wanted) {
    const blob = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: entry.sha!,
    });
    const content = Buffer.from(blob.data.content, "base64").toString("utf-8");
    files.push({ path: entry.path!, content });
  }

  return { sha: headSha, files };
}

const MAX_FILE_BYTES = 100_000;

const SKIP_DIRS = [
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "vendor/",
  ".git/",
  "coverage/",
];

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "php", "c", "cc",
  "cpp", "h", "hpp", "cs", "kt", "swift", "scala", "sql", "sh", "css", "scss",
  "md", "yaml", "yml", "json", "prisma",
]);

function isReviewable(path: string): boolean {
  if (SKIP_DIRS.some((dir) => path.includes(dir))) return false;
  if (path.endsWith(".min.js") || path.endsWith(".lock")) return false;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CODE_EXT.has(ext);
}

export function languageFor(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby", php: "php",
    sql: "sql", css: "css", scss: "scss", md: "markdown", prisma: "prisma",
  };
  return map[ext] ?? null;
}
