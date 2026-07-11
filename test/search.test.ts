import { describe, it, expect } from "vitest";
import { tokenize, scoreCase, searchCases, similarCases } from "../src/search";
import { casesFromExportCsv, parseCsv } from "../src/data";
import type { CaseFile } from "../src/types";
import cases from "../data/cases.json";

const corpus = cases as CaseFile[];

describe("tokenize", () => {
  it("lowercases, splits, and drops stopwords and short tokens", () => {
    expect(tokenize("The Agent WAS stuck in an Infinite-Loop!")).toEqual([
      "agent",
      "stuck",
      "infinite",
      "loop",
    ]);
  });
});

describe("searchCases ranking", () => {
  it("ranks the prompt-injection refund case first for a refund query", () => {
    const results = searchCases(corpus, "refund prompt injection");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].caseNumber).toBe("CB-0001");
  });

  it("weights title matches above body matches", () => {
    const titleHit = corpus.find((c) => c.caseNumber === "CB-0002")!;
    const tokens = tokenize("retry loop email");
    const other = corpus.find((c) => c.caseNumber === "CB-0003")!;
    expect(scoreCase(titleHit, tokens)).toBeGreaterThan(scoreCase(other, tokens));
  });

  it("returns no results for gibberish", () => {
    expect(searchCases(corpus, "zzqqxv flurble")).toHaveLength(0);
  });

  it("limits results", () => {
    expect(searchCases(corpus, "agent", { limit: 3 }).length).toBeLessThanOrEqual(3);
  });
});

describe("searchCases tag filter", () => {
  it("only returns cases carrying the tag", () => {
    const results = searchCases(corpus, "agent", { tag: "infinite-loop" });
    expect(results.length).toBeGreaterThan(0);
    for (const c of results) expect(c.tags).toContain("infinite-loop");
  });

  it("tag filter is case-insensitive", () => {
    const results = searchCases(corpus, "agent", { tag: "INFINITE-LOOP" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("empty query with tag returns all tagged cases", () => {
    const results = searchCases(corpus, "", { tag: "hallucination" });
    expect(results.map((c) => c.caseNumber)).toContain("CB-0003");
  });
});

describe("similarCases", () => {
  it("finds the cookie-exfiltration case for a browsing incident", () => {
    const matches = similarCases(
      corpus,
      "our browser agent pasted session cookies into a form on a malicious page",
    );
    expect(matches[0].case.caseNumber).toBe("CB-0006");
    expect(matches[0].overlap).toContain("cookies");
  });

  it("caps the number of matches", () => {
    const matches = similarCases(corpus, "agent failure production data", 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

describe("CSV export parsing", () => {
  it("parses quoted fields containing commas and newlines", () => {
    const rows = parseCsv('a,"b, with comma","c\nnewline"\n1,2,3');
    expect(rows).toEqual([["a", "b, with comma", "c\nnewline"], ["1", "2", "3"]]);
  });

  it("maps export columns onto CaseFile", () => {
    const csv =
      "case_number,title,agent,company,damage_level,estimated_cost_usd,vote_score,tags,author,created_at,outcome\n" +
      'APM-0001,Test case,Claude,Acme,3,1200,5,security-fail|hallucination,anon,2026-01-01,"It failed, badly"';
    const parsed = casesFromExportCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      caseNumber: "APM-0001",
      agentName: "Claude",
      damageLevel: 3,
      estimatedCostUsd: 1200,
      tags: ["security-fail", "hallucination"],
      outcome: "It failed, badly",
    });
  });
});
