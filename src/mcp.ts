// Stateless MCP server over streamable HTTP (JSON responses).
// Implements initialize, tools/list, and tools/call per the 2025-03-26 spec.
import { getCorpus, getCaseDetail, getTags } from "./data";
import { searchCases, similarCases, summarize } from "./search";

const PROTOCOL_VERSION = "2025-03-26";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "search_cases",
    description:
      "Full-text search over AI-agent failure case files from the AgentPostmortem registry. Returns case summaries ranked by relevance. Optionally filter by tag slug.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. 'refund prompt injection'" },
        tag: { type: "string", description: "Optional tag slug to filter by, e.g. 'infinite-loop'" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_case",
    description:
      "Fetch the full detail of one failure case file by its case number (e.g. 'APM-0048' or 'CB-0001'): outcome narrative, verified facts, unknowns, and lessons.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Case number, e.g. 'APM-0048'" },
      },
      required: ["id"],
    },
  },
  {
    name: "similar_failures",
    description:
      "Given a free-text description of an incident, find the most similar documented agent failures by keyword overlap. Use this to learn how comparable failures played out and what fixed them.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Plain-language description of the incident under investigation",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "list_tags",
    description: "List all failure-mode tags in the registry with descriptions.",
    inputSchema: { type: "object", properties: {} },
  },
];

function textResult(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_cases": {
      const query = String(args.query ?? "");
      const tag = args.tag ? String(args.tag) : undefined;
      const { cases, source } = await getCorpus();
      const results = searchCases(cases, query, { tag });
      return textResult({
        source,
        count: results.length,
        results: results.map(summarize),
      });
    }
    case "get_case": {
      const id = String(args.id ?? "");
      const detail = await getCaseDetail(id);
      if (!detail) {
        return {
          content: [{ type: "text", text: `No case found with id '${id}'.` }],
          isError: true,
        };
      }
      return textResult(detail);
    }
    case "similar_failures": {
      const description = String(args.description ?? "");
      const { cases, source } = await getCorpus();
      const matches = similarCases(cases, description);
      return textResult({
        source,
        matches: matches.map((m) => ({
          ...summarize(m.case),
          sharedKeywords: m.overlap,
          outcome: m.case.outcome,
          lessons: m.case.lessons,
        })),
      });
    }
    case "list_tags":
      return textResult(await getTags());
    default:
      throw { code: -32602, message: `Unknown tool: ${name}` };
  }
}

async function dispatch(req: JsonRpcRequest): Promise<unknown | null> {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "casebook-mcp",
          version: "0.1.0",
        },
        instructions:
          "Casebook exposes the AgentPostmortem registry of documented AI-agent failures. Use similar_failures when investigating an incident, search_cases for topical research, and get_case for full detail.",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      return callTool(name, args);
    }
    default:
      if (req.method.startsWith("notifications/")) return null;
      throw { code: -32601, message: `Method not found: ${req.method}` };
  }
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "GET") {
    // No server-initiated stream; clients using pure request/response are fine.
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const requests = Array.isArray(body) ? body : [body];
  const responses: unknown[] = [];

  for (const raw of requests) {
    const req = raw as JsonRpcRequest;
    if (req?.jsonrpc !== "2.0" || typeof req.method !== "string") {
      responses.push(errorPayload(null, -32600, "Invalid request"));
      continue;
    }
    const isNotification = req.id === undefined || req.id === null;
    try {
      const result = await dispatch(req);
      if (!isNotification) {
        responses.push({ jsonrpc: "2.0", id: req.id, result });
      }
    } catch (err) {
      if (!isNotification) {
        const e = err as { code?: number; message?: string };
        responses.push(
          errorPayload(req.id ?? null, e.code ?? -32603, e.message ?? "Internal error"),
        );
      }
    }
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  const payload = Array.isArray(body) ? responses : responses[0];
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}

function errorPayload(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcError(id: number | string | null, code: number, message: string) {
  return new Response(JSON.stringify(errorPayload(id, code, message)), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
