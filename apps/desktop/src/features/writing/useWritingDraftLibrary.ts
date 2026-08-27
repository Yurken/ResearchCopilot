import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient, formatErrorMessage } from "../../lib/client";
import {
  WRITING_ACTIVE_DRAFT_KEY,
  WRITING_LIBRARY_STORAGE_KEY,
  type WritingCreateDraftOptions,
  type WritingDraft,
  type WritingDraftPatch,
  type WritingResearchInterestSummary,
  writingResearchInterestTitle,
} from "./shared";
import { createDraftFromTemplate } from "./draftFactory";
import {
  isLegacyMigrationPending,
  loadLocalDraftLibrary,
  markLegacyMigrationDone,
  migrateLegacyDrafts,
  readLegacyDraftsForMigration,
  type WritingDraftMigrationSummary,
} from "./legacyDraftLibrary";
import { getDefaultWritingTemplate, getWritingTemplate } from "./templates";

/** 用于判断草稿内容是否变化（updatedAt 由保存动作自身刷新，不参与比较）。 */
function draftContentSignature(draft: WritingDraft): string {
  return JSON.stringify([
    draft.id,
    draft.projectName,
    draft.researchInterestId ?? "",
    draft.templateId,
    draft.mainTex,
    draft.bibtex,
    draft.texFiles,
    draft.notes,
    draft.imageAssets,
  ]);
}

/**
 * 写作草稿库：后端 SQLite 是唯一数据源，localStorage 只存活跃草稿 id 这类 UI 偏好。
 * 非 Tauri 环境（或后端异常）降级为旧 localStorage 读写，保持既有行为。
 * 启动时检测旧 localStorage 草稿库并做一次性导入（成功后写迁移标记，不删旧数据）。
 */
