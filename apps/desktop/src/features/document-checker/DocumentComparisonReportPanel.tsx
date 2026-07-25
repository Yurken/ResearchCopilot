import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileText,
  HelpCircle,
  Info,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Badge, Card, CardSection, Select } from "@research-copilot/ui";
import type {
  DocumentCheckCategory,
  DocumentCheckSeverity,
  DocumentComparisonItem,
  DocumentComparisonReport,
  DocumentInspection,
} from "./shared";

const CATEGORY_LABELS: Record<DocumentCheckCategory, string> = {
  page: "页面",
  font: "字体字号",
  heading: "标题层级",
  figure: "图表编号",
  citation: "参考文献",
  hidden: "隐藏内容",
};

const SEVERITY_META: Record<DocumentCheckSeverity, {
  label: string;
  variant: "danger" | "warning" | "info";
  icon: typeof AlertCircle;
  color: string;
}> = {
  error: { label: "严重", variant: "danger", icon: AlertCircle, color: "var(--rc-danger, #D92B21)" },
  warning: { label: "警告", variant: "warning", icon: TriangleAlert, color: "var(--rc-warning, #C07000)" },
  info: { label: "提示", variant: "info", icon: Info, color: "var(--rc-accent)" },
};

const COMPARISON_STATUS = {
  match: { label: "一致", variant: "success" as const, icon: CheckCircle2, color: "var(--rc-apple-green, #1A9E3F)" },
  mismatch: { label: "有差异", variant: "warning" as const, icon: XCircle, color: "var(--rc-warning, #C07000)" },
  unavailable: { label: "待确认", variant: "default" as const, icon: HelpCircle, color: "var(--rc-text-muted)" },
  not_applicable: { label: "不适用", variant: "default" as const, icon: Info, color: "var(--rc-text-muted)" },
};

function formatDimensions(inspection: DocumentInspection) {
  if (inspection.pageWidthMm === null || inspection.pageHeightMm === null) return "未识别";
  return `${inspection.pageWidthMm.toFixed(1)} × ${inspection.pageHeightMm.toFixed(1)} mm`;
}

