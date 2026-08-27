import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import { History, RotateCcw, Save, Trash2, X } from "lucide-react";
import { Button, ConfirmDialog, IconButton } from "@research-copilot/ui";
import type {
  WritingVersionRecordResult,
  WritingVersionSnapshot,
  WritingVersionSummary,
} from "./shared";
import { formatWritingVersionTime } from "./shared";

interface WritingVersionHistoryModalProps {
  open: boolean;
  projectName: string;
  versions: WritingVersionSummary[];
  loading: boolean;
  preview: WritingVersionSnapshot | null;
  previewLoading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onSelectVersion: (id: string) => void;
  onRestore: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRecordManual: () => Promise<WritingVersionRecordResult | null>;
}

interface PendingAction {
  kind: "restore" | "delete";
  version: WritingVersionSummary;
}

export default function WritingVersionHistoryModal({
  open,
  projectName,
  versions,
  loading,
  preview,
  previewLoading,
  error,
  onClose,
  onRefresh,
  onSelectVersion,
  onRestore,
  onDelete,
  onRecordManual,
}: WritingVersionHistoryModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    setNotice("");
    onRefresh();
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // 仅在弹窗打开时刷新一次列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleRecordManual = async () => {
    setActing(true);
    const result = await onRecordManual();
    setActing(false);
    if (!result) return;
    setNotice(result.recorded ? "已记录当前内容为手动版本。" : "当前内容与最新版本一致，无需重复记录。");
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    setActing(true);
    const success = pendingAction.kind === "restore"
      ? await onRestore(pendingAction.version.id)
      : await onDelete(pendingAction.version.id);
    setActing(false);
    setPendingAction(null);
    if (success) {
      setNotice(pendingAction.kind === "restore" ? "已恢复到所选版本，当前内容已先自动备份。" : "已删除该版本。");
    }
  };

  const selectedVersionId = preview?.id ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center p-5"
        style={{ background: "var(--rc-modal-backdrop)", backdropFilter: "blur(8px)" }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border"
          style={{
            background: "var(--rc-modal-bg)",
            borderColor: "var(--rc-border)",
            boxShadow: "var(--rc-modal-shadow)",
          }}
        >
          <header className="flex shrink-0 items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--rc-border)" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-apple-blue/10 text-apple-blue">
              <History className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-bold text-ink-primary">历史版本</h2>
              <p className="mt-0.5 truncate text-xs text-ink-tertiary">{projectName}</p>
            </div>
            <Button type="button" size="sm" variant="secondary" loading={acting} onClick={() => void handleRecordManual()}>
              <Save className="h-3.5 w-3.5" />
              记录当前版本
            </Button>
            <IconButton ref={closeButtonRef} size="sm" aria-label="关闭历史版本" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </header>

          {(error || notice) && (
            <div
              className={clsx(
                "mx-5 mt-4 shrink-0 rounded-xl px-3 py-2 text-xs leading-5",
                error ? "text-apple-red" : "text-apple-blue",
              )}
              style={{ background: error ? "rgba(255,59,48,0.08)" : "rgba(0,122,255,0.08)" }}
            >
              {error || notice}
            </div>
          )}

          <div className="grid min-h-0 flex-1 gap-5 overflow-hidden p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,1.1fr)]">
            <section className="flex min-h-0 flex-col">
              <p className="shrink-0 text-sm font-semibold text-ink-primary">版本列表</p>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {loading && versions.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-ink-tertiary">正在加载历史版本...</p>
                ) : versions.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs leading-5 text-ink-tertiary">
                    暂无历史版本。内容变化会自动记录，也可以点击右上角「记录当前版本」手动保存。
                  </p>
                ) : (
                  versions.map((version) => (
                    <div
                      key={version.id}
                      className={clsx(
                        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selectedVersionId === version.id
                          ? "border-apple-blue/50 bg-apple-blue/5"
                          : "hover:bg-white/5",
                      )}
                      style={selectedVersionId === version.id ? undefined : { borderColor: "var(--rc-border)" }}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 text-left"
                        onClick={() => onSelectVersion(version.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-ink-primary">
                            {formatWritingVersionTime(version.createdAt)}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                            正文 {version.mainTexChars} 字 · 引用 {version.bibtexChars} 字 · 章节 {version.texFilesChars} 字 · 便签 {version.notesChars} 字
                          </span>
                        </span>
                        <span
                          className={clsx(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            version.source === "manual"
                              ? "bg-apple-blue/10 text-apple-blue"
                              : "bg-white/5 text-ink-tertiary",
                          )}
                        >
                          {version.source === "manual" ? "手动" : "自动"}
                        </span>
                      </button>
                      <div className="mt-2 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPendingAction({ kind: "restore", version })}
                          className="flex h-6 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-ink-tertiary transition-colors hover:bg-white/5 hover:text-apple-blue"
                        >
                          <RotateCcw className="h-3 w-3" />
                          恢复
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingAction({ kind: "delete", version })}
                          className="flex h-6 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-ink-tertiary transition-colors hover:bg-white/5 hover:text-apple-red"
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col">
              <p className="shrink-0 text-sm font-semibold text-ink-primary">版本预览（main.tex）</p>
              <div
                className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border"
                style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)" }}
              >
                {previewLoading ? (
                  <p className="px-3 py-6 text-center text-xs text-ink-tertiary">正在加载版本内容...</p>
                ) : preview ? (
                  <pre className="rc-selectable whitespace-pre-wrap px-4 py-3 font-mono text-[11.5px] leading-5 text-ink-secondary">
                    {preview.mainTex || "（该版本正文为空）"}
                  </pre>
                ) : (
                  <p className="px-3 py-6 text-center text-xs text-ink-tertiary">选择左侧版本查看内容预览。</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingAction?.kind === "restore"}
        title="恢复到此版本？"
        description={`将用 ${pendingAction ? formatWritingVersionTime(pendingAction.version.createdAt) : ""} 的版本覆盖当前文稿内容。恢复前会把当前内容自动保存为一个新版本，可随时再次恢复。`}
        confirmLabel="确认恢复"
        loading={acting}
        onConfirm={() => void handleConfirmAction()}
        onClose={() => setPendingAction(null)}
      />

      <ConfirmDialog
        open={pendingAction?.kind === "delete"}
        title="删除该历史版本？"
        description="删除后无法找回该版本快照，不影响当前文稿内容。"
        confirmLabel="确认删除"
        tone="danger"
        loading={acting}
        onConfirm={() => void handleConfirmAction()}
        onClose={() => setPendingAction(null)}
      />
    </>
  );
}
