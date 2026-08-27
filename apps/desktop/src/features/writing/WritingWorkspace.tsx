import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  CheckCircle2,
  ChevronLeft,
  Eye,
  FileCheck2,
  FileText,
  FolderOpen,
  LayoutPanelLeft,
  PenLine,
  Plus,
  Upload,
} from "lucide-react";
import { Button, CapsuleTabs } from "@research-copilot/ui";
import WritingAssistantPanel from "./WritingAssistantPanel";
import WritingDraftManagerModal from "./WritingDraftManagerModal";
import WritingEditorPanel from "./WritingEditorPanel";
import WritingExportMenu from "./WritingExportMenu";
import WritingLatexInstallNotice from "./WritingLatexInstallNotice";
import WritingNewDraftModal from "./WritingNewDraftModal";
import WritingPreviewPanel from "./WritingPreviewPanel";
import WritingSidebar from "./WritingSidebar";
import WritingVersionHistoryModal from "./WritingVersionHistoryModal";
import {
  isLatexCompilerMissing,
  type WritingAssistantActionId,
  type WritingCompileStatus,
  type WritingExportTarget,
  type WritingViewMode,
} from "./shared";
import { useWritingWorkspace } from "./useWritingWorkspace";
import "./writing-sidebar.css";

const VIEW_OPTIONS = [
  { value: "split", label: "分栏", icon: <LayoutPanelLeft className="h-3.5 w-3.5" /> },
  { value: "editor", label: "源码", icon: <FileText className="h-3.5 w-3.5" /> },
  { value: "preview", label: "预览", icon: <Eye className="h-3.5 w-3.5" /> },
] as const;