function DocumentOverview({
  title,
  inspection,
  icon: Icon,
}: {
  title: string;
  inspection: DocumentInspection;
  icon: typeof FileText;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-ink-secondary" />
        <p className="text-xs font-semibold text-ink-secondary">{title}</p>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink-primary" title={inspection.fileName}>{inspection.fileName}</p>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-ink-tertiary">类型 / 页数</dt><dd className="font-medium uppercase text-ink-secondary">{inspection.fileType} · {inspection.pageCount ?? "未识别"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-tertiary">页面尺寸</dt><dd className="text-right font-medium tabular-nums text-ink-secondary">{formatDimensions(inspection)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-tertiary">字体</dt><dd className="max-w-[180px] truncate text-right font-medium text-ink-secondary" title={inspection.fonts.join("、")}>{inspection.fonts.slice(0, 3).join("、") || "未识别"}</dd></div>
      </dl>
    </div>
  );
}

function ComparisonRow({ item, divided }: { item: DocumentComparisonItem; divided: boolean }) {
  const meta = COMPARISON_STATUS[item.status];
  const Icon = meta.icon;
  return (
    <article className="py-4 first:pt-0 last:pb-0" style={divided ? { borderTop: "1px solid var(--rc-border)" } : undefined}>
      <div className="flex items-start gap-3">
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: "var(--rc-card-inset-bg)", color: meta.color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-primary">{item.label}</p>
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <span className="text-[11px] text-ink-tertiary">{item.basis}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-xl px-3 py-2" style={{ background: "var(--rc-card-inset-bg)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">规范</p>
              <p className="mt-1 break-words text-xs leading-5 text-ink-secondary">{item.expected}</p>
            </div>
            <div className="min-w-0 rounded-xl px-3 py-2" style={{ background: "var(--rc-card-inset-bg)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">成稿</p>
              <p className="mt-1 break-words text-xs leading-5 text-ink-secondary">{item.actual}</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function DocumentComparisonReportPanel({ report }: { report: DocumentComparisonReport }) {
  const [severityFilter, setSeverityFilter] = useState<"all" | DocumentCheckSeverity>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | DocumentCheckCategory>("all");
  const filteredIssues = useMemo(
    () => report.issues.filter((issue) => (
      (severityFilter === "all" || issue.severity === severityFilter)
      && (categoryFilter === "all" || issue.category === categoryFilter)
    )),
    [categoryFilter, report.issues, severityFilter],
  );
  const matchedCount = report.comparisons.filter((item) => item.status === "match").length;
  const mismatchCount = report.comparisons.filter((item) => item.status === "mismatch").length;
  const unavailableCount = report.comparisons.filter((item) => item.status === "unavailable").length;

  return (
    <div className="space-y-5">
      <Card padding="md" className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-primary">规范比对结果</h3>
            <p className="mt-1 text-xs leading-5 text-ink-tertiary">按所选文件角色决定规则来源；未明确或无法可靠解析的项目会标为待确认。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{matchedCount} 项一致</Badge>
            <Badge variant={mismatchCount > 0 ? "warning" : "default"}>{mismatchCount} 项差异</Badge>
            {unavailableCount > 0 ? <Badge>{unavailableCount} 项待确认</Badge> : null}
          </div>
        </div>
        <CardSection>
          {report.comparisons.map((item, index) => <ComparisonRow key={item.id} item={item} divided={index > 0} />)}
        </CardSection>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card padding="md">
            <h3 className="text-sm font-semibold text-ink-primary">文档概览</h3>
            <CardSection>
              <DocumentOverview title="规范文档" inspection={report.reference} icon={FileText} />
              <div style={{ borderTop: "1px solid var(--rc-border)" }}>
                <DocumentOverview title="待校验文档" inspection={report.candidate} icon={FileCheck2} />
              </div>
            </CardSection>
          </Card>

          <Card padding="md">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-apple-green" />
              <h3 className="text-sm font-semibold text-ink-primary">通过项</h3>
              <Badge variant="success">{report.passed.length}</Badge>
            </div>
            <CardSection>
              {report.passed.length > 0 ? (
                <ul className="space-y-2 text-xs leading-5 text-ink-tertiary">
                  {report.passed.map((item) => <li key={item}>✓ {item}</li>)}
                </ul>
              ) : <p className="text-xs text-ink-tertiary">暂无明确通过项。</p>}
            </CardSection>
          </Card>

          {report.notices.length > 0 ? (
            <Card padding="md">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-ink-tertiary" />
                <h3 className="text-sm font-semibold text-ink-primary">待确认与不适用</h3>
                <Badge>{report.notices.length}</Badge>
              </div>
              <CardSection>
                <ul className="space-y-3 text-xs leading-5 text-ink-tertiary">
                  {report.notices.map((notice) => (
                    <li key={notice.id}>
                      <span className="font-medium text-ink-secondary">{notice.status === "unavailable" ? "待确认" : "不适用"}：</span>
                      {notice.message}
                      <p className="mt-0.5 text-[11px]">{notice.suggestion}</p>
                    </li>
                  ))}
                </ul>
              </CardSection>
            </Card>
          ) : null}
        </div>

        <Card padding="md" className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-primary">成稿问题清单</h3>
              <p className="mt-1 text-xs text-ink-tertiary">包含规范差异以及成稿自身的页码、图表、引用和修订问题。</p>
            </div>
            <div className="grid min-w-[280px] grid-cols-2 gap-2 max-sm:min-w-0 max-sm:w-full">
              <Select
                aria-label="筛选严重程度"
                value={severityFilter}
                onChange={(value) => setSeverityFilter(value as typeof severityFilter)}
                options={[
                  { value: "all", label: "全部严重程度" },
                  { value: "error", label: "严重" },
                  { value: "warning", label: "警告" },
                  { value: "info", label: "提示" },
                ]}
              />
              <Select
                aria-label="筛选问题类别"
                value={categoryFilter}
                onChange={(value) => setCategoryFilter(value as typeof categoryFilter)}
                options={[
                  { value: "all", label: "全部类别" },
                  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
                ]}
              />
            </div>
          </div>

          <CardSection>
            {filteredIssues.length > 0 ? (
              <div>
                {filteredIssues.map((issue, index) => {
                  const meta = SEVERITY_META[issue.severity];
                  const Icon = meta.icon;
                  return (
                    <article key={issue.id} className="py-4 first:pt-0 last:pb-0" style={index > 0 ? { borderTop: "1px solid var(--rc-border)" } : undefined}>
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--rc-card-inset-bg)", color: meta.color }}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                            <Badge>{CATEGORY_LABELS[issue.category]}</Badge>
                            {issue.location ? <span className="text-[11px] text-ink-tertiary">{issue.location}</span> : null}
                          </div>
                          <p className="mt-2 text-sm font-medium leading-6 text-ink-primary">{issue.message}</p>
                          {issue.expected || issue.actual ? (
                            <p className="mt-1 text-xs leading-5 text-ink-secondary">规范：{issue.expected ?? "—"} · 成稿：{issue.actual ?? "—"}</p>
                          ) : null}
                          <p className="mt-1 text-xs leading-5 text-ink-tertiary">建议：{issue.suggestion}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Card variant="inset" padding="lg" className="text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-apple-green" />
                <p className="mt-2 text-sm font-medium text-ink-secondary">当前筛选下没有问题</p>
              </Card>
            )}
          </CardSection>
        </Card>
      </div>
    </div>
  );
}
