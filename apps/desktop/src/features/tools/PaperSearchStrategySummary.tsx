import { Activity, Braces, Clock3, Coins, Database, GitBranch, Route } from "lucide-react";
import { Badge, Card } from "@research-copilot/ui";
import type { ArxivSearchResponse } from "@research-copilot/types";

interface PaperSearchStrategySummaryProps {
  result: ArxivSearchResponse;
}

const DEPTH_LABELS = {
  quick: "快速搜索",
  balanced: "平衡搜索",
  deep: "深度搜索",
} as const;

const FACET_LABELS: Array<{
  key: "concepts" | "methods" | "datasets" | "domains" | "venues" | "time_constraints";
  label: string;
}> = [
  { key: "concepts", label: "研究对象" },
  { key: "methods", label: "方法" },
  { key: "datasets", label: "数据集" },
  { key: "domains", label: "领域" },
  { key: "venues", label: "刊会" },
  { key: "time_constraints", label: "时间" },
];

function formatDuration(durationMs: number) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)} 秒` : `${durationMs} 毫秒`;
}

export function PaperSearchStrategySummary({ result }: PaperSearchStrategySummaryProps) {
  const { search_intent: intent, strategy_trace: trace, metrics } = result;
  if (!intent && !trace?.length && !metrics) return null;

  const metricItems = metrics ? [
    { label: "学术 API", value: metrics.academic_api_calls, icon: Database },
    { label: "网络 API", value: metrics.web_api_calls, icon: Activity },
    { label: "LLM 调用", value: metrics.llm_calls, icon: Braces },
    { label: "估算 Token", value: metrics.estimated_tokens.toLocaleString("zh-CN"), icon: Coins },
    { label: "检索轮次", value: metrics.iterations, icon: GitBranch },
    { label: "端到端耗时", value: formatDuration(metrics.duration_ms), icon: Clock3 },
  ] : [];

  return (
    <Card padding="md" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-apple-blue" />
          <p className="text-sm font-semibold text-ink-primary">搜索策略与成本</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="info">
            {result.search_depth ? DEPTH_LABELS[result.search_depth] : "智能搜索"}
          </Badge>
          <Badge variant="default">Semantic Scholar</Badge>
          {metrics?.filtered_count ? (
            <Badge variant="default">过滤 {metrics.filtered_count} 条低质记录</Badge>
          ) : null}
        </div>
      </div>

      {intent ? (
        <div className="space-y-3 rounded-2xl bg-white/45 px-3 py-3">
          <div>
            <p className="text-xs font-semibold text-ink-secondary">解析后的研究意图</p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">{intent.summary || "已按结构化字段理解检索目标。"}</p>
          </div>
          <div className="space-y-2">
            {FACET_LABELS.map(({ key, label }) => intent[key]?.length ? (
              <div key={key} className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 shrink-0 text-[11px] font-medium text-ink-tertiary">{label}</span>
                {intent[key].map((value) => (
                  <Badge key={`${key}-${value}`} variant="default">{value}</Badge>
                ))}
              </div>
            ) : null)}
          </div>
        </div>
      ) : null}

      {metricItems.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {metricItems.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl bg-white/45 px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11px] text-ink-tertiary">
                <Icon className="h-3 w-3" />
                <span>{label}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-ink-primary">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {trace?.length ? (
        <ol className="space-y-2">
          {trace.map((step, index) => (
            <li key={`${step.stage}-${step.query ?? "none"}-${index}`} className="flex gap-3 rounded-2xl bg-white/35 px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-xs font-semibold text-apple-blue">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-ink-secondary">{step.label}</p>
                  <Badge variant={step.status === "completed" ? "success" : step.status === "partial" ? "warning" : "default"}>
                    {step.status === "completed" ? "完成" : step.status === "partial" ? "部分完成" : "已跳过"}
                  </Badge>
                  {typeof step.candidate_count === "number" ? (
                    <span className="text-[11px] text-ink-tertiary">{step.candidate_count} 篇</span>
                  ) : null}
                </div>
                {step.query ? <p className="mt-1 break-all font-mono text-[11px] text-ink-tertiary">{step.query}</p> : null}
                <p className="mt-1 text-[11px] leading-5 text-ink-tertiary">{step.note}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}
