import { useState, type Dispatch, type SetStateAction } from "react";
import { Bot, Download, History, Pencil, Save, Sparkles, Upload } from "lucide-react";
import { Button } from "@research-copilot/ui";
import RenameSavedEntryModal from "../../components/RenameSavedEntryModal";
import SubmissionPaperSidebar from "./SubmissionPaperSidebar";
import type { PaperVersion, Submission as SubmissionItem } from "./shared";
import { STATUS_CFG, computeLineDiff } from "./shared";

interface VersionWorkspaceProps {
  submissions: SubmissionItem[];
  versions: PaperVersion[];
  versionCounts: Record<string, number>;
  versionSubId: string;
  compareIds: [string, string] | null;
  renamingVersionId: string | null;
  onSelectSubmission: (submissionId: string) => void;
  onSetCompareIds: Dispatch<SetStateAction<[string, string] | null>>;
  onOpenSaveModal: () => void;
  onRenameVersion: (versionId: string, label: string) => Promise<boolean>;
  onUploadVersionFile: (versionId: string) => void | Promise<void>;
  onDownloadVersionFile: (filePath?: string) => void | Promise<void>;
  onPolishVersion: (version: PaperVersion) => void;
  onOpenMockReview: (version: PaperVersion) => void | Promise<void>;
}

