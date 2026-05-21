import type { Repository } from "@/components/RepositoryCard";
import { GITHUB_SEARCH_MAX } from "@/lib/deep-search-limits";

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gitsearchai-app",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function ghJson(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(url, {
    ...options,
    headers: { ...githubHeaders(), ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(30_000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function ghFetch(url: string): Promise<unknown> {
  const { ok, status, data } = await ghJson(url);
  if (!ok) {
    if (status === 404) throw new Error("Repository not found.");
    if (status === 403) {
      throw new Error("GitHub API rate limit reached. Try again in a minute.");
    }
    throw new Error(`GitHub error (${status})`);
  }
  return data;
}

export type GitHubSearchHit = {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
};

export function toRepository(r: Record<string, unknown>): Repository {
  const owner = r.owner as Record<string, unknown> | undefined;
  return {
    id: (r.id as number | undefined) ?? 0,
    name: (r.name as string | undefined) ?? "",
    full_name: r.full_name as string,
    html_url:
      (r.html_url as string | undefined) ??
      `https://github.com/${r.full_name}`,
    description: (r.description as string | null) ?? null,
    stargazers_count: (r.stargazers_count as number | undefined) ?? 0,
    forks_count: (r.forks_count as number | undefined) ?? 0,
    language: (r.language as string | null | undefined) ?? null,
    updated_at: (r.updated_at as string | undefined) ?? new Date().toISOString(),
    owner: {
      login: (owner?.login as string | undefined) ?? "",
      avatar_url: (owner?.avatar_url as string | undefined) ?? "",
    },
  };
}

export async function searchRepositories(
  query: string,
  limit = 10
): Promise<GitHubSearchHit[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set(
    "per_page",
    String(Math.min(Math.max(limit, 1), GITHUB_SEARCH_MAX))
  );
  url.searchParams.set("sort", "stars");

  const { ok, status, data } = await ghJson(url.toString());
  if (!ok) {
    if (status === 403) throw new Error("GitHub search rate limit reached.");
    throw new Error(`GitHub search error (${status})`);
  }

  const items = (data as { items?: unknown[] }).items ?? [];
  const out: GitHubSearchHit[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const fullName = r.full_name;
    if (typeof fullName !== "string" || !fullName.includes("/")) continue;
    out.push({
      full_name: fullName,
      description:
        r.description === null || r.description === undefined
          ? null
          : typeof r.description === "string"
            ? r.description
            : null,
      stargazers_count:
        typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
      language:
        r.language === null || r.language === undefined
          ? null
          : typeof r.language === "string"
            ? r.language
            : null,
    });
  }

  return out;
}

export async function fetchRepositoryByName(
  fullName: string
): Promise<Repository | null> {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;

  try {
    const data = (await ghFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    )) as Record<string, unknown>;
    return toRepository(data);
  } catch {
    return null;
  }
}

export async function batchFetchReposByNames(
  fullNames: string[]
): Promise<Repository[]> {
  const unique = [
    ...new Set(
      fullNames
        .map((name) => name.trim())
        .filter((name) => name.includes("/"))
    ),
  ];

  const results = await Promise.all(
    unique.map((name) => fetchRepositoryByName(name))
  );

  const repos: Repository[] = [];
  const seen = new Set<string>();

  for (const repo of results) {
    if (!repo) continue;
    const key = repo.full_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(repo);
  }

  return repos;
}

const METADATA_SEARCH_FALLBACK_LIMIT = 3;

export type ResolveReposResult = {
  resolved: Repository[];
  notFound: string[];
  searchSuggestions: Map<string, GitHubSearchHit[]>;
};

export async function resolveAndFetchRepos(
  candidates: string[]
): Promise<ResolveReposResult> {
  const unique = [
    ...new Set(
      candidates
        .map((c) => c.trim())
        .filter((c) => c.includes("/"))
    ),
  ];

  const resolved: Repository[] = [];
  const notFound: string[] = [];
  const searchSuggestions = new Map<string, GitHubSearchHit[]>();
  const resolvedKeys = new Set<string>();

  for (const fullName of unique) {
    const key = fullName.toLowerCase();
    if (resolvedKeys.has(key)) continue;

    const repo = await fetchRepositoryByName(fullName);
    if (repo) {
      resolved.push(repo);
      resolvedKeys.add(key);
      continue;
    }

    const repoPart = fullName.split("/").pop() ?? fullName;
    const query = repoPart.replace(/-/g, " ");

    try {
      const hits = await searchRepositories(query, METADATA_SEARCH_FALLBACK_LIMIT);
      if (hits.length === 0) {
        notFound.push(fullName);
        continue;
      }

      searchSuggestions.set(fullName, hits);

      for (const hit of hits) {
        const hitKey = hit.full_name.toLowerCase();
        if (resolvedKeys.has(hitKey)) continue;

        const hitRepo = await fetchRepositoryByName(hit.full_name);
        if (hitRepo) {
          resolved.push(hitRepo);
          resolvedKeys.add(hitKey);
        }
      }
    } catch {
      notFound.push(fullName);
    }
  }

  return { resolved, notFound, searchSuggestions };
}
