"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";

import { RepositoryCard, type Repository } from "@/components/RepositoryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchApiResponse = {
  github_query?: string;
  repositories?: Repository[];
  total_count?: number;
  error?: string;
};

export function GitHubSearch() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);
    setHasSearched(true);
    setRepositories([]);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      const data: SearchApiResponse = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error ?? `Request failed (${response.status})`);
        setRepositories([]);
        return;
      }

      setRepositories(data.repositories ?? []);
    } catch {
      setErrorMessage("Network error. Please try again.");
      setRepositories([]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex gap-2">
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
            ) : (
              <Search className="w-5 h-5" />
            )}
          </Button>
        </div>
      </form>

      {errorMessage && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm">
          {errorMessage}
        </div>
      )}

      {isLoading && (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Searching GitHub repositories...</p>
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
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Found {repositories.length} repositories
          </h2>
          <div className="grid gap-4">
            {repositories.map((repo) => (
              <RepositoryCard key={repo.id} repository={repo} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
