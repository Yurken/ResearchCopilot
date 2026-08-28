import { AlertCircle, CheckCircle2, Clipboard, FileSearch, RotateCcw, Save } from "lucide-react";
import { Button, Card } from "@research-copilot/ui";
import SurveyCandidatePapersPanel from "./SurveyCandidatePapersPanel";
import SurveyReportContentPanel from "./SurveyReportContentPanel";
import SurveyRunSummaryPanel from "./SurveyRunSummaryPanel";
import type { SurveyGenerationController } from "./shared";

export default function SurveyResultsWorkspace({ controller }: { controller: SurveyGenerationController }) {
  if (!controller.hasResults) {
    const preparingNewSurvey = Boolean(controller.query.trim());
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
        >
          <FileSearch className="h-7 w-7 text-ink-tertiary" />
        </div>
        <div>
          <p className="font-medium text-ink-secondary">{preparingNewSurvey ? "旧综述已收起，请重新生成" : "请先输入研究问题"}</p>
          <p className="mt-1 text-sm text-ink-tertiary">
            {preparingNewSurvey
              ? "当前正在准备新的综述主题，历史结果请在底部历史记录中查看。"
              : "可展开「生成参数」指定时间范围、候选数量、文献类型与引用格式。"}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card padding="sm" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-primary">
            {controller.generating ? "正在生成综述" : controller.structured ? "综述已生成" : "综述草稿"}
          </p>
          <p className="mt-1 text-xs text-ink-tertiary">
            {controller.structured?.papers?.length
              ? `已整合 ${controller.structured.papers.length} 篇候选文献，可复制 Markdown 或沉淀为知识笔记。`
              : "生成过程中会逐步展示协作状态和流式草稿。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {controller.canResumeFailedRun ? (
            <Button variant="secondary" size="sm" onClick={() => void controller.handleResumeFailedRun()} loading={controller.generating}>
              <RotateCcw className="h-3.5 w-3.5" />
              从失败步骤继续
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => void controller.copySurveyMarkdown()} loading={controller.copying} disabled={!controller.canSaveResult}>
            <Clipboard className="h-3.5 w-3.5" />
            复制 Markdown
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void controller.saveSurveyAsNote()} loading={controller.savingNote} disabled={!controller.canSaveResult}>
            <Save className="h-3.5 w-3.5" />
            存为笔记
          </Button>
        </div>
      </Card>

      {controller.actionMessage ? (
        <div className="flex items-center gap-2 rounded-2xl border border-apple-green/10 bg-apple-green/10 px-3 py-2 text-xs text-apple-green">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {controller.actionMessage}
        </div>
      ) : null}
      {controller.actionError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-apple-red/10 bg-[#F7ECEA] px-3 py-2 text-xs text-apple-red">
          <AlertCircle className="h-3.5 w-3.5" />
          {controller.actionError}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SurveyRunSummaryPanel
            agents={controller.agents}
            structured={controller.structured}
            fallbackCitationFormatLabel={controller.citationFormatLabel}
            runFailed={Boolean(controller.error)}
          />
          <SurveyCandidatePapersPanel papers={controller.structured?.papers ?? []} />
        </div>

        <div className="space-y-4">
          <SurveyReportContentPanel
            structured={controller.structured}
            markdown={controller.content}
            generating={controller.generating}
            fallbackCitationFormatLabel={controller.citationFormatLabel}
          />
        </div>
      </div>
    </div>
  );
}
