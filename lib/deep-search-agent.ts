import Firecrawl from "@mendable/firecrawl-js";

import type { Repository } from "@/components/RepositoryCard";
import {
  batchFetchReposByNames,
  resolveAndFetchRepos,
  searchRepositories,
  type GitHubSearchHit,
} from "@/lib/deep-github";
import {
  buildDeepSearchInitialMessages,
  parseDeepSearchJson,
} from "@/lib/deep-prompts";
import {
  callOpenRouter,
  callOpenRouterWithTools,
  type OpenRouterMessage,
  type OpenRouterToolDefinition,
} from "@/lib/deep-openrouter";
import {
  FIRECRAWL_SEARCH_LIMIT,
  GITHUB_SEARCH_LIMIT,
  MAX_AGENT_TOOL_CALLS,
  MAX_DEEP_REPOS,
  MAX_DESCRIPTION_CHARS,
  SCRAPE_MARKDOWN_MAX_CHARS,
} from "@/lib/deep-search-limits";
import type { DeepSearchEvent } from "@/lib/deep-search-types";

const GITHUB_REPO_URL_RE =
  /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;

const RESERVED_REPO_SEGMENTS = new Set([
  "topics",
  "issues",
  "pulls",
  "discussions",
  "settings",
  "actions",
  "projects",
  "wiki",
  "security",
  "releases",
  "tags",
  "stargazers",
  "network",
  "graphs",
  "compare",
  "search",
  "orgs",
  "organizations",
  "sponsors",
  "pulse",
  "community",
]);

type FirecrawlSearchResultItem = {
  position: number;
  title: string;
  url: string;
  description: string;
};

const AGENT_TOOLS: OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "github_search",
      description:
        "Search GitHub repositories directly. Returns repo names, descriptions, and star counts sorted by popularity. Use for targeted discovery of tools in a niche.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "GitHub search query (supports qualifiers like language:typescript, stars:>100)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web. Returns position, title, url, and description for each result. Use to find curated lists and comparison articles to scrape.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_page",
      description:
        "Scrape a URL and return markdown. Prefer curated list pages (comparison articles, top-N roundups, awesome-style GitHub lists) that contain many repo links.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_repo_metadata",
      description:
        "Fetch real GitHub metadata (stars, language, description, confirmed full_name) for repos you plan to rank. Call once before your final answer with every candidate slug. For slugs that do not exist, automatically searches GitHub and returns the best matches.",
      parameters: {
        type: "object",
        properties: {
          repos: {
            type: "array",
            items: { type: "string" },
            description: "List of owner/repo full names to resolve",
          },
        },
        required: ["repos"],
      },
    },
  },
];

let firecrawlClient: Firecrawl | null = null;

function getFirecrawlClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY not configured");
  }
  if (!firecrawlClient) {
    firecrawlClient = new Firecrawl({ apiKey });
  }
  return firecrawlClient;
}

function extractGithubFullNames(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(GITHUB_REPO_URL_RE)) {
    const owner = match[1];
    const repo = match[2];
    if (!owner || !repo) continue;

    const cleanedRepo = repo.replace(/\.git$/i, "").split(/[?#]/)[0];
    if (RESERVED_REPO_SEGMENTS.has(cleanedRepo.toLowerCase())) continue;

    const fullName = `${owner}/${cleanedRepo}`;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fullName);
  }

  return out;
}

function truncateDescription(desc: string | null | undefined): string {
  if (!desc) return "(no description)";
  return desc.length <= MAX_DESCRIPTION_CHARS
    ? desc
    : `${desc.slice(0, MAX_DESCRIPTION_CHARS)}…`;
}

function formatSearchResultsForLlm(items: FirecrawlSearchResultItem[]): string {
  if (items.length === 0) return "No search results found.";
  let out = `Found ${items.length} results:\n\n`;
  for (const item of items) {
    out += `[${item.position}] ${item.title}\n`;
    out += `URL: ${item.url}\n`;
    out += `Description: ${truncateDescription(item.description)}\n\n`;
  }
  return out.trim();
}

function formatGithubSearchForLlm(items: GitHubSearchHit[]): string {
  if (items.length === 0) return "No GitHub repositories found.";
  let out = `Found ${items.length} repositories (sorted by stars):\n\n`;
  for (const [i, item] of items.entries()) {
    out += `[${i + 1}] ${item.full_name} | ${item.stargazers_count} stars | ${item.language ?? "unknown"}\n`;
    out += `  ${truncateDescription(item.description)}\n\n`;
  }
  return out.trim();
}

