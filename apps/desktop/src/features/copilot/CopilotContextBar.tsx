import { FileText, MapPin, Quote, X } from "lucide-react";
import type { CopilotPaperHandoff } from "./copilotHandoff";

interface CopilotContextBarProps {
  paperTitle: string;
  handoff: CopilotPaperHandoff | null;
  onRemovePage: () => void;
  onRemoveSelection: () => void;
}

export default function CopilotContextBar({
  paperTitle,
  handoff,
  onRemovePage,
  onRemoveSelection,
}: CopilotContextBarProps) {
  return (
    <div
      className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"
      style={{ borderColor: "var(--rc-border)", background: "var(--rc-header-bg)" }}
    >
      <span className="text-xs font-medium text-ink-tertiary">当前上下文</span>
      <ContextChip icon={FileText} label={`论文：${paperTitle}`} />
      {handoff?.page ? (
        <ContextChip icon={MapPin} label={`第 ${handoff.page} 页`} onRemove={onRemovePage} />
      ) : null}
      {handoff?.selection ? (
        <ContextChip
          icon={Quote}
          label={`选区：${handoff.selection.replace(/\s+/g, " ").slice(0, 36)}${handoff.selection.length > 36 ? "…" : ""}`}
          onRemove={onRemoveSelection}
        />
      ) : null}
    </div>
  );
}

function ContextChip({
  icon: Icon,
  label,
  onRemove,
}: {
  icon: typeof FileText;
  label: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex max-w-[min(28rem,70vw)] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-ink-secondary"
      style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-chip-shadow)" }}
      title={label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-apple-blue" />
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          className="ml-0.5 rounded-full p-0.5 text-ink-tertiary hover:text-ink-primary"
          onClick={onRemove}
          aria-label={`移除${label}`}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
