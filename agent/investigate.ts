// Casebook investigator: given an incident description, consults the
// Casebook MCP server for similar documented failures and drafts a
// postmortem. Runs on local Claude Code auth; no API key handling in code.
//
// Usage:
//   npx tsx agent/investigate.ts "our support bot refunded 300 fake orders"
//   npx tsx agent/investigate.ts --dry-run "retry loop spammed customers"
import { writeFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const MCP_URL = process.env.CASEBOOK_MCP_URL ?? "http://localhost:8787/mcp";
const OUTPUT = "postmortem-draft.md";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const incident = argv.filter((a) => a !== "--dry-run").join(" ").trim();

if (!incident) {
  console.error(
    'Usage: tsx agent/investigate.ts [--dry-run] "description of the incident"',
  );
  process.exit(1);
}

/** Direct JSON-RPC call to the MCP server (used by dry-run mode). */
async function mcpCall(method: string, params?: unknown): Promise<any> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: any; error?: any };
  if (body.error) throw new Error(`MCP error: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function dryRunInvestigation(): Promise<string> {
  await mcpCall("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "casebook-investigator", version: "0.1.0" },
  });
  const result = await mcpCall("tools/call", {
    name: "similar_failures",
    arguments: { description: incident },
  });
  const payload = JSON.parse(result.content[0].text) as {
    source: string;
    matches: {
      caseNumber: string;
      title: string;
      tags: string[];
      sharedKeywords: string[];
      lessons: string[];
    }[];
  };

  const lines = [
    "# Postmortem Draft (dry run)",
    "",
    `## Incident`,
    "",
    incident,
    "",
    `## Similar documented failures (source: ${payload.source})`,
    "",
  ];
  for (const m of payload.matches) {
    lines.push(`### ${m.caseNumber}: ${m.title}`);
    lines.push(`- Tags: ${m.tags.join(", ")}`);
    lines.push(`- Shared keywords: ${m.sharedKeywords.join(", ")}`);
    for (const lesson of m.lessons) lines.push(`- Lesson: ${lesson}`);
    lines.push("");
  }
  lines.push(
    "## Note",
    "",
    "Model analysis was stubbed (--dry-run). Run without the flag for a full investigation.",
    "",
  );
  return lines.join("\n");
}

async function fullInvestigation(): Promise<string> {
  const prompt = [
    `You are an incident investigator. An AI agent incident has been reported:`,
    ``,
    `"${incident}"`,
    ``,
    `Investigate using the casebook tools:`,
    `1. Call similar_failures with the incident description.`,
    `2. Call get_case on the two or three most relevant case numbers for full detail.`,
    `3. Optionally search_cases for the dominant failure mode.`,
    ``,
    `Then write a postmortem draft in markdown with sections:`,
    `Summary, Suspected failure mode, Precedents (cite case numbers and what happened),`,
    `Contributing factors to check, Recommended remediations (grounded in the`,
    `documented lessons), Open questions.`,
    `Output ONLY the markdown document.`,
  ].join("\n");

  let draft = "";
  const stream = query({
    prompt,
    options: {
      mcpServers: {
        casebook: { type: "http", url: MCP_URL },
      },
      allowedTools: [
        "mcp__casebook__search_cases",
        "mcp__casebook__get_case",
        "mcp__casebook__similar_failures",
        "mcp__casebook__list_tags",
      ],
      maxTurns: 12,
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.error(`[tool] ${block.name}`);
        }
      }
    }
    if (message.type === "result" && message.subtype === "success") {
      draft = message.result;
    }
  }
  if (!draft) throw new Error("Agent produced no result.");
  return draft;
}

const draft = dryRun ? await dryRunInvestigation() : await fullInvestigation();
writeFileSync(OUTPUT, draft + "\n");
console.log(`Wrote ${OUTPUT} (${draft.length} chars)`);
