import type { Repository } from "@/components/RepositoryCard";

export type DeepSearchResult = {
  repositories: Repository[];
  reasoning: string;
};

export type DeepSearchEvent =
  | { type: "status"; message: string }
  | { type: "web_search"; query: string; count: number }
  | { type: "github_search"; query: string; count: number }
  | { type: "scrape"; url: string; reposFound: number }
  | { type: "result"; repositories: Repository[]; reasoning: string }
  | { type: "error"; message: string };
