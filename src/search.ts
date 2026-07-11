// Pure search and ranking logic over case files. No I/O, fully unit-testable.
import type { CaseFile } from "./types";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "was", "were", "is", "are", "be", "been", "it", "its", "that",
  "this", "at", "by", "as", "from", "into", "our", "we", "my", "his",
  "her", "their", "then", "than", "so", "not", "no", "had", "has", "have",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function caseText(c: CaseFile): string {
  return [
    c.title,
    c.outcome,
    c.agentName,
    c.tags.join(" "),
    c.lessons.join(" "),
    c.verifiedFacts.join(" "),
  ].join(" ");
}

/**
 * Score a case against query tokens. Title hits weigh 3, tag hits 2,
 * body hits 1. Returns 0 when nothing matches.
 */
export function scoreCase(c: CaseFile, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const title = new Set(tokenize(c.title));
  const tags = new Set(c.tags.flatMap((t) => tokenize(t)));
  const body = new Set(tokenize(caseText(c)));
  let score = 0;
  for (const tok of tokens) {
    if (title.has(tok)) score += 3;
    else if (tags.has(tok)) score += 2;
    else if (body.has(tok)) score += 1;
  }
  return score;
}

export interface SearchOptions {
  tag?: string;
  limit?: number;
}

export function searchCases(
  cases: CaseFile[],
  query: string,
  opts: SearchOptions = {},
): CaseFile[] {
  const tokens = tokenize(query);
  let pool = cases;
  if (opts.tag) {
    const tag = opts.tag.toLowerCase();
    pool = pool.filter((c) => c.tags.some((t) => t.toLowerCase() === tag));
  }
  const scored = pool
    .map((c) => ({ c, score: scoreCase(c, tokens) }))
    .filter((s) => s.score > 0 || tokens.length === 0)
    .sort(
      (a, b) => b.score - a.score || a.c.caseNumber.localeCompare(b.c.caseNumber),
    );
  return scored.slice(0, opts.limit ?? 10).map((s) => s.c);
}

/** Keyword-overlap similarity for similar_failures. */
export function similarCases(
  cases: CaseFile[],
  description: string,
  limit = 5,
): { case: CaseFile; overlap: string[] }[] {
  const tokens = new Set(tokenize(description));
  return cases
    .map((c) => {
      const caseTokens = new Set(tokenize(caseText(c)));
      const overlap = [...tokens].filter((t) => caseTokens.has(t));
      return { case: c, overlap };
    })
    .filter((r) => r.overlap.length > 0)
    .sort(
      (a, b) =>
        b.overlap.length - a.overlap.length ||
        a.case.caseNumber.localeCompare(b.case.caseNumber),
    )
    .slice(0, limit);
}

export function summarize(c: CaseFile) {
  return {
    caseNumber: c.caseNumber,
    title: c.title,
    agent: c.agentName,
    damageLevel: c.damageLevel,
    estimatedCostUsd: c.estimatedCostUsd,
    tags: c.tags,
  };
}
