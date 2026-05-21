"use client";

import { useEffect, useRef, useState } from "react";

import { SAMPLE_SEARCH_QUERIES } from "@/lib/sample-search-queries";

type SampleQueryRotatorProps = {
  onSelect: (query: string) => void;
};

const ROTATION_MS = 2000;
const FADE_MS = 200;

export function SampleQueryRotator({ onSelect }: SampleQueryRotatorProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = SAMPLE_SEARCH_QUERIES[index];

  useEffect(() => {
    if (paused) return;

    const interval = setInterval(() => {
      setVisible(false);
      fadeTimeoutRef.current = setTimeout(() => {
        setIndex((current) => (current + 1) % SAMPLE_SEARCH_QUERIES.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATION_MS);

    return () => {
      clearInterval(interval);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [paused]);

  return (
    <div
      className="-mt-2 mb-8 flex justify-center px-4"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <button
        type="button"
        onClick={() => onSelect(query)}
        title={query}
        className="max-w-md rounded-full border border-indigo-100/80 bg-white/90 px-5 py-2 text-center shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-indigo-200 hover:bg-white hover:shadow-md hover:shadow-indigo-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <span
          className={`block truncate text-sm text-gray-600 transition-opacity duration-200 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          {query}
        </span>
      </button>
    </div>
  );
}
