import { Loader2 } from "lucide-react";
import type { ReviewFeedbackStatus } from "./shared";

interface ReviewSuggestionFeedbackPanelProps {
  suggestion: string;
  current?: { status: ReviewFeedbackStatus; reason: string };
  saving: boolean;
  onFeedback: (
    status: Exclude<ReviewFeedbackStatus, "pending">,
    reason?: string,
  ) => void | Promise<unknown>;
}

export default function ReviewSuggestionFeedbackPanel({
  suggestion,
  current,
  saving,
  onFeedback,
}: ReviewSuggestionFeedbackPanelProps) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: "var(--rc-card-inset-bg)" }}>
      <p className="text-xs leading-5 text-ink-secondary">{suggestion}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {([['adopted', '采纳'], ['done', '已完成']] as const).map(([status, label]) => (
          <button
            key={status}
            type="button"
            disabled={saving}
            onClick={() => void onFeedback(status)}
            className="rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
            style={{
              background: current?.status === status ? "#34C759" : "var(--rc-chip-bg)",
              color: current?.status === status ? "#fff" : "var(--rc-text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
        <select
          aria-label="忽略原因"
          disabled={saving}
          value={current?.status === "ignored" ? current.reason : ""}
          onChange={(event) => {
            if (event.target.value) void onFeedback("ignored", event.target.value);
          }}
          className="rounded-lg px-2 py-1 text-[11px] text-ink-secondary"
          style={{
            background: current?.status === "ignored" ? "rgba(255,59,48,0.10)" : "var(--rc-chip-bg)",
          }}
        >
          <option value="">忽略原因…</option>
          <option value="不准确">不准确</option>
          <option value="无法定位证据">无法定位证据</option>
          <option value="成本过高">成本过高</option>
          <option value="不符合研究目标">不符合研究目标</option>
          <option value="已由其他修改覆盖">已由其他修改覆盖</option>
        </select>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-tertiary" /> : null}
      </div>
    </div>
  );
}
