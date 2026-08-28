import {
  DEFAULT_PROJECT_NAME,
  WRITING_ACTIVE_DRAFT_KEY,
  WRITING_LIBRARY_STORAGE_KEY,
  WRITING_STORAGE_KEY,
  type WritingDraft,
  type WritingImageAsset,
  type WritingTemplateId,
} from "./shared";
import { createDraftFromTemplate, createDraftId } from "./draftFactory";
import { getDefaultWritingTemplate, getWritingTemplate } from "./templates";
import { normalizeWritingTexFiles } from "./texFiles";

/** 旧 localStorage 草稿库已完成一次性迁移的标记；旧 key 本体保留不删。 */
export const WRITING_LIBRARY_MIGRATED_KEY = "rc:writing:library:migrated:v1";

export interface LoadedDraftLibrary {
  drafts: WritingDraft[];
  activeDraftId: string;
}

export interface WritingDraftMigrationSummary {
  attempted: number;
  imported: number;
  /** 后端已存在同 id 草稿而跳过。 */
  skipped: number;
  failed: number;
  /** 仅含草稿 id / 项目名，不含正文内容。 */
  errors: string[];
}

interface PersistedWritingState {
  projectName?: string;
  templateId?: WritingTemplateId;
  mainTex?: string;
  bibtex?: string;
  texFiles?: unknown[];
  notes?: string;
}

interface PersistedWritingLibrary {
  drafts?: unknown[];
}

/** 非 Tauri 环境的降级读取：沿用旧 localStorage 草稿库。 */
export function loadLocalDraftLibrary(): LoadedDraftLibrary {
  const fallbackDraft = createDraftFromTemplate(getDefaultWritingTemplate());

  try {
    const raw = localStorage.getItem(WRITING_LIBRARY_STORAGE_KEY);
    const activeDraftId = localStorage.getItem(WRITING_ACTIVE_DRAFT_KEY) || "";
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedWritingLibrary | unknown[];
      const source = Array.isArray(parsed) ? parsed : parsed.drafts;
      const drafts = Array.isArray(source)
        ? source.map(normalizePersistedDraft).filter((draft): draft is WritingDraft => Boolean(draft))
        : [];
      if (drafts.length > 0) {
        return {
          drafts,
          activeDraftId: drafts.some((draft) => draft.id === activeDraftId) ? activeDraftId : drafts[0].id,
        };
      }
    }

    const migratedDraft = loadLegacyDraft();
    if (migratedDraft) {
      return { drafts: [migratedDraft], activeDraftId: migratedDraft.id };
    }
  } catch {
    return { drafts: [fallbackDraft], activeDraftId: fallbackDraft.id };
  }

  return { drafts: [fallbackDraft], activeDraftId: fallbackDraft.id };
}

/** 旧 key 存在且尚未标记迁移完成时才需要导入。 */
export function isLegacyMigrationPending(): boolean {
  try {
    if (localStorage.getItem(WRITING_LIBRARY_MIGRATED_KEY)) return false;
    return Boolean(
      localStorage.getItem(WRITING_LIBRARY_STORAGE_KEY) || localStorage.getItem(WRITING_STORAGE_KEY),
    );
  } catch {
    return false;
  }
}

/** 汇总两个旧 key 中的全部草稿（保留原 id 与时间戳），按 id 去重（草稿库优先）。 */
export function readLegacyDraftsForMigration(): WritingDraft[] {
  const drafts: WritingDraft[] = [];
  const seen = new Set<string>();
  const push = (draft: WritingDraft | null) => {
    if (!draft || seen.has(draft.id)) return;
    seen.add(draft.id);
    drafts.push(draft);
  };

  try {
    const raw = localStorage.getItem(WRITING_LIBRARY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedWritingLibrary | unknown[];
      const source = Array.isArray(parsed) ? parsed : parsed.drafts;
      if (Array.isArray(source)) {
        for (const value of source) push(normalizePersistedDraft(value));
      }
    }
  } catch {
    // 单个旧 key 解析失败不阻塞另一个 key。
  }
  push(loadLegacyDraft());
  return drafts;
}

