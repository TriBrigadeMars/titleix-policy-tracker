export interface Jurisdiction {
  id: string;
  code: string;
  name: string;
  level: "FEDERAL" | "STATE";
}

export interface IssueTag {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  description: string | null;
}

export interface Instrument {
  id: string;
  jurisdictionId: string;
  type: "BILL" | "STATUTE" | "REGULATION";
  identifier: string;
  title: string;
  status: "PROPOSED" | "PASSED" | "EFFECTIVE" | "ENJOINED" | "REPEALED";
  introducedAt: string | null;
  passedAt: string | null;
  effectiveAt: string | null;
  sourceUrl: string | null;
  rawSummary: string | null;
  isTitleIXRelevant: boolean;
  relevanceConfidence: number | null;
  jurisdiction: Jurisdiction;
  issueTags: { issueTag: IssueTag }[];
}

export interface CellNote {
  id: string;
  jurisdictionId: string;
  issueTagId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  jurisdiction: Jurisdiction;
  issueTag: IssueTag;
  author: { id: string; name: string | null };
}