function formatRepoMetadataForLlm(
  resolved: Repository[],
  notFound: string[],
  searchSuggestions: Map<string, GitHubSearchHit[]>
): string {
  if (
    resolved.length === 0 &&
    notFound.length === 0 &&
    searchSuggestions.size === 0
  ) {
    return "No repositories to resolve.";
  }

  let out = `Resolved ${resolved.length} repositories (use these confirmed full_name values in your final JSON):\n\n`;
  for (const repo of resolved) {
    out += `${repo.full_name} | ${repo.stargazers_count} stars | ${repo.language ?? "unknown"}\n`;
    out += `  ${truncateDescription(repo.description)}\n\n`;
  }

  if (searchSuggestions.size > 0) {
    out += `Slugs not found on GitHub — use one of these search matches instead:\n\n`;
    for (const [slug, hits] of searchSuggestions) {
      out += `"${slug}" does not exist. GitHub search alternatives:\n`;
      for (const [i, hit] of hits.entries()) {
        out += `  [${i + 1}] ${hit.full_name} | ${hit.stargazers_count} stars | ${hit.language ?? "unknown"}\n`;
        out += `    ${truncateDescription(hit.description)}\n`;
      }
      out += "\n";
    }
  }

  if (notFound.length > 0) {
    out += `Could not resolve (no GitHub search hits): ${notFound.join(", ")}\n`;
  }

  return out.trim();
}

function parseFirecrawlSearchResponse(data: {
  web?: Array<{
    url?: string;
    title?: string;
    description?: string;
    position?: number;
  }>;
}): FirecrawlSearchResultItem[] {
  const items: FirecrawlSearchResultItem[] = [];
  for (const [index, item] of (data.web ?? []).entries()) {
    if (!item.url) continue;
    items.push({
      position: item.position ?? index + 1,
      title: item.title ?? item.url,
      url: item.url,
      description: item.description ?? "",
    });
  }
  return items;
}

async function executeWebSearch(
  query: string,
  limit?: number
): Promise<{ items: FirecrawlSearchResultItem[]; text: string }> {
  const client = getFirecrawlClient();
  const searchLimit = Math.min(
    Math.max(limit ?? FIRECRAWL_SEARCH_LIMIT, 1),
    10
  );
  const data = await client.search(query, { limit: searchLimit });
  const items = parseFirecrawlSearchResponse(
    data as {
      web?: Array<{
        url?: string;
        title?: string;
        description?: string;
        position?: number;
      }>;
    }
  );
  return { items, text: formatSearchResultsForLlm(items) };
}

async function executeGithubSearch(
  query: string,
  limit?: number
): Promise<{ items: GitHubSearchHit[]; text: string }> {
  const searchLimit =
    typeof limit === "number" ? limit : GITHUB_SEARCH_LIMIT;
  const items = await searchRepositories(query, searchLimit);
  return { items, text: formatGithubSearchForLlm(items) };
}

function extractMarkdownFromScrapeResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";

  const r = result as Record<string, unknown>;

  if (typeof r.markdown === "string") return r.markdown;

  const data = r.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.markdown === "string") return d.markdown;
    if (Array.isArray(d) && d[0] && typeof d[0] === "object") {
      const first = d[0] as Record<string, unknown>;
      if (typeof first.markdown === "string") return first.markdown;
    }
  }

  return "";
}

async function executeScrapePage(url: string): Promise<string> {
  const client = getFirecrawlClient() as Firecrawl & {
    scrape?: (
      target: string,
      opts?: { formats?: string[] }
    ) => Promise<unknown>;
    scrapeUrl?: (
      target: string,
      opts?: { formats?: string[] }
    ) => Promise<unknown>;
  };

  let result: unknown;
  if (typeof client.scrape === "function") {
    result = await client.scrape(url, { formats: ["markdown"] });
  } else if (typeof client.scrapeUrl === "function") {
    result = await client.scrapeUrl(url, { formats: ["markdown"] });
  } else {
    throw new Error("Firecrawl scrape API not available");
  }

  let markdown = extractMarkdownFromScrapeResult(result);
  if (!markdown) {
    return `Scraped ${url} but no markdown content was returned.`;
  }

  if (markdown.length > SCRAPE_MARKDOWN_MAX_CHARS) {
    markdown = `${markdown.slice(0, SCRAPE_MARKDOWN_MAX_CHARS)}\n\n[Content truncated]`;
  }

  const repos = extractGithubFullNames(markdown);
  return (
    `Scraped: ${url}\n` +
    `GitHub repos found in page (${repos.length}): ${repos.slice(0, 50).join(", ") || "(none)"}\n\n` +
    `---\n${markdown}`
  );
}

function orderReposByAgentRanking(
  candidates: Repository[],
  rankedNames: string[]
): Repository[] {
  const byName = new Map(
    candidates.map((r) => [r.full_name.toLowerCase(), r])
  );
  const ordered: Repository[] = [];
  const used = new Set<string>();

  for (const name of rankedNames) {
    const key = name.toLowerCase();
    if (used.has(key)) continue;
    const repo = byName.get(key);
    if (repo) {
      ordered.push(repo);
      used.add(key);
    }
    if (ordered.length >= MAX_DEEP_REPOS) break;
  }

  return ordered;
}