/** 逐条导入，失败不阻塞其他条；返回汇总报告（不含正文）。 */
export async function migrateLegacyDrafts(options: {
  drafts: WritingDraft[];
  existingIds: Set<string>;
  importDraft: (draft: WritingDraft) => Promise<void>;
}): Promise<WritingDraftMigrationSummary> {
  const summary: WritingDraftMigrationSummary = {
    attempted: options.drafts.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  for (const draft of options.drafts) {
    if (options.existingIds.has(draft.id)) {
      summary.skipped += 1;
      continue;
    }
    try {
      await options.importDraft(draft);
      summary.imported += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error ?? "未知错误");
      summary.errors.push(`${draft.projectName || draft.id}: ${message}`);
    }
  }
  return summary;
}

/** 迁移成功后写标记，再次启动不重复导入；旧 key 数据保留。 */
export function markLegacyMigrationDone(summary: WritingDraftMigrationSummary): void {
  try {
    localStorage.setItem(
      WRITING_LIBRARY_MIGRATED_KEY,
      JSON.stringify({
        migratedAt: new Date().toISOString(),
        imported: summary.imported,
        skipped: summary.skipped,
      }),
    );
  } catch {
    // localStorage 不可用时下次启动重试，不影响主流程。
  }
}

function loadLegacyDraft(): WritingDraft | null {
  try {
    const raw = localStorage.getItem(WRITING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWritingState;
    const template = parsed.templateId ? getWritingTemplate(parsed.templateId) : getDefaultWritingTemplate();
    return createDraftFromTemplate(template, {
      projectName: parsed.projectName || DEFAULT_PROJECT_NAME,
      templateId: template.id,
      mainTex: parsed.mainTex || template.mainTex,
      bibtex: parsed.bibtex ?? template.bibtex,
      notes: parsed.notes ?? "",
    });
  } catch {
    return null;
  }
}

function normalizePersistedDraft(value: unknown): WritingDraft | null {
  if (!isRecord(value)) return null;
  const templateId = isWritingTemplateId(value.templateId) ? value.templateId : getDefaultWritingTemplate().id;
  const template = getWritingTemplate(templateId);
  const id = stringValue(value.id) || createDraftId();
  const projectName = stringValue(value.projectName) || DEFAULT_PROJECT_NAME;
  const researchInterestId = stringValue(value.researchInterestId) || undefined;
  const createdAt = stringValue(value.createdAt) || new Date().toISOString();
  const updatedAt = stringValue(value.updatedAt) || createdAt;

  return {
    id,
    projectName,
    researchInterestId,
    templateId,
    mainTex: typeof value.mainTex === "string" ? value.mainTex : template.mainTex,
    bibtex: typeof value.bibtex === "string" ? value.bibtex : template.bibtex,
    texFiles: normalizeWritingTexFiles(Array.isArray(value.texFiles) ? value.texFiles.filter(isWritingTexFile) : []),
    notes: typeof value.notes === "string" ? value.notes : "",
    imageAssets: normalizePersistedImageAssets(value.imageAssets),
    createdAt,
    updatedAt,
  };
}

function isWritingTemplateId(value: unknown): value is WritingTemplateId {
  return value === "journal" || value === "conference" || value === "thesis-note";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePersistedImageAssets(value: unknown): WritingImageAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizePersistedImageAsset)
    .filter((asset): asset is WritingImageAsset => Boolean(asset));
}

function isWritingTexFile(value: unknown): value is { path: string; content: string } {
  return isRecord(value) && typeof value.path === "string" && typeof value.content === "string";
}

function normalizePersistedImageAsset(value: unknown): WritingImageAsset | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const fileName = stringValue(value.fileName);
  const projectPath = stringValue(value.projectPath);
  const storedPath = stringValue(value.storedPath);
  const createdAt = stringValue(value.createdAt) || new Date().toISOString();

  if (!id || !fileName || !projectPath || !storedPath) return null;
  return { id, fileName, projectPath, storedPath, createdAt };
}
