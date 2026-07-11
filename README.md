# Casebook MCP

A remote [MCP](https://modelcontextprotocol.io) server that turns [AgentPostmortem](https://agentpostmortem.com), a public registry of documented AI-agent failures, into tools any agent can query. Deployable on Cloudflare Workers. Ships with a companion investigator agent built on the Claude Agent SDK that drafts postmortems grounded in real precedents.

Why: every team debugging an agent incident is rediscovering failure modes that are already documented. Casebook makes the registry agent-queryable, so Claude, Cursor, or any MCP client can ask "has anything like this happened before?" mid-investigation.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_cases(query, tag?)` | Ranked full-text search over case files, optional tag filter |
| `get_case(id)` | Full case detail: outcome, verified facts, unknowns, lessons |
| `similar_failures(description)` | Keyword-similarity match of an incident against the corpus |
| `list_tags()` | All failure-mode tags with descriptions |

## Architecture

```
MCP client (Claude Code, Cursor, agent SDK)
        |  streamable HTTP (JSON-RPC 2.0, stateless)
        v
Cloudflare Worker  src/index.ts (routing, per-IP rate limit)
        |          src/mcp.ts   (MCP protocol: initialize, tools/list, tools/call)
        |          src/search.ts (pure ranking and similarity logic, unit tested)
        v
src/data.ts: live agentpostmortem.com public API (/api/export, /api/search,
/api/tags) with a 5 minute in-memory cache, falling back to the bundled
dataset in data/ when offline.
```

The MCP transport is implemented directly against the 2025-03-26 streamable HTTP spec in stateless mode: a single `POST /mcp` endpoint handling `initialize`, `tools/list`, and `tools/call`. No sessions, no Durable Objects, no auth (the data is public and read-only). A light in-memory rate limit (60 requests per minute per IP) keeps it polite.

## Quickstart

```bash
npm install
npm test              # vitest: search ranking, tag filter, CSV parsing
npm run typecheck     # tsc --noEmit
npm run dev           # wrangler dev on http://localhost:8787
```

Smoke test the endpoint:

```bash
curl -s http://localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Add it to Claude Code:

```bash
claude mcp add --transport http casebook http://localhost:8787/mcp
```

## Investigator agent

`agent/investigate.ts` uses the Claude Agent SDK `query()` API. Given an incident description, it connects to the MCP server, finds similar documented failures, pulls the top cases, and writes `postmortem-draft.md`. It runs on your local Claude Code subscription auth; no API key appears in the code.

```bash
# full investigation (uses the model)
npm run investigate -- "our support bot approved hundreds of fake refunds overnight"

# keyless mode for CI: stubs the model, still exercises the MCP server
npm run investigate -- --dry-run "runaway retry loop spammed customers"
```

Point it at a deployed server with `CASEBOOK_MCP_URL=https://casebook-mcp.<account>.workers.dev/mcp`.

## Example transcript

```
$ npm run investigate -- --dry-run "our support bot was tricked by text in a ticket into approving hundreds of refunds"
Wrote postmortem-draft.md (1091 chars)

$ head postmortem-draft.md
# Postmortem Draft (dry run)

## Incident

our support bot was tricked by text in a ticket into approving hundreds of refunds

## Similar documented failures (source: live (cached))

### APM-0003: Cursor support AI hallucinates login policy, triggering mass subscription cancellations
```

In full mode the agent additionally calls `get_case` on the top precedents and produces a structured draft with suspected failure mode, contributing factors, and remediations grounded in the documented lessons.

## Data

- Live: public read-only endpoints on [agentpostmortem.com](https://agentpostmortem.com) (`/api/export` for the corpus, `/api/search` for rich case detail, `/api/tags`).
- Bundled: `data/cases.json` holds 12 representative case files (prompt-injection refund exploit, runaway retry loop, stale-cache hallucination, tool-permission escalation, and more) used as an offline fallback and as the deterministic fixture for tests.

## Deploy

```bash
npx wrangler deploy
```
