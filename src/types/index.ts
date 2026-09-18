import type { UserRole } from "@/lib/roles";

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

export type InstrumentType = "BILL" | "STATUTE" | "REGULATION";

export type InstrumentStatus =
  | "PROPOSED"
  | "PASSED"
  | "EFFECTIVE"
  | "ENJOINED"
  | "REPEALED";

export interface Instrument {
  id: string;
  jurisdictionId: string;
  type: InstrumentType;
  identifier: string;
  title: string;
  status: InstrumentStatus;
  introducedAt: string | null;
  passedAt: string | null;
  effectiveAt: string | null;
  sourceUrl: string | null;
  rawSummary: string | null;
  isTitleIXRelevant: boolean;
  relevanceConfidence: number | null;
  jurisdiction: Jurisdiction;
  issueTags: { issueTag: IssueTag }[];
  notes?: InstrumentNote[];
}

export interface InstrumentNote {
  id: string;
  instrumentId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string | null };
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

export interface HeatmapSummary {
  jurisdictionId: string;
  jurisdiction: Jurisdiction;
  relevantCount: number;
  pendingCount: number;
  issueTagCount: number;
  cellNoteCount: number;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}
