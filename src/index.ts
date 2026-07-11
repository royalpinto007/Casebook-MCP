// Casebook MCP: a remote MCP server for the AgentPostmortem failure registry.
import { handleMcpRequest } from "./mcp";

// Light per-IP rate limiting. In-memory per isolate: good enough for a
// public read-only endpoint, resets naturally on isolate recycling.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    if (hits.size > 10_000) hits.clear();
    return false;
  }
  entry.count++;
  return entry.count > MAX_REQUESTS;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return Response.json({
        name: "casebook-mcp",
        description:
          "Remote MCP server exposing AI-agent failure case files from agentpostmortem.com",
        endpoint: "/mcp",
        tools: ["search_cases", "get_case", "similar_failures", "list_tags"],
      });
    }

    if (url.pathname === "/mcp") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      if (rateLimited(ip)) {
        return Response.json(
          { error: "Rate limit exceeded. Max 60 requests per minute." },
          { status: 429 },
        );
      }
      return handleMcpRequest(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
