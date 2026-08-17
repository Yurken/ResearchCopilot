import { useState } from "react";
import { ArrowRight, Check, CircleHelp, History, Pencil, Save, Target, Undo2, X } from "lucide-react";
import { checkpointFreshness, type ResearchCheckpointHandoff } from "../research-context/checkpointHandoff";
import { useCheckpointAssetDifferences } from "./useCheckpointAssetDifferences";

interface CopilotCheckpointContextBarProps {
  handoff: ResearchCheckpointHandoff;
  onDismiss: () => void;
  onReview: (status: "confirmed" | "corrected" | "withdrawn", note?: string) => void;
}

function preview(value: string, maxLength = 52): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

export default function CopilotCheckpointContextBar({
  handoff,
  onDismiss,
  onReview,
}: CopilotCheckpointContextBarProps) {
  const nextStep = handoff.nextSteps[0] || handoff.openQuestions[0] || handoff.summary;
  const freshness = checkpointFreshness(handoff.updatedAt);
  const differences = useCheckpointAssetDifferences(handoff);
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [correctionNote, setCorrectionNote] = useState(handoff.reviewNote ?? "");
  const freshnessLabel = freshness === "stale" ? "超过 30 天，先核对" : freshness === "aging" ? "超过 7 天，建议核对" : null;

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
      {freshnessLabel ? (
        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          {freshnessLabel}
        </span>
      ) : null}
      {differences.length > 0 ? (
        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300" title={differences.map((item) => item.field).join("、")}>
          当前资产有 {differences.length} 项变化，续接前请核对
        </span>
      ) : null}
      {handoff.reviewStatus === "pending" ? (
        <div className="flex items-center gap-1" data-testid="checkpoint-review-actions">
          <ReviewButton icon={Check} label="确认" onClick={() => onReview("confirmed")} />
          <ReviewButton icon={Pencil} label="修正" onClick={() => setEditingCorrection(true)} />
          <ReviewButton icon={Undo2} label="撤回" onClick={() => onReview("withdrawn")} />
        </div>
      ) : (
        <span className="rounded-full bg-apple-blue/10 px-2 py-1 text-[11px] text-apple-blue">
          {handoff.reviewStatus === "confirmed" ? "已确认" : handoff.reviewStatus === "corrected" ? "已修正" : "已撤回"}
        </span>
      )}
      {editingCorrection ? (
        <div className="flex min-w-[18rem] flex-1 items-center gap-1.5">
          <input aria-label="checkpoint 修正说明" value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} placeholder="说明哪些历史信息需要修正" className="min-w-0 flex-1 rounded-lg px-2 py-1 text-xs text-ink-secondary" style={{ background: "var(--rc-chip-bg)" }} />
          <ReviewButton icon={Save} label="保存修正" onClick={() => { if (!correctionNote.trim()) return; onReview("corrected", correctionNote.trim()); setEditingCorrection(false); }} />
        </div>
      ) : null}
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

function ReviewButton({ icon: Icon, label, onClick }: { icon: typeof Check; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-ink-secondary hover:text-apple-blue" style={{ background: "var(--rc-chip-bg)" }}>
      <Icon className="h-3 w-3" />{label}
    </button>
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
