import { ArrowRight, CircleHelp, History, Target, X } from "lucide-react";
import type { ResearchCheckpointHandoff } from "../research-context/checkpointHandoff";

interface CopilotCheckpointContextBarProps {
  handoff: ResearchCheckpointHandoff;
  onDismiss: () => void;
}

function preview(value: string, maxLength = 52): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

export default function CopilotCheckpointContextBar({
  handoff,
  onDismiss,
}: CopilotCheckpointContextBarProps) {
  const nextStep = handoff.nextSteps[0] || handoff.openQuestions[0] || handoff.summary;

  return (
    <div
      data-testid="checkpoint-context-bar"
      className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"
      style={{ borderColor: "var(--rc-border)", background: "var(--rc-header-bg)" }}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-tertiary">
        <History className="h-3.5 w-3.5 text-apple-blue" />
        从 checkpoint 续接
      </span>
      {handoff.goal ? <ContextChip icon={Target} label={`目标：${preview(handoff.goal)}`} /> : null}
      {nextStep ? (
        <ContextChip
          icon={handoff.nextSteps.length > 0 ? ArrowRight : CircleHelp}
          label={`${handoff.nextSteps.length > 0 ? "下一步" : "待确认"}：${preview(nextStep)}`}
        />
      ) : null}
      <span className="text-[11px] text-ink-quaternary">发送前可编辑；小妍会先核对历史记录。</span>
      <button
        type="button"
        aria-label="移除 checkpoint 续接上下文"
        className="ml-auto rounded-full p-1 text-ink-tertiary transition-colors hover:text-ink-primary"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
function ContextChip({
  icon: Icon,
  label,
}: {
  icon: typeof Target;
  label: string;
}) {
  return (
    <span
      className="inline-flex max-w-[min(30rem,70vw)] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-ink-secondary"
      style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-chip-shadow)" }}
      title={label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-apple-blue" />
      <span className="truncate">{label}</span>
    </span>
  );
}
