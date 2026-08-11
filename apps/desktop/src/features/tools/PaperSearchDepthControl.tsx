import type { PaperSearchDepth } from "@research-copilot/types";

const OPTIONS: Array<{
  value: PaperSearchDepth;
  label: string;
  description: string;
}> = [
  { value: "quick", label: "快速", description: "最多 2 条学术查询，不检索正文或引文；适合快速预览。" },
  { value: "balanced", label: "平衡", description: "最多 4 条查询并补充正文片段，不扩展引文；默认推荐。" },
  { value: "deep", label: "深度", description: "最多 4 条查询，围绕 2 篇种子探索引文；覆盖更广、耗时更长。" },
];

interface PaperSearchDepthControlProps {
  value: PaperSearchDepth;
  onChange: (value: PaperSearchDepth) => void;
}

export function PaperSearchDepthControl({ value, onChange }: PaperSearchDepthControlProps) {
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[1];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-ink-tertiary">搜索预算</label>
        <span className="text-[11px] text-ink-tertiary">{current.description}</span>
      </div>
      <div
        className="grid grid-cols-3 gap-1 rounded-2xl p-1"
        style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-inset-shadow)" }}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            title={option.description}
            className="rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150"
            style={value === option.value
              ? { background: "var(--rc-elevated)", boxShadow: "var(--rc-raised-shadow)", color: "var(--rc-text)" }
              : { color: "var(--rc-text-muted)" }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