export async function runDeepSearchAgent(
  query: string,
  onEvent: (event: DeepSearchEvent) => void
): Promise<{ repositories: Repository[]; reasoning: string }> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Query is required.");
  }

  let toolCallsUsed = 0;
  let githubSearchCount = 0;
  let webSearchCount = 0;
  let scrapeCount = 0;

  onEvent({ type: "status", message: "Starting deep research..." });

  const messages: OpenRouterMessage[] =
    buildDeepSearchInitialMessages(trimmedQuery);

  let agentDone = false;
  let finalAgentContent: string | null = null;

  while (!agentDone && toolCallsUsed < MAX_AGENT_TOOL_CALLS) {
    const { content, toolCalls } = await callOpenRouterWithTools(
      messages,
      AGENT_TOOLS
    );

    if (toolCalls.length === 0) {
      finalAgentContent = content;
      agentDone = true;
      break;
    }

    messages.push({
      role: "assistant",
      content: content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const isMetadataTool = tc.function.name === "get_repo_metadata";

      if (!isMetadataTool && toolCallsUsed >= MAX_AGENT_TOOL_CALLS) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Tool budget exhausted. Return your repos JSON now.",
        });
        continue;
      }

      if (!isMetadataTool) {
        toolCallsUsed++;
      }

      let toolResult = "";

      try {
        const args = JSON.parse(tc.function.arguments || "{}") as Record<
          string,
          unknown
        >;

        if (tc.function.name === "get_repo_metadata") {
          const repos = Array.isArray(args.repos)
            ? args.repos
                .map((r) => String(r).trim())
                .filter((r) => r.includes("/"))
            : [];

          const { resolved, notFound, searchSuggestions } =
            await resolveAndFetchRepos(repos);

          toolResult = formatRepoMetadataForLlm(
            resolved,
            notFound,
            searchSuggestions
          );

          onEvent({
            type: "status",
            message: `Resolved metadata for ${resolved.length} repos`,
          });
        } else if (tc.function.name === "github_search") {
          const ghQuery = String(args.query ?? "").trim();
          const limit =
            typeof args.limit === "number" ? args.limit : GITHUB_SEARCH_LIMIT;

          const { items, text } = await executeGithubSearch(ghQuery, limit);
          githubSearchCount++;

          onEvent({
            type: "github_search",
            query: ghQuery,
            count: items.length,
          });
          toolResult = text;
        } else if (tc.function.name === "web_search") {
          const webQuery = String(args.query ?? "").trim();
          const limit =
            typeof args.limit === "number"
              ? args.limit
              : FIRECRAWL_SEARCH_LIMIT;

          const { items, text } = await executeWebSearch(webQuery, limit);
          webSearchCount++;

          onEvent({
            type: "web_search",
            query: webQuery,
            count: items.length,
          });
          toolResult = text;
        } else if (tc.function.name === "scrape_page") {
          const url = String(args.url ?? "").trim();
          toolResult = await executeScrapePage(url);
          const foundNames = extractGithubFullNames(toolResult);
          scrapeCount++;

          onEvent({
            type: "scrape",
            url,
            reposFound: foundNames.length,
          });
        } else {
          toolResult = `Unknown tool: ${tc.function.name}`;
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        toolResult = `Tool error: ${errMsg}`;
        console.warn(
          `[gitsearchai] Tool ${tc.function.name} failed:`,
          errMsg
        );
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult,
      });
    }

    if (toolCallsUsed >= MAX_AGENT_TOOL_CALLS) {
      messages.push({
        role: "user",
        content:
          'Tool budget exhausted. Return ONLY valid JSON: {"repos":["owner/repo",...],"reasoning":"..."} ranked best-first.',
      });
      finalAgentContent = await callOpenRouter(messages);
      agentDone = true;
    }
  }

  const { repos: repoNames, reasoning: agentReasoning } = parseDeepSearchJson(
    finalAgentContent ?? ""
  );

  if (repoNames.length === 0) {
    throw new Error(
      "No repositories found. The agent did not return a valid repo list — try again."
    );
  }

  onEvent({ type: "status", message: "Loading results..." });

  const enriched = await batchFetchReposByNames(repoNames);
  const repositories = orderReposByAgentRanking(enriched, repoNames);

  if (repositories.length === 0) {
    throw new Error(
      "Found repository names but could not load them from GitHub. Check GITHUB_TOKEN."
    );
  }

  const reasoning =
    agentReasoning ||
    [
      `${toolCallsUsed} tool calls`,
      `${githubSearchCount} GitHub searches`,
      `${webSearchCount} web searches`,
      `${scrapeCount} page scrapes`,
      `${repoNames.length} in agent list`,
      `${repositories.length} repos shown`,
    ].join(" · ");

  return { repositories, reasoning };
}
