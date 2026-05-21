"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  Sparkles,
  Telescope,
} from "lucide-react";

import { RepositoryCard, type Repository } from "@/components/RepositoryCard";
import { SampleQueryRotator } from "@/components/SampleQueryRotator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeepSearchEvent } from "@/lib/deep-search-types";

type SearchMode = "normal" | "deep";

type SearchApiResponse = {
  github_query?: string;
  repositories?: Repository[];
  total_count?: number;
  error?: string;
};

type ActivityStep =
  | { kind: "web_search"; query: string; count: number }
  | { kind: "github_search"; query: string; count: number }
  | { kind: "scrape"; url: string; reposFound: number };

function formatActivityStep(step: ActivityStep): {
  label: string;
  detail: string;
  sub?: string;
} {
  if (step.kind === "web_search") {
    return {
      label: "Searched web",
      detail: step.query,
      sub: `${step.count} results`,
    };
  }
  if (step.kind === "github_search") {
    return {
      label: "Searched GitHub",
      detail: step.query,
      sub: `${step.count} repos`,
    };
  }
  const host = step.url
    .replace(/^https?:\/\//, "")
    .split("/")
    .slice(0, 3)
    .join("/");
  return {
    label: "Opened page",
    detail: host,
    sub:
      step.reposFound > 0
        ? `${step.reposFound} repo links found`
        : undefined,
  };
}

export function GitHubSearch() {
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("normal");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activitySteps, setActivitySteps] = useState<ActivityStep[]>([]);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [lastSearchKind, setLastSearchKind] = useState<SearchMode | null>(null);
  const [activeSearchMode, setActiveSearchMode] = useState<SearchMode | null>(
    null
  );
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(e.target as Node)
      ) {
        setModeMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed || isLoading) return;

    setQuery(trimmed);
    setIsLoading(true);
    setActiveSearchMode("normal");
    setErrorMessage(null);
    setStatusMessage(null);
    setActivitySteps([]);
    setReasoning(null);
    setHasSearched(true);
    setRepositories([]);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      const data: SearchApiResponse = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error ?? `Request failed (${response.status})`);
        setRepositories([]);
        return;
      }

      setRepositories((data.repositories ?? []).slice(0, 9));
      setLastSearchKind("normal");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setRepositories([]);
    } finally {
      setIsLoading(false);
      setActiveSearchMode(null);
    }
  }

  async function runDeepSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed || isLoading) return;

    setQuery(trimmed);
    setIsLoading(true);
    setActiveSearchMode("deep");
    setSearchMode("deep");
    setErrorMessage(null);
    setStatusMessage("Starting deep research...");
    setActivitySteps([]);
    setReasoning(null);
    setHasSearched(true);
    setRepositories([]);

    try {
      const response = await fetch("/api/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!response.ok && !response.body) {
        const data: unknown = await response.json().catch(() => ({}));
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : `Request failed (${response.status})`;
        throw new Error(msg);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Streaming response not available.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          let event: DeepSearchEvent;
          try {
            event = JSON.parse(payload) as DeepSearchEvent;
          } catch {
            continue;
          }

          if (event.type === "status") {
            setStatusMessage(event.message);
          } else if (event.type === "web_search") {
            setActivitySteps((prev) => [
              ...prev,
              {
                kind: "web_search",
                query: event.query,
                count: event.count,
              },
            ]);
          } else if (event.type === "github_search") {
            setActivitySteps((prev) => [
              ...prev,
              {
                kind: "github_search",
                query: event.query,
                count: event.count,
              },
            ]);
          } else if (event.type === "scrape") {
            setActivitySteps((prev) => [
              ...prev,
              {
                kind: "scrape",
                url: event.url,
                reposFound: event.reposFound,
              },
            ]);
          } else if (event.type === "result") {
            setRepositories(event.repositories.slice(0, 9));
            setReasoning(event.reasoning);
            setLastSearchKind("deep");
            setStatusMessage(null);
            finished = true;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      if (!finished) {
        throw new Error("Search ended before results were returned.");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong"
      );
      setStatusMessage(null);
      setRepositories([]);
    } finally {
      setIsLoading(false);
      setActiveSearchMode(null);
    }
  }

  function startDeepResearchFromResults() {
    if (!query.trim() || isLoading) return;
    void runDeepSearch(query);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (searchMode === "deep") {
      void runDeepSearch(query);
    } else {
      void runSearch(query);
    }
  }

  function handleSampleSelect(q: string) {
    if (searchMode === "deep") {
      void runDeepSearch(q);
    } else {
      void runSearch(q);
    }
  }

  function selectMode(mode: SearchMode) {
    setSearchMode(mode);
    setModeMenuOpen(false);
  }

  return (
    <div className="w-full max-w-6xl mx-auto">
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex gap-2">
          <div className="relative shrink-0" ref={modeMenuRef}>
            <button
              type="button"
              onClick={() => setModeMenuOpen((open) => !open)}
              disabled={isLoading}
              className="flex h-12 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-haspopup="listbox"
              aria-expanded={modeMenuOpen}
            >
              {searchMode === "normal" ? (
                <Search className="h-4 w-4 text-gray-500" />
              ) : (
                <Telescope className="h-4 w-4 text-indigo-600" />
              )}
              <span className="hidden sm:inline">
                {searchMode === "normal" ? "Search" : "Deep Research"}
              </span>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>

            {modeMenuOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={searchMode === "normal"}
                  onClick={() => selectMode("normal")}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Search className="h-4 w-4 shrink-0 text-gray-500" />
                  <span className="flex-1">Search</span>
                  {searchMode === "normal" && (
                    <Check className="h-4 w-4 shrink-0 text-indigo-600" />
                  )}
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={searchMode === "deep"}
                  onClick={() => selectMode("deep")}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Telescope className="h-4 w-4 shrink-0 text-indigo-600" />
                  <span className="flex-1">Deep Research</span>
                  {searchMode === "deep" && (
                    <Check className="h-4 w-4 shrink-0 text-indigo-600" />
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              type="text"
              placeholder="A simple next.js todo app that uses tailwind css"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 h-12 text-lg"
              disabled={isLoading}
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="h-12 px-6"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : searchMode === "deep" ? (
              <Sparkles className="w-5 h-5" />
            ) : (
              <Search className="w-5 h-5" />
            )}
          </Button>
        </div>
      </form>

      {!hasSearched && !isLoading && (
        <SampleQueryRotator onSelect={handleSampleSelect} />
      )}

      {errorMessage && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm">
          {errorMessage}
        </div>
      )}

      {isLoading && activeSearchMode === "normal" && (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Searching GitHub repositories...</p>
        </div>
      )}

      {isLoading && activeSearchMode === "deep" && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-5 py-6">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            <p className="text-sm font-medium text-indigo-900" role="status">
              {statusMessage ?? "Researching..."}
            </p>
          </div>

          {activitySteps.length > 0 && (
            <ul className="space-y-2">
              {activitySteps.map((step, i) => {
                const { label, detail, sub } = formatActivityStep(step);
                return (
                  <li
                    key={`${step.kind}-${i}`}
                    className="flex items-start gap-2 text-sm text-gray-600"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <div>
                      <span className="font-medium text-gray-800">{label}</span>
                      {": "}
                      <span className="text-gray-600">{detail}</span>
                      {sub && (
                        <span className="ml-1 text-gray-400">({sub})</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!isLoading && hasSearched && repositories.length === 0 && !errorMessage && (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">
            No repositories found for your search.
          </p>
        </div>
      )}

      {repositories.length > 0 && (
        <div className="mt-10 space-y-4">
          {reasoning && lastSearchKind === "deep" && (
            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <span className="font-medium">Deep research: </span>
              {reasoning}
            </div>
          )}
          <p className="text-sm text-gray-500">
            Showing {repositories.length} results
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {repositories.map((repo) => (
              <RepositoryCard key={repo.id} repository={repo} />
            ))}
          </div>

          {!isLoading &&
          lastSearchKind === "normal" &&
          repositories.length > 0 &&
          query.trim() ? (
            <p className="pt-8 text-center text-sm text-gray-600">
              Want more depth?{" "}
              <button
                type="button"
                onClick={startDeepResearchFromResults}
                className="cursor-pointer font-medium text-gray-900 underline decoration-gray-400 underline-offset-2 transition-colors hover:text-gray-950"
              >
                Deep Research
              </button>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
