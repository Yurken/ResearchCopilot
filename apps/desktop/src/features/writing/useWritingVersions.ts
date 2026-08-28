import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, formatErrorMessage } from "../../lib/client";
import {
  WRITING_VERSION_AUTO_DEBOUNCE_MS,
  WRITING_VERSION_AUTO_MIN_INTERVAL_MS,
  type WritingTexFile,
  type WritingVersionContentPatch,
  type WritingVersionRecordResult,
  type WritingVersionSnapshot,
  type WritingVersionSummary,
  writingVersionContentSignature,
} from "./shared";

interface UseWritingVersionsOptions {
  draftId: string;
  mainTex: string;
  bibtex: string;
  texFiles: WritingTexFile[];
  notes: string;
  /** 恢复版本时由调用方把快照内容写回草稿（后端不直接改草稿状态）。 */
  onApplyVersion: (patch: WritingVersionContentPatch) => void;
}

interface RecordedMarker {
  draftId: string;
  signature: string;
}

/**
 * 写作草稿历史版本：
 * - 自动记录跟随草稿内容变化，防抖 2s 且距上次记录至少 60s（与后端节流一致），
 *   本地签名未变化时不发起 invoke，避免流式打字期间高频调用。
 * - 恢复前先把当前内容强制记录为 auto 版本，防止丢失。
 */
export function useWritingVersions({
  draftId,
  mainTex,
  bibtex,
  texFiles,
  notes,
  onApplyVersion,
}: UseWritingVersionsOptions) {
  const [versions, setVersions] = useState<WritingVersionSummary[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [preview, setPreview] = useState<WritingVersionSnapshot | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");

  const contentRef = useRef({ draftId, mainTex, bibtex, texFiles, notes });
  contentRef.current = { draftId, mainTex, bibtex, texFiles, notes };
  const lastRecordedRef = useRef<RecordedMarker | null>(null);
  const lastRecordAtRef = useRef(0);

  const recordAutoVersion = useCallback(async () => {
    const snapshot = contentRef.current;
    if (!snapshot.draftId) return;
    const signature = writingVersionContentSignature(snapshot);
    const last = lastRecordedRef.current;
    if (last && last.draftId === snapshot.draftId && last.signature === signature) return;
    try {
      const result = await apiClient.writing.recordVersion({ ...snapshot, source: "auto" });
      lastRecordAtRef.current = Date.now();
      if (result.recorded || result.reason === "unchanged") {
        lastRecordedRef.current = { draftId: snapshot.draftId, signature };
      }
    } catch {
      // 非 Tauri 运行环境或写入失败时静默跳过，不打断写作。
    }
  }, []);

  useEffect(() => {
    if (!draftId) return;
    const signature = writingVersionContentSignature({ mainTex, bibtex, texFiles, notes });
    const last = lastRecordedRef.current;
    if (last && last.draftId === draftId && last.signature === signature) return;
    const elapsed = Date.now() - lastRecordAtRef.current;
    const wait = Math.max(
      WRITING_VERSION_AUTO_DEBOUNCE_MS,
      WRITING_VERSION_AUTO_MIN_INTERVAL_MS - elapsed,
    );
    const timer = window.setTimeout(() => {
      void recordAutoVersion();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [draftId, mainTex, bibtex, texFiles, notes, recordAutoVersion]);

  useEffect(() => {
    setVersions([]);
    setPreview(null);
    setError("");
  }, [draftId]);

  const refreshVersions = useCallback(async () => {
    if (!draftId) {
      setVersions([]);
      return;
    }
    setLoadingVersions(true);
    try {
      setVersions(await apiClient.writing.listVersions(draftId));
      setError("");
    } catch (loadError) {
      setError(formatErrorMessage(loadError));
    } finally {
      setLoadingVersions(false);
    }
  }, [draftId]);

  const loadVersionPreview = useCallback(async (versionId: string) => {
    setPreviewLoading(true);
    try {
      setPreview(await apiClient.writing.getVersion(versionId));
      setError("");
    } catch (loadError) {
      setError(formatErrorMessage(loadError));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  /** 手动记录当前内容。返回后端结果；失败时返回 null 并填充 error。 */
  const recordManualVersion = useCallback(async (): Promise<WritingVersionRecordResult | null> => {
    try {
      const snapshot = contentRef.current;
      const result = await apiClient.writing.recordVersion({ ...snapshot, source: "manual" });
      if (result.recorded || result.reason === "unchanged") {
        lastRecordedRef.current = {
          draftId: snapshot.draftId,
          signature: writingVersionContentSignature(snapshot),
        };
        lastRecordAtRef.current = Date.now();
      }
      await refreshVersions();
      return result;
    } catch (actionError) {
      setError(formatErrorMessage(actionError));
      return null;
    }
  }, [refreshVersions]);

  const restoreVersion = useCallback(async (versionId: string): Promise<boolean> => {
    setError("");
    const current = contentRef.current;
    try {
      // 恢复前先把当前内容强制记录为 auto 版本（跳过 60s 节流，hash 去重仍生效）。
      await apiClient.writing.recordVersion({ ...current, source: "auto", force: true });
    } catch (backupError) {
      setError(`恢复前备份当前内容失败：${formatErrorMessage(backupError)}`);
      return false;
    }

    try {
      const snapshot = await apiClient.writing.getVersion(versionId);
      onApplyVersion({
        mainTex: snapshot.mainTex,
        bibtex: snapshot.bibtex,
        texFiles: snapshot.texFiles,
        notes: snapshot.notes,
      });
      // 恢复后的内容刚落库，标记为已记录，避免恢复动作本身再触发一次冗余 auto 版本。
      lastRecordedRef.current = {
        draftId: current.draftId,
        signature: writingVersionContentSignature(snapshot),
      };
      lastRecordAtRef.current = Date.now();
      setPreview(snapshot);
      await refreshVersions();
      return true;
    } catch (restoreError) {
      setError(formatErrorMessage(restoreError));
      return false;
    }
  }, [onApplyVersion, refreshVersions]);

  const deleteVersion = useCallback(async (versionId: string): Promise<boolean> => {
    try {
      await apiClient.writing.deleteVersion(versionId);
      setVersions((current) => current.filter((version) => version.id !== versionId));
      setPreview((current) => (current?.id === versionId ? null : current));
      return true;
    } catch (actionError) {
      setError(formatErrorMessage(actionError));
      return false;
    }
  }, []);

  /** 草稿删除时联动清空其全部版本；失败不阻塞草稿删除。 */
  const clearDraftVersions = useCallback(async (targetDraftId: string) => {
    try {
      await apiClient.writing.clearDraftVersions(targetDraftId);
    } catch {
      // 静默跳过：版本数据只是快照，清理失败可下次再清。
    }
    if (targetDraftId === contentRef.current.draftId) {
      setVersions([]);
      setPreview(null);
    }
  }, []);

  return {
    versions,
    loadingVersions,
    preview,
    previewLoading,
    error,
    refreshVersions,
    loadVersionPreview,
    recordManualVersion,
    restoreVersion,
    deleteVersion,
    clearDraftVersions,
  };
}
