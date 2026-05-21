import { runDeepSearchAgent } from "@/lib/deep-search-agent";
import type { DeepSearchEvent } from "@/lib/deep-search-types";

export const runtime = "nodejs";

function encodeSse(event: DeepSearchEvent): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function mapErrorToMessage(err: unknown): { message: string; status: number } {
  const message = err instanceof Error ? err.message : "Something went wrong";

  if (message.includes("Query is required")) {
    return { message, status: 400 };
  }
  if (
    message.includes("GitHub API rate limit") ||
    message.includes("rate limit reached") ||
    message.includes("AI rate limit") ||
    message.toLowerCase().includes("rate limit hit")
  ) {
    return { message, status: 429 };
  }
  if (
    message.includes("OPENROUTER_API_KEY") ||
    message.includes("FIRECRAWL_API_KEY")
  ) {
    return { message, status: 500 };
  }

  const status =
    message.includes("rate limit") || message.includes("Rate limit")
      ? 429
      : 500;
  return { message, status };
}

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query =
    typeof json === "object" &&
    json !== null &&
    "query" in json &&
    typeof (json as { query: unknown }).query === "string"
      ? (json as { query: string }).query.trim()
      : "";

  if (!query) {
    return Response.json({ error: "Query is required." }, { status: 400 });
  }

  if (query.length > 500) {
    return Response.json(
      { error: "Query must be 500 characters or fewer." },
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DeepSearchEvent) => {
        controller.enqueue(encodeSse(event));
      };

      try {
        const result = await runDeepSearchAgent(query, send);
        send({
          type: "result",
          repositories: result.repositories,
          reasoning: result.reasoning,
        });
      } catch (err) {
        const { message } = mapErrorToMessage(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