export default function VersionWorkspace({
  submissions,
  versions,
  versionCounts,
  versionSubId,
  compareIds,
  renamingVersionId,
  onSelectSubmission,
  onSetCompareIds,
  onOpenSaveModal,
  onRenameVersion,
  onUploadVersionFile,
  onDownloadVersionFile,
  onPolishVersion,
  onOpenMockReview,
}: VersionWorkspaceProps) {
  const [renamingVersion, setRenamingVersion] = useState<PaperVersion | null>(null);
  const subVersions = versions;
  const currentSub = submissions.find((submission) => submission.id === versionSubId);
  const versionMap = new Map(versions.map((version) => [version.id, version]));

  const selectForCompare = (versionId: string, slot: 0 | 1) => {
    onSetCompareIds((currentCompareIds) => {
      const fallbackVersionId = subVersions[0]?.id ?? versionId;
      const nextCompareIds = currentCompareIds ?? [fallbackVersionId, fallbackVersionId];
      const updatedCompareIds: [string, string] = [nextCompareIds[0], nextCompareIds[1]];
      updatedCompareIds[slot] = versionId;
      return updatedCompareIds;
    });
  };

  const comparedOldVersion = compareIds ? versionMap.get(compareIds[0]) : undefined;
  const comparedNewVersion = compareIds ? versionMap.get(compareIds[1]) : undefined;
  const diffResult =
    compareIds && compareIds[0] !== compareIds[1] && comparedOldVersion && comparedNewVersion
      ? computeLineDiff(comparedOldVersion.content, comparedNewVersion.content)
      : null;
  const diffStats = diffResult?.reduce(
    (stats, line) => {
      if (line.type === "add") {
        stats.added += 1;
      } else if (line.type === "remove") {
        stats.removed += 1;
      }
      return stats;
    },
    { added: 0, removed: 0 }
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 xl:flex-row">
      <SubmissionPaperSidebar
        submissions={submissions}
        selectedSubmissionId={versionSubId}
        onSelectSubmission={onSelectSubmission}
        renderMeta={(submission, active) => {
          const statusStyle = STATUS_CFG[submission.status];
          return (
            <span
              className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={
                active
                  ? { background: "rgba(255,255,255,0.22)", color: "#fff" }
                  : { background: statusStyle.bg, color: statusStyle.color }
              }
            >
              {versionCounts[submission.id] ?? 0} 版本
            </span>
          );
        }}
      />

      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-ink-primary line-clamp-1">{currentSub?.title}</p>
            <p className="text-xs text-ink-tertiary mt-0.5">
              共 {subVersions.length} 个版本
              {compareIds && compareIds[0] !== compareIds[1] && "  ·  已选择两个版本对比"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={onOpenSaveModal}
          >
            <Save className="w-3.5 h-3.5" />
            记录版本
          </Button>
        </div>

        {subVersions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 opacity-50">
            <History className="w-10 h-10 text-ink-tertiary" />
            <p className="text-sm text-ink-tertiary">暂无版本记录，点击「记录版本」保存论文稿件快照</p>
          </div>
        ) : (
          <>
            <div className="space-y-0">
              {/* versions 统一为「最新在前」（created_at DESC），首个即最新版本 */}
              {subVersions.map((version, index) => {
                const isLatest = index === 0;
                const stageStyle = STATUS_CFG[version.stage];
                const inCompare = compareIds?.includes(version.id) ?? false;

                return (
                  <div key={version.id} className="flex gap-3">
                    <div className="flex flex-col items-center w-8 flex-shrink-0">
                      <div
                        className="w-3 h-3 rounded-full border-2 mt-4 flex-shrink-0 z-10"
                        style={
                          isLatest
                            ? { background: "#007AFF", borderColor: "#007AFF" }
                            : { background: "var(--rc-card-bg)", borderColor: "var(--rc-border)" }
                        }
                      />
                      {index < subVersions.length - 1 ? (
                        <div className="w-px flex-1 mt-1" style={{ background: "var(--rc-border)" }} />
                      ) : null}
                    </div>

                    <div
                      className="flex-1 mb-3 rounded-2xl p-3.5 transition-all duration-150"
                      style={{
                        background: inCompare
                          ? "color-mix(in srgb, var(--rc-accent) 8%, var(--rc-card-bg))"
                          : "var(--rc-card-bg)",
                        boxShadow: inCompare
                          ? "0 0 0 1.5px var(--rc-accent), var(--rc-card-flat-shadow)"
                          : "var(--rc-card-flat-shadow)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-ink-primary">{version.tag}</span>
                          <span className="text-sm text-ink-secondary">{version.label}</span>
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                            style={{ background: stageStyle.bg, color: stageStyle.color }}
                          >
                            {stageStyle.label}
                          </span>
                        </div>
                        <span className="text-[11px] text-ink-tertiary flex-shrink-0">
                          {version.createdAt.toLocaleDateString("zh-CN")}
                        </span>
                      </div>

                      {version.notes ? (
                        <p className="mt-1.5 text-xs text-ink-secondary leading-relaxed">{version.notes}</p>
                      ) : null}

                      <p className="mt-2 text-[11px] text-ink-tertiary line-clamp-2 leading-relaxed font-mono">
                        {version.content.slice(0, 120)}…
                      </p>

                      <div className="mt-2.5 flex items-center gap-2">
                        <span className="text-[10px] text-ink-tertiary">对比：</span>
                        {([0, 1] as const).map((slot) => (
                          <button
                            key={slot}
                            onClick={() => selectForCompare(version.id, slot)}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-lg transition-colors"
                            style={
                              compareIds?.[slot] === version.id
                                ? { background: "var(--rc-button-primary-bg)", color: "#fff" }
                                : {
                                    background: "var(--rc-card-inset-bg)",
                                    color: "var(--rc-text-muted)",
                                  }
                            }
                          >
                            {slot === 0 ? "旧" : "新"}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setRenamingVersion(version)}
                          className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                          style={{ background: "var(--rc-card-inset-bg)", color: "var(--rc-text-tertiary)" as string }}
                          title="重命名版本标签"
                        >
                          <Pencil className="w-3 h-3" />
                          重命名
                        </button>
                        <button
                          onClick={() => onUploadVersionFile(version.id)}
                          className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                          style={{
                            background: "var(--rc-card-inset-bg)",
                            color: "var(--rc-text-tertiary)" as string,
                          }}
                          title="上传论文 PDF"
                        >
                          <Upload className="w-3 h-3" />
                          上传
                        </button>

                        {version.filePath ? (
                          <button
                            onClick={() => onDownloadVersionFile(version.filePath)}
                            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                            style={{ background: "var(--rc-card-inset-bg)", color: "#007AFF" }}
                            title="下载论文 PDF"
                          >
                            <Download className="w-3 h-3" />
                            下载
                          </button>
                        ) : null}

                        {version.content.trim() ? (
                          <button
                            onClick={() => onPolishVersion(version)}
                            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-150"
                            style={{ background: "rgba(0,122,255,0.10)", color: "#007AFF" }}
                            title="AI 润色摘要/核心内容"
                          >
                            <Sparkles className="w-3 h-3" />
                            AI 润色
                          </button>
                        ) : null}

                        <button
                          onClick={() => onOpenMockReview(version)}
                          className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-150"
                          style={
                            version.filePath
                              ? { background: "rgba(175,82,222,0.12)", color: "#AF52DE" }
                              : {
                                  background: "var(--rc-card-inset-bg)",
                                  color: "var(--rc-text-tertiary)" as string,
                                }
                          }
                          title={version.filePath ? "从 PDF 文件生成 AI 审稿意见" : "从版本快照文本生成 AI 审稿意见"}
                        >
                          <Bot className="w-3 h-3" />
                          AI 审稿
                        </button>

                        {version.filePath ? (
                          <span className="text-[10px] text-ink-tertiary truncate flex-1">{version.fileName}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {diffResult && compareIds && diffStats ? (
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--rc-border)" }}>
                <div
                  className="px-4 py-2.5 flex items-center gap-2"
                  style={{ background: "var(--rc-card-inset-bg)", borderBottom: "1px solid var(--rc-border)" }}
                >
                  <History className="w-4 h-4 text-ink-tertiary" />
                  <span className="text-sm font-semibold text-ink-primary">差异对比</span>
                  <span className="text-xs text-ink-tertiary">
                    {comparedOldVersion?.tag}
                    {" → "}
                    {comparedNewVersion?.tag}
                  </span>
                  <div className="ml-auto flex items-center gap-3 text-[11px]">
                    <span style={{ color: "#34C759" }}>+{diffStats.added} 行新增</span>
                    <span style={{ color: "#FF3B30" }}>-{diffStats.removed} 行删除</span>
                  </div>
                </div>
                <div className="p-1 overflow-x-auto max-h-72 overflow-y-auto">
                  {diffResult.map((line, index) => (
                    <div
                      key={`${line.type}-${index}`}
                      className="flex items-baseline gap-2 px-3 py-0.5 rounded-lg text-xs font-mono leading-relaxed"
                      style={
                        line.type === "add"
                          ? { background: "rgba(52,199,89,0.10)", color: "#1A7F37" }
                          : line.type === "remove"
                            ? { background: "rgba(255,59,48,0.10)", color: "#C0392B" }
                            : { color: "var(--rc-text-secondary)" as string }
                      }
                    >
                      <span className="select-none w-3 flex-shrink-0 text-[10px]">
                        {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                      </span>
                      <span>{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <RenameSavedEntryModal
        open={renamingVersion !== null}
        title="重命名论文版本"
        description={renamingVersion ? `修改 ${renamingVersion.tag || "该版本"} 的显示标签，不会改变稿件内容。` : undefined}
        label="版本标签"
        initialValue={renamingVersion?.label ?? ""}
        placeholder="例如：按审稿意见修改"
        busy={renamingVersion !== null && renamingVersionId === renamingVersion.id}
        onClose={() => {
          if (!renamingVersionId) setRenamingVersion(null);
        }}
        onRename={(label) => renamingVersion ? onRenameVersion(renamingVersion.id, label) : false}
      />
    </div>
  );
}
