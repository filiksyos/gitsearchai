"use client";

import { Star, GitFork, Calendar } from "lucide-react";

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
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow duration-200">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={repository.owner.avatar_url}
            alt={repository.owner.login}
            className="w-8 h-8 rounded-full"
          />
          <div>
            <h3 className="font-semibold text-lg text-gray-900">
              <a
                href={repository.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-600 transition-colors"
              >
                {repository.name}
              </a>
            </h3>
            <p className="text-sm text-gray-600">{repository.owner.login}</p>
          </div>
        </div>
      </div>

      {repository.description && (
        <p className="text-gray-700 mb-4 line-clamp-2">{repository.description}</p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4 text-sm text-gray-600">
          <div className="flex items-center space-x-1">
            <Star className="w-4 h-4" />
            <span>{repository.stargazers_count.toLocaleString()}</span>
          </div>
          <div className="flex items-center space-x-1">
            <GitFork className="w-4 h-4" />
            <span>{repository.forks_count.toLocaleString()}</span>
          </div>
          {repository.language && (
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span>{repository.language}</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-1 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          <span>{formatDate(repository.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}
