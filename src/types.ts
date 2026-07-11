export interface CaseFile {
  caseNumber: string;
  title: string;
  agentName: string;
  damageLevel: number;
  estimatedCostUsd: number | null;
  tags: string[];
  outcome: string;
  verifiedFacts: string[];
  unknowns: string[];
  lessons: string[];
  sourceUrl?: string;
  createdAt?: string;
}

export interface TagInfo {
  slug: string;
  label: string;
  description: string;
}
