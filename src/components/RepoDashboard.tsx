"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ReviewRow {
  id: string;
  prNumber: number;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  summary: string | null;
  commentCount: number;
  createdAt: string;
}

interface Repo {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  status: "PENDING" | "INGESTING" | "READY" | "FAILED";
  chunkCount: number;
  reviews: ReviewRow[];
}

async function fetchRepos(): Promise<Repo[]> {
  const res = await fetch("/api/repos/status");
  if (!res.ok) throw new Error("Couldn't load repositories.");
  return (await res.json()).repos;
}

export function RepoDashboard() {
  const qc = useQueryClient();
  const { data: repos, isLoading, error } = useQuery({
    queryKey: ["repos"],
    queryFn: fetchRepos,
  });

  const resync = useMutation({
    mutationFn: async (repoId: string) => {
      const res = await fetch("/api/repos/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
      if (!res.ok) throw new Error("Re-sync failed.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });

  if (isLoading) return <div className="loading">Loading repositories…</div>;
  if (error)
    return <div className="empty">{(error as Error).message}</div>;

  if (!repos || repos.length === 0) {
    return (
      <div className="repos">
        <div className="empty">
          No repositories connected yet. Install the Inspectra GitHub App on a
          repo to index it and start reviewing pull requests.
        </div>
      </div>
    );
  }

  return (
    <div className="repos">
      {repos.map((repo) => (
        <article
          key={repo.id}
          className={`card ${repo.status.toLowerCase()}`}
        >
          <div className="card-head">
            <div>
              <div className="repo-name">
                <span className="owner">{repo.owner}/</span>
                {repo.name}
              </div>
              <div className="repo-meta">
                <span className={`status ${repo.status.toLowerCase()}`}>
                  {repo.status}
                </span>
                <span>{repo.chunkCount.toLocaleString()} chunks indexed</span>
              </div>
            </div>
            <button
              className="resync"
              onClick={() => resync.mutate(repo.id)}
              disabled={resync.isPending || repo.status === "INGESTING"}
            >
              {repo.status === "INGESTING" ? "indexing…" : "re-sync"}
            </button>
          </div>

          {repo.reviews.length > 0 && (
            <div className="reviews">
              {repo.reviews.map((r) => (
                <div key={r.id} className="review-row">
                  <span className="pr">#{r.prNumber}</span>
                  <span className={`chip ${r.status.toLowerCase()}`}>
                    {r.status === "COMPLETED"
                      ? `${r.commentCount} comments`
                      : r.status.toLowerCase()}
                  </span>
                  <span className="review-summary">
                    {r.summary ?? "Review in progress…"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
