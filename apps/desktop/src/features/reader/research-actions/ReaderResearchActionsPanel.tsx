import { BookOpenText, FileQuestion, FlaskConical, Loader2, NotebookPen, Quote } from "lucide-react";
import type { Paper } from "@research-copilot/types";
import { useReaderResearchActions } from "./useReaderResearchActions";
import { derivePaperResearchStatus } from "./shared";

interface ReaderResearchActionsPanelProps {
  paper: Paper | null;
  page: number;
  selection?: string;
  pageText?: string;
  width: number;
  onCollapse: () => void;
  onDragStart: (event: React.MouseEvent) => void;
}

export default function ReaderResearchActionsPanel({
  paper,
  page,
  selection,
  pageText,
  width,
  onCollapse,
  onDragStart,
}: ReaderResearchActionsPanelProps) {
  const actions = useReaderResearchActions(paper, page, selection, pageText);
  const status = paper ? derivePaperResearchStatus(paper) : null;
  return (
    <aside
      className="relative flex shrink-0 flex-col border-l"
      style={{ width, borderColor: "var(--rc-border)", background: "var(--rc-card-bg)" }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize"
        onMouseDown={onDragStart}
      />
      <div className="flex items-start justify-between border-b px-4 py-3" style={{ borderColor: "var(--rc-border)" }}>
        <div>
          <h2 className="text-sm font-semibold text-ink-primary">继续研究</h2>
          <p className="mt-1 text-xs text-ink-tertiary">第 {page} 页 · {paper?.title || "正在载入论文"}</p>
        </div>
        <button type="button" onClick={onCollapse} className="text-xs text-ink-tertiary hover:text-ink-primary">收起</button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {status ? (
          <div
            className="mb-3 rounded-2xl border px-3 py-3"
            style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-tertiary">当前阶段</span>
              <span className={`text-xs font-semibold ${status.tone === "danger" ? "text-apple-red" : status.tone === "success" ? "text-apple-green" : "text-apple-blue"}`}>
                {status.phase}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-secondary">下一步：{status.nextAction}</p>
            <p className="mt-1 text-[11px] text-ink-tertiary">
              已有资产：{status.assets.length ? status.assets.join("、") : "PDF 原文"}
            </p>
          </div>
        ) : null}
        <ActionButton
          icon={BookOpenText}
          title="让小妍解释当前页面"
          detail="携带论文和页码，在小妍中继续追问"
          onClick={() => actions.openCopilot("explain-page")}
          disabled={!paper}
        />
        <ActionButton
          icon={Quote}
          title="总结选中文字"
          detail={selection ? "携带当前选区并说明其在全文中的作用" : "请先在 PDF 中选择一段文字"}
          onClick={() => actions.openCopilot("summarize-selection")}
          disabled={!paper || !selection}
        />
        <ActionButton
          icon={NotebookPen}
          title="生成结构化论文笔记"
          detail="复用已有精读与复现结果沉淀知识笔记"
          onClick={() => void actions.generateNote()}
          disabled={!paper || actions.pending !== null}
          loading={actions.pending === "note"}
        />
        <ActionButton
          icon={FlaskConical}
          title="创建复现实验"
          detail="带入论文、方法、指标、步骤和风险"
          onClick={() => void actions.createExperiment()}
          disabled={!paper || actions.pending !== null}
          loading={actions.pending === "experiment"}
        />
        <ActionButton
          icon={FileQuestion}
          title="基于本文发起研究问题"
          detail="创建带 paper 上下文的小妍会话"
          onClick={() => actions.openCopilot("research-question")}
          disabled={!paper}
        />

        {actions.error ? (
          <div className="rounded-xl bg-apple-red/10 px-3 py-2 text-xs leading-5 text-apple-red">
            {actions.error}
          </div>
        ) : null}
        {actions.message ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-apple-green/10 px-3 py-2 text-xs text-apple-green">
            <span>{actions.message}</span>
            {actions.generatedNote ? (
              <button type="button" className="shrink-0 font-semibold hover:underline" onClick={actions.openGeneratedNote}>
                查看笔记
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function ActionButton({
  icon: Icon,
  title,
  detail,
  onClick,
  disabled,
  loading,
}: {
  icon: typeof BookOpenText;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45"
      style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-chip-shadow)" }}
    >
      <span className="mt-0.5 rounded-xl p-2 text-apple-blue" style={{ background: "var(--rc-chip-bg)" }}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-primary">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-ink-tertiary">{detail}</span>
      </span>
    </button>
  );
}
