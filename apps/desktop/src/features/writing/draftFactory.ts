import {
  DEFAULT_PROJECT_NAME,
  type LatexTemplate,
  type WritingDraft,
  type WritingDraftPatch,
} from "./shared";
import { normalizeWritingTexFiles } from "./texFiles";

export function createDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDraftFromTemplate(
  template: LatexTemplate,
  overrides: WritingDraftPatch & Partial<Pick<WritingDraft, "id" | "createdAt" | "updatedAt">> = {},
): WritingDraft {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? createDraftId(),
    projectName: overrides.projectName || DEFAULT_PROJECT_NAME,
    researchInterestId: overrides.researchInterestId || undefined,
    templateId: overrides.templateId ?? template.id,
    mainTex: overrides.mainTex ?? template.mainTex,
    bibtex: overrides.bibtex ?? template.bibtex,
    texFiles: normalizeWritingTexFiles(overrides.texFiles ?? []),
    notes: overrides.notes ?? "",
    imageAssets: overrides.imageAssets ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}