export default function WritingWorkspace({
  defaultResearchInterestId,
}: {
  defaultResearchInterestId?: string;
}) {
  const workspace = useWritingWorkspace();
  const showEditor = workspace.viewMode !== "preview";
  const showPreview = workspace.viewMode !== "editor";
  const showLatexInstallNotice = isLatexCompilerMissing(workspace.compileResult);
  const [draftManagerOpen, setDraftManagerOpen] = useState(false);
  const [newDraftModalOpen, setNewDraftModalOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [assistantRequest, setAssistantRequest] = useState<{
    actionId: WritingAssistantActionId;
    nonce: number;
    selectedText: string;
  } | null>(null);

  const handleAssistantAction = (actionId: WritingAssistantActionId) => {
    // 在动作触发瞬间（编辑器仍持有选区）抓取快照，避免焦点移到面板后选区丢失。
    const selectedText = workspace.getSelectedText();
    setAssistantOpen(true);
    setAssistantRequest((current) => ({ actionId, nonce: (current?.nonce ?? 0) + 1, selectedText }));
  };

  return (
    <div className="writing-workspace-frame">
      <div className="writing-workspace flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b px-4 py-3 app-header" style={{ borderColor: "var(--rc-border)", background: "var(--rc-header-bg)" }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-apple-blue/10 text-apple-blue">
              <PenLine className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight text-ink-primary">论文撰写</h1>
              <div className="flex items-center gap-2 text-xs text-ink-tertiary">
                {workspace.lastSavedAt ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#34C759]" />
                    已自动保存 {workspace.lastSavedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : (
                  <span>正在准备自动保存...</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setNewDraftModalOpen(true)}
              title="新增文稿"
            >
              <Plus className="h-3.5 w-3.5" />
              新增文稿
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setDraftManagerOpen(true)}
              title="打开文稿管理"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              文稿管理
            </Button>

            <div>
              <CapsuleTabs
                value={workspace.viewMode}
                onChange={(v) => workspace.setViewMode(v as WritingViewMode)}
                options={VIEW_OPTIONS}
                compact
              />
            </div>

            <div className="flex items-center gap-2 border-l pl-3" style={{ borderColor: "var(--rc-border)" }}>
              <Button type="button" size="sm" variant="secondary" onClick={() => void workspace.importTexFile()} title="导入 .tex">
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">导入</span>
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void workspace.importTexProject()} title="导入包含章节文件的 LaTeX 项目目录">
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">导入项目</span>
              </Button>

              <div className="flex items-center gap-1 rounded-xl bg-apple-blue/5 p-1">
                <CompileButton
                  compileStatus={workspace.compileStatus}
                  exportingTarget={workspace.exportingTarget}
                  onCompile={() => void workspace.compilePdf()}
                />
              </div>

              <div className="ml-1 flex items-center gap-1.5">
                <WritingExportMenu
                  exportingTarget={workspace.exportingTarget}
                  onExport={(target) => void workspace.exportProject(target)}
                />
              </div>
            </div>
          </div>
        </div>

        {(workspace.message || workspace.error) && (
          <div
            className={clsx(
              "mt-3 rounded-xl px-3 py-2 text-xs leading-5",
              workspace.error ? "text-apple-red" : "text-apple-blue",
            )}
            style={{
              background: workspace.error ? "rgba(255,59,48,0.08)" : "rgba(0,122,255,0.08)",
            }}
          >
            {workspace.error || workspace.message}
          </div>
        )}

        {showLatexInstallNotice ? (
          <div className="mt-3">
            <WritingLatexInstallNotice
              openingInstaller={workspace.latexInstallerStatus === "opening"}
              onDownloadInstaller={() => void workspace.openLatexInstaller()}
              onOpenInstallGuide={() => void workspace.openLatexDownloadPage()}
            />
          </div>
        ) : null}
      </header>

      <div
        className="grid min-h-0 flex-1 gap-3 px-4 py-3"
        style={{
          gridTemplateColumns:
            workspace.viewMode === "split"
              ? sidebarCollapsed
                ? "minmax(0,1fr) 24rem"
                : "18rem minmax(0,1fr) 24rem"
              : workspace.viewMode === "editor"
                ? sidebarCollapsed
                  ? "minmax(0,1fr)"
                  : "18rem minmax(0,1fr)"
                : "1fr",
        }}
      >
        {workspace.viewMode !== "preview" && !sidebarCollapsed && (
          <div className="relative min-h-0">
            <WritingSidebar
              outline={workspace.outline}
              diagnostics={workspace.diagnostics}
              stats={workspace.stats}
              notes={workspace.notes}
              onJumpToLine={workspace.jumpToLine}
              onNotesChange={workspace.setNotes}
            />
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              title="收起侧栏"
              className="absolute -right-2 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-ink-tertiary transition-colors hover:text-ink-primary"
              style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-bg)" }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {showEditor ? (
          <WritingEditorPanel
            editorRef={workspace.editorRef}
            mainTex={workspace.mainTex}
            bibtex={workspace.bibtex}
            texFiles={workspace.texFiles}
            imageAssets={workspace.imageAssets}
            activeSource={workspace.activeSource}
            onActiveSourceChange={workspace.setActiveSource}
            onSourceChange={workspace.updateSourceContent}
            onCreateTexFile={workspace.createTexFile}
            onRenameTexFile={workspace.renameTexFile}
            onDeleteTexFile={workspace.deleteTexFile}
            onInsertText={workspace.insertText}
            onInsertImage={workspace.insertImage}
            onAssistantAction={handleAssistantAction}
            onOpenVersionHistory={() => setVersionHistoryOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
          />
        ) : null}

        {showPreview ? (
          <WritingPreviewPanel
            blocks={workspace.previewBlocks}
            compileResult={workspace.compileResult}
            compact={workspace.viewMode === "split"}
          />
        ) : null}
      </div>

      {workspace.compileResult && (
        <footer className="shrink-0 border-t px-4 py-2" style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)" }}>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-ink-tertiary hover:text-ink-secondary">
              <div className={clsx("h-1.5 w-1.5 rounded-full", workspace.compileResult.success ? "bg-[#34C759]" : "bg-apple-red")} />
              编译日志 ({workspace.compileResult.engine}) · {workspace.compileResult.success ? "成功" : "失败"}
              <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">点击查看详细信息</span>
            </summary>
            <pre className="rc-selectable mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2 font-mono text-[10px] leading-4 text-ink-tertiary">
              {workspace.compileResult.log || "没有编译日志。"}
            </pre>
          </details>
        </footer>
      )}

      <WritingDraftManagerModal
        open={draftManagerOpen}
        drafts={workspace.drafts}
        activeDraftId={workspace.activeDraftId}
        projectName={workspace.projectName}
        researchInterestId={workspace.researchInterestId}
        interests={workspace.interests}
        loadingInterests={workspace.loadingInterests}
        interestError={workspace.interestError}
        templates={workspace.templates}
        templateId={workspace.templateId}
        onClose={() => setDraftManagerOpen(false)}
        onDraftChange={workspace.setActiveDraftId}
        onCreateDraft={() => setNewDraftModalOpen(true)}
        onDeleteDraft={workspace.deleteDraft}
        onProjectNameChange={workspace.setProjectName}
        onResearchInterestChange={workspace.setResearchInterestId}
        onTemplateChange={workspace.applyTemplate}
        onReset={workspace.resetWorkspace}
      />

      <WritingVersionHistoryModal
        open={versionHistoryOpen}
        projectName={workspace.projectName}
        versions={workspace.versionHistory.versions}
        loading={workspace.versionHistory.loadingVersions}
        preview={workspace.versionHistory.preview}
        previewLoading={workspace.versionHistory.previewLoading}
        error={workspace.versionHistory.error}
        onClose={() => setVersionHistoryOpen(false)}
        onRefresh={() => void workspace.versionHistory.refreshVersions()}
        onSelectVersion={(id) => void workspace.versionHistory.loadVersionPreview(id)}
        onRestore={(id) => workspace.versionHistory.restoreVersion(id)}
        onDelete={(id) => workspace.versionHistory.deleteVersion(id)}
        onRecordManual={() => workspace.versionHistory.recordManualVersion()}
      />

      <WritingNewDraftModal
        open={newDraftModalOpen}
        templates={workspace.templates}
        interests={workspace.interests}
        loadingInterests={workspace.loadingInterests}
        interestError={workspace.interestError}
        defaultResearchInterestId={defaultResearchInterestId ?? workspace.researchInterestId}
        defaultTemplateId={workspace.templateId}
        onClose={() => setNewDraftModalOpen(false)}
        onCreateDraft={workspace.createDraft}
      />

      <WritingAssistantPanel
        open={assistantOpen}
        projectName={workspace.projectName}
        mainTex={workspace.mainTex}
        bibtex={workspace.bibtex}
        texFiles={workspace.texFiles}
        notes={workspace.notes}
        outline={workspace.outline}
        diagnostics={workspace.diagnostics}
        stats={workspace.stats}
        onApplyText={workspace.insertGeneratedText}
        requestedAction={assistantRequest}
        onClose={() => setAssistantOpen(false)}
      />
      </div>
    </div>
  );
}

function CompileButton({
  compileStatus,
  exportingTarget,
  onCompile,
}: {
  compileStatus: WritingCompileStatus;
  exportingTarget: WritingExportTarget | null;
  onCompile: () => void;
}) {
  const [flash, setFlash] = useState(false);
  const prevStatusRef = useRef(compileStatus);

  useEffect(() => {
    if (prevStatusRef.current !== "ready" && compileStatus === "ready") {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 3000);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = compileStatus;
  }, [compileStatus]);

  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      onClick={onCompile}
      loading={compileStatus === "compiling"}
      disabled={exportingTarget !== null}
      className="shadow-sm transition-colors duration-500"
      style={flash ? { background: "#34C759", color: "#fff" } : undefined}
    >
      {compileStatus !== "compiling" && !flash && (
        <FileCheck2 className="h-3.5 w-3.5" />
      )}
      {flash ? (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          编译完成
        </span>
      ) : (
        "编译 PDF"
      )}
    </Button>
  );
}
