import fs from "fs";
import path from "path";

import type { OpenRouterMessage } from "@/lib/deep-openrouter";

let _systemPromptTemplate: string | null = null;

function loadSystemPromptTemplate(): string {
  if (!_systemPromptTemplate) {
    const filePath = path.join(
      process.cwd(),
      "lib",
      "prompts",
      "deep-research-system.md"
    );
    _systemPromptTemplate = fs.readFileSync(filePath, "utf-8");
  }
  return _systemPromptTemplate;
}

export function buildDeepSearchSystemPrompt(query: string): string {
  return loadSystemPromptTemplate().replace(/\{\{QUERY\}\}/g, query);
}

export function buildDeepSearchInitialMessages(
  query: string
): OpenRouterMessage[] {
  return [
    { role: "system", content: buildDeepSearchSystemPrompt(query) },
    {
      role: "user",
      content:
        `Find the best GitHub repositories for this request: "${query}". Use the available tools to discover matches, then return the ranked JSON.`,
    },
  ];
}

function stripJsonFences(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "");
  s = s.replace(/\s*```\s*$/i, "");
  return s.trim();
}

export function parseDeepSearchJson(raw: string): {
  repos: string[];
  reasoning: string;
} {
  const cleaned = stripJsonFences(raw);
  try {
    const parsed = JSON.parse(cleaned) as {
      repos?: unknown;
      similar?: unknown;
      reasoning?: unknown;
    };
    const list = parsed.repos ?? parsed.similar;
    if (!Array.isArray(list)) return { repos: [], reasoning: "" };

    const repos: string[] = [];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const name = item.trim();
      if (!name.includes("/")) continue;
      const key = name.toLowerCase();
      if (!repos.some((x) => x.toLowerCase() === key)) repos.push(name);
    }

    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";

    return { repos, reasoning };
  } catch {
    return { repos: [], reasoning: "" };
  }
}
