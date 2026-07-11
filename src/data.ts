// Data layer: pulls live case files from the AgentPostmortem public API,
// falling back to the bundled dataset when the network is unavailable.
import type { CaseFile, TagInfo } from "./types";
import bundledCases from "../data/cases.json";
import bundledTags from "../data/tags.json";

const LIVE_BASE = "https://agentpostmortem.com/api";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface LivePost {
  caseNumber: string;
  title: string;
  agentName: string;
  damageLevel: number;
  estimatedCostUsd: number | null;
  tags: string[];
  outcome: string;
  verifiedFacts?: string[];
  unknowns?: string[];
  lessons?: string[];
  sourceUrl?: string;
  createdAt?: string;
}

function normalize(p: LivePost): CaseFile {
  return {
    caseNumber: p.caseNumber,
    title: p.title,
    agentName: p.agentName,
    damageLevel: p.damageLevel,
    estimatedCostUsd: p.estimatedCostUsd,
    tags: p.tags ?? [],
    outcome: p.outcome,
    verifiedFacts: p.verifiedFacts ?? [],
    unknowns: p.unknowns ?? [],
    lessons: p.lessons ?? [],
    sourceUrl: p.sourceUrl,
    createdAt: p.createdAt,
  };
}

let corpusCache: { cases: CaseFile[]; at: number } | null = null;
let tagsCache: { tags: TagInfo[]; at: number } | null = null;

/** Minimal CSV parser for the /api/export feed (handles quoted fields). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.length > 0)) rows.push(row);
  return rows;
}

export function casesFromExportCsv(csv: string): CaseFile[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  return rows.slice(1).map((r) => ({
    caseNumber: r[idx("case_number")] ?? "",
    title: r[idx("title")] ?? "",
    agentName: r[idx("agent")] ?? "Unknown",
    damageLevel: parseInt(r[idx("damage_level")] ?? "0", 10) || 0,
    estimatedCostUsd: r[idx("estimated_cost_usd")]
      ? Number(r[idx("estimated_cost_usd")])
      : null,
    tags: (r[idx("tags")] ?? "").split("|").filter(Boolean),
    outcome: r[idx("outcome")] ?? "",
    verifiedFacts: [],
    unknowns: [],
    lessons: [],
    createdAt: r[idx("created_at")] || undefined,
  }));
}

/** Full corpus: live export feed when reachable, bundled dataset otherwise. */
export async function getCorpus(): Promise<{ cases: CaseFile[]; source: string }> {
  if (corpusCache && Date.now() - corpusCache.at < CACHE_TTL_MS) {
    return { cases: corpusCache.cases, source: "live (cached)" };
  }
  try {
    const res = await fetch(`${LIVE_BASE}/export`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const cases = casesFromExportCsv(await res.text());
      if (cases.length > 0) {
        corpusCache = { cases, at: Date.now() };
        return { cases, source: "live" };
      }
    }
  } catch {
    // fall through to bundled data
  }
  return { cases: bundledCases as CaseFile[], source: "bundled" };
}

/** Rich detail for one case, via the live search endpoint when possible. */
export async function getCaseDetail(id: string): Promise<CaseFile | null> {
  const wanted = id.trim().toUpperCase();
  try {
    const res = await fetch(
      `${LIVE_BASE}/search?q=${encodeURIComponent(wanted)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const body = (await res.json()) as { posts?: LivePost[] };
      const hit = (body.posts ?? []).find(
        (p) => p.caseNumber.toUpperCase() === wanted,
      );
      if (hit) return normalize(hit);
    }
  } catch {
    // fall through
  }
  const { cases } = await getCorpus();
  return cases.find((c) => c.caseNumber.toUpperCase() === wanted) ?? null;
}

export async function getTags(): Promise<TagInfo[]> {
  if (tagsCache && Date.now() - tagsCache.at < CACHE_TTL_MS) return tagsCache.tags;
  try {
    const res = await fetch(`${LIVE_BASE}/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const tags = (await res.json()) as TagInfo[];
      if (Array.isArray(tags) && tags.length > 0) {
        tagsCache = { tags, at: Date.now() };
        return tags;
      }
    }
  } catch {
    // fall through
  }
  return bundledTags as TagInfo[];
}
