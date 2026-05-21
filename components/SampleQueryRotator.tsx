"use client";

import { EXAMPLE_QUERY_CHIPS } from "@/lib/sample-search-queries";

type SampleQueryRotatorProps = {
  onSelect: (query: string) => void;
};

export function SampleQueryRotator({ onSelect }: SampleQueryRotatorProps) {
  return (
    <div className="mb-8 text-center">
      <span className="mb-3 block text-xs font-medium uppercase tracking-wider text-gray-400">
        Try a search
      </span>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLE_QUERY_CHIPS.map((query) => (
          <button
            key={query}
            type="button"
            onClick={() => onSelect(query)}
            title={query}
            className="whitespace-nowrap rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            {query}
          </button>
        ))}
      </div>
    </div>
  );
}
