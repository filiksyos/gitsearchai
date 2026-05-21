"use client";

import { Star, GitFork } from "lucide-react";

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface RepositoryCardProps {
  repository: Repository;
}

export function RepositoryCard({ repository }: RepositoryCardProps) {
  return (
    <a
      href={repository.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col rounded-lg border border-gray-100 bg-white p-5 transition-all duration-200 hover:border-gray-200 hover:shadow-lg"
    >
      <div className="mb-3 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={repository.owner.avatar_url}
          alt={repository.owner.login}
          className="h-8 w-8 shrink-0 rounded-full"
        />
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] font-semibold text-gray-900 transition-colors group-hover:text-blue-600">
            {repository.full_name}
          </h3>
          <p className="text-[0.8125rem] text-gray-500">{repository.owner.login}</p>
        </div>
      </div>

      {repository.description && (
        <p className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed text-gray-600">
          {repository.description}
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 text-[0.8125rem] text-gray-500">
        <div className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5" />
          <span>{repository.stargazers_count.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <GitFork className="h-3.5 w-3.5" />
          <span>{repository.forks_count.toLocaleString()}</span>
        </div>
      </div>
    </a>
  );
}
