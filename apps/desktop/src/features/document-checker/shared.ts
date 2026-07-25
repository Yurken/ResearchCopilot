import { deriveReferenceProfile } from "./referenceProfile";
import { evaluateCandidate } from "./rules/candidateRules";
import { buildLayoutComparisons } from "./rules/layoutRules";
import type {
  DocumentCheckIssue,
  DocumentComparisonItem,
  DocumentComparisonReport,
  DocumentInspection,
  ReferenceDocumentMode,
} from "./types";

export * from "./types";
export { deriveReferenceProfile } from "./referenceProfile";

function issueFromComparison(item: DocumentComparisonItem): DocumentCheckIssue {
  return {
    id: item.id,
    severity: item.severity,
    category: item.category,
    message: `${item.label}与规范文档不一致`,
    suggestion: item.suggestion,
    expected: item.expected,
    actual: item.actual,
    basis: item.basis,
  };
}

export function compareDocuments(
  reference: DocumentInspection,
  candidate: DocumentInspection,
  referenceMode: ReferenceDocumentMode = "explicit_rules",
): DocumentComparisonReport {
  const profile = deriveReferenceProfile(reference, referenceMode);
  const comparisons = buildLayoutComparisons(profile, candidate);
  const candidateResult = evaluateCandidate(candidate);
  const mismatches = comparisons.filter((item) => item.status === "mismatch").map(issueFromComparison);
  const matched = comparisons.filter((item) => item.status === "match").map((item) => `${item.label}与规范文档一致`);

  return {
    reference,
    candidate,
    profile,
    comparisons,
    issues: [...mismatches, ...candidateResult.issues],
    notices: candidateResult.notices,
    passed: [...matched, ...candidateResult.passed],
    checkedAt: new Date().toISOString(),
  };
}