export function useWritingDraftLibrary() {
  const [drafts, setDrafts] = useState<WritingDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState("");
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [migrationSummary, setMigrationSummary] = useState<WritingDraftMigrationSummary | null>(null);
  const [interests, setInterests] = useState<WritingResearchInterestSummary[]>([]);
  const [loadingInterests, setLoadingInterests] = useState(true);
  const [interestError, setInterestError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  /** 已落库草稿的内容签名，用于 debounce 保存时只回写变化的草稿。 */
  const savedSignaturesRef = useRef<Map<string, string>>(new Map());
  const backendModeRef = useRef(false);

  const fallbackDraft = useMemo(() => createDraftFromTemplate(getDefaultWritingTemplate()), []);
  const activeDraft = drafts.find((draft) => draft.id === activeDraftId) ?? drafts[0] ?? fallbackDraft;

  useEffect(() => {
    let cancelled = false;

    const applyLibrary = (nextDrafts: WritingDraft[], nextActiveDraftId: string) => {
      savedSignaturesRef.current = new Map(
        nextDrafts.map((draft) => [draft.id, draftContentSignature(draft)]),
      );
      setDrafts(nextDrafts);
      setActiveDraftId(nextActiveDraftId);
    };

    const bootstrap = async () => {
      try {
        let list = await apiClient.writing.listDrafts();

        // 一次性迁移：旧 localStorage 草稿库导入后端（保留原 id 与时间戳）。
        if (isLegacyMigrationPending()) {
          const legacyDrafts = readLegacyDraftsForMigration();
          const summary = await migrateLegacyDrafts({
            drafts: legacyDrafts,
            existingIds: new Set(list.map((draft) => draft.id)),
            importDraft: async (draft) => {
              await apiClient.writing.createDraft(draft);
            },
          });
          if (summary.failed === 0) {
            markLegacyMigrationDone(summary);
          } else {
            // 失败条目下次启动重试（同 id 已导入的会被跳过）。
            console.warn("[writing] 旧草稿迁移存在失败条目：", summary.errors);
          }
          if (!cancelled) setMigrationSummary(summary);
          if (summary.imported > 0) {
            list = await apiClient.writing.listDrafts();
          }
        }

        if (list.length === 0) {
          const draft = createDraftFromTemplate(getDefaultWritingTemplate());
          await apiClient.writing.createDraft(draft);
          list = [draft];
        }

        if (cancelled) return;
        backendModeRef.current = true;
        const savedActiveId = localStorage.getItem(WRITING_ACTIVE_DRAFT_KEY) || "";
        applyLibrary(
          list,
          list.some((draft) => draft.id === savedActiveId) ? savedActiveId : list[0].id,
        );
      } catch (error) {
        if (cancelled) return;
        if (!isMissingTauriRuntime(error)) {
          setLibraryError(formatErrorMessage(error));
        }
        // 降级：沿用旧 localStorage 数据源（含 Web / 测试环境）。
        const loaded = loadLocalDraftLibrary();
        applyLibrary(loaded.drafts, loaded.activeDraftId);
      } finally {
        if (!cancelled) setLibraryReady(true);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // 防抖保存：后端模式下仅回写内容发生变化的草稿；降级模式沿用整库写 localStorage。
  useEffect(() => {
    if (!libraryReady) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(WRITING_ACTIVE_DRAFT_KEY, activeDraftId);
      } catch {
        // localStorage 不可用时仅影响活跃草稿记忆。
      }

      if (backendModeRef.current) {
        for (const draft of drafts) {
          const signature = draftContentSignature(draft);
          if (savedSignaturesRef.current.get(draft.id) === signature) continue;
          savedSignaturesRef.current.set(draft.id, signature);
          const savedSignature = signature;
          void apiClient.writing.updateDraft(draft).catch((error) => {
            // 保存失败时撤销签名，下次内容变化会重试。
            if (savedSignaturesRef.current.get(draft.id) === savedSignature) {
              savedSignaturesRef.current.delete(draft.id);
            }
            if (!isMissingTauriRuntime(error)) {
              setLibraryError(formatErrorMessage(error));
            }
          });
        }
      } else {
        try {
          localStorage.setItem(WRITING_LIBRARY_STORAGE_KEY, JSON.stringify({ drafts }));
        } catch {
          // 与旧行为一致：写失败不打断写作。
        }
      }
      setLastSavedAt(new Date());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeDraftId, drafts, libraryReady]);

  useEffect(() => {
    let cancelled = false;
    setLoadingInterests(true);

    apiClient.knowledge.listInterests()
      .then((data) => {
        if (cancelled) return;
        setInterests(data.map(({ id, topic, folder_name }) => ({ id, topic, folder_name })));
        setInterestError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setInterestError(isMissingTauriRuntime(error) ? "" : formatErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingInterests(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateActiveDraft = useCallback((patch: WritingDraftPatch) => {
    setDrafts((currentDrafts) => currentDrafts.map((draft) => (
      draft.id === activeDraftId
        ? { ...draft, ...normalizeDraftPatch(patch), updatedAt: new Date().toISOString() }
        : draft
    )));
  }, [activeDraftId]);

  const createDraft = useCallback((options: WritingCreateDraftOptions = {}) => {
    const targetInterestId = options.researchInterestId || undefined;
    const targetTemplate = options.templateId ? getWritingTemplate(options.templateId) : getDefaultWritingTemplate();
    const targetInterest = interests.find((interest) => interest.id === targetInterestId);
    const siblingCount = drafts.filter((draft) => (draft.researchInterestId ?? "") === (targetInterestId ?? "")).length;
    const projectName = targetInterest
      ? `${writingResearchInterestTitle(targetInterest)} · 文稿 ${siblingCount + 1}`
      : `未归档文稿 ${siblingCount + 1}`;
    const draft = createDraftFromTemplate(targetTemplate, {
      projectName,
      researchInterestId: targetInterestId,
      templateId: targetTemplate.id,
    });

    savedSignaturesRef.current.set(draft.id, draftContentSignature(draft));
    setDrafts((currentDrafts) => [draft, ...currentDrafts]);
    setActiveDraftId(draft.id);
    if (backendModeRef.current) {
      void apiClient.writing.createDraft(draft).catch((error) => {
        if (!isMissingTauriRuntime(error)) {
          setLibraryError(formatErrorMessage(error));
        }
      });
    }
    return draft;
  }, [drafts, interests]);

  const deleteDraft = useCallback((id: string) => {
    if (drafts.length <= 1) return false;
    const nextDrafts = drafts.filter((draft) => draft.id !== id);
    if (nextDrafts.length === drafts.length) return false;

    savedSignaturesRef.current.delete(id);
    setDrafts(nextDrafts);
    if (id === activeDraftId) {
      setActiveDraftId(nextDrafts[0].id);
    }
    if (backendModeRef.current) {
      // 历史版本由后端级联清理（writing_versions ON DELETE CASCADE）。
      void apiClient.writing.deleteDraft(id).catch((error) => {
        if (!isMissingTauriRuntime(error)) {
          setLibraryError(formatErrorMessage(error));
        }
      });
    }
    return true;
  }, [activeDraftId, drafts]);

  return {
    drafts,
    activeDraft,
    activeDraftId,
    interests,
    loadingInterests,
    interestError,
    libraryReady,
    libraryError,
    migrationSummary,
    lastSavedAt,
    setActiveDraftId,
    updateActiveDraft,
    createDraft,
    deleteDraft,
  };
}

function normalizeDraftPatch(patch: WritingDraftPatch): WritingDraftPatch {
  if (!("researchInterestId" in patch)) return patch;
  return { ...patch, researchInterestId: patch.researchInterestId || undefined };
}

function isMissingTauriRuntime(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("reading 'invoke'") || message.includes("__TAURI_INTERNALS__");
}
