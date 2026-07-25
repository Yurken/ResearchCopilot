export type DocumentCheckSeverity = "error" | "warning" | "info";
export type DocumentCheckCategory = "page" | "font" | "heading" | "figure" | "citation" | "hidden";
export type DocumentComparisonStatus = "match" | "mismatch" | "unavailable" | "not_applicable";
export type DocumentRole = "reference" | "candidate";
export type ReferenceDocumentMode = "explicit_rules" | "template";
export type PageNumberEvidence = "rendered" | "field_only" | "unavailable";

export interface UsageCount {
  value: string;
  characters: number;
}

export interface NumericUsageCount {
  value: number;
  characters: number;
}

export interface DocumentInspection {
  fileName: string;
  fileType: "pdf" | "docx";
  pageCount: number | null;
  pageWidthMm: number | null;
  pageHeightMm: number | null;
  marginsMm: { top: number; right: number; bottom: number; left: number } | null;
  fonts: string[];
  fontSizesPt: number[];
  fontUsage?: UsageCount[];
  fontSizeUsage?: NumericUsageCount[];
  text: string;
  pageNumbers: number[];
  pageNumberEvidence?: PageNumberEvidence;
  blankPages: number[];
  hasComments: boolean;
  hasRevisions: boolean;
}

export interface SelectedDocumentFile {
  path: string;
  name: string;
}

export interface DocumentCheckIssue {
  id: string;
  severity: DocumentCheckSeverity;
  category: DocumentCheckCategory;
  message: string;
  location?: string;
  suggestion: string;
  expected?: string;
  actual?: string;
  basis?: string;
}

export interface DocumentCheckNotice {
  id: string;
  category: DocumentCheckCategory;
  status: "unavailable" | "not_applicable";
  message: string;
  suggestion: string;
}

export interface DocumentComparisonItem {
  id: string;
  category: DocumentCheckCategory;
  label: string;
  expected: string;
  actual: string;
  status: DocumentComparisonStatus;
  severity: DocumentCheckSeverity;
  basis: string;
  suggestion: string;
}

export interface DocumentReferenceProfile {
  pageWidthMm: number | null;
  pageHeightMm: number | null;
  pageOrientation: "portrait" | "landscape" | null;
  marginsMm: DocumentInspection["marginsMm"];
  fonts: string[];
  fontSizePt: number | null;
  maxPages: number | null;
  pageBasis: string;
  orientationBasis: string;
  marginBasis: string;
  fontBasis: string;
  fontSizeBasis: string;
}

export interface DocumentComparisonReport {
  reference: DocumentInspection;
  candidate: DocumentInspection;
  profile: DocumentReferenceProfile;
  comparisons: DocumentComparisonItem[];
  issues: DocumentCheckIssue[];
  notices: DocumentCheckNotice[];
  passed: string[];
  checkedAt: string;
}
