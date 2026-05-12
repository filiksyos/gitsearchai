import Link from "next/link";

const GITHUB_REPO_URL = "https://github.com/filiksyos/gitsearchai";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-blue-100 bg-blue-50">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 text-xl font-bold tracking-tight text-gray-900 transition-opacity hover:opacity-70"
          aria-label="GitSearchAI home"
        >
          GitSearchAI
        </Link>

        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-base font-semibold tracking-tight text-gray-500 transition-colors hover:text-gray-900"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
