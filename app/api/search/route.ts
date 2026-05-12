import { NextResponse } from "next/server";
import { searchWithIntelligentRetry } from "@/lib/search";

export async function POST(request: Request) {
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!openrouterApiKey) {
    return NextResponse.json(
      { error: "OpenRouter API key not configured" },
      { status: 500 }
    );
  }
  if (!githubToken) {
    return NextResponse.json(
      { error: "GitHub token not configured" },
      { status: 500 }
    );
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const q = typeof body.query === "string" ? body.query.trim() : "";
  if (!q) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const payload = await searchWithIntelligentRetry(q, {
      openrouterApiKey,
      githubToken,
    });
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    console.error("Search failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
