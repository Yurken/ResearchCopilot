import { Bot, GitBranch } from "lucide-react";
import { Badge, Card } from "@research-copilot/ui";
import { replaceAgentWording, toCapabilityModelName } from "@research-copilot/types";
import { CITATION_FORMATS, type StructuredSurveyResult, type SurveyAgentState } from "./shared";

interface SurveyRunSummaryPanelProps {
  agents: SurveyAgentState[];
  structured: StructuredSurveyResult | null;
  fallbackCitationFormatLabel: string;
  /** 整体是否已失败；未失败时的阶段失败表示已降级继续。 */
  runFailed?: boolean;
}

export default function SurveyRunSummaryPanel({
  agents,
  structured,
  fallbackCitationFormatLabel,
  runFailed = false,
}: SurveyRunSummaryPanelProps) {
  return (
    <div className="space-y-4">
      <Card padding="sm" className="space-y-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-apple-blue" />
          <p className="text-sm font-semibold text-ink-primary">小妍步骤协作流程</p>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm leading-6 text-ink-tertiary">等待小妍步骤开始执行任务。</p>
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-2xl p-3"
                style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 flex-shrink-0 text-ink-tertiary" />
                      <p className="truncate text-sm font-medium text-ink-primary">{toCapabilityModelName(agent.name)}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-tertiary">{replaceAgentWording(agent.role)}</p>
                  </div>
                  <Badge variant={agent.status === "done" ? "success" : agent.status === "failed" ? "danger" : "info"}>
                    {agent.status === "done" ? "已完成" : agent.status === "failed" ? "失败" : "处理中"}
                  </Badge>
                </div>
                {agent.summary || agent.error ? (
                  <p className={`mt-2 text-xs leading-5 ${agent.error ? "text-apple-red" : "text-ink-secondary"}`}>
                    {agent.error || agent.summary}
                  </p>
                ) : null}
                {agent.status === "failed" && !runFailed ? (
                  <p className="mt-1 text-[11px] text-ink-tertiary">该阶段未成功，已按降级策略继续，不影响整体生成。</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {structured?.meta ? (
        <Card padding="sm" className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-secondary">检索配置</p>
          {structured.meta.time_range && structured.meta.time_range !== "不限" ? (
            <p className="text-xs text-ink-tertiary">时间范围：{structured.meta.time_range}</p>
          ) : null}
          {structured.meta.lit_types && structured.meta.lit_types !== "不限" ? (
            <p className="text-xs text-ink-tertiary">文献类型：{structured.meta.lit_types}</p>
          ) : null}
          {structured.meta.databases && structured.meta.databases !== "不限" ? (
            <p className="text-xs text-ink-tertiary">数据库：{structured.meta.databases}</p>
          ) : null}
          <p className="text-xs text-ink-tertiary">
            引用格式：
            {CITATION_FORMATS.find((format) => format.value === structured.citation_format)?.label ?? fallbackCitationFormatLabel}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
