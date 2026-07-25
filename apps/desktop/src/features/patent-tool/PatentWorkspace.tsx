import {
  AlertCircle,
  BrainCircuit,
  ExternalLink as ExternalLinkIcon,
  FileSearch,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardSection,
  Input,
  MarkdownRenderer,
  Select,
  Textarea,
} from "@research-copilot/ui";
import ExternalLink from "../../components/ExternalLink";
import { PatentPrivacyControls } from "./PatentPrivacyControls";
import { usePatentSearch } from "./usePatentSearch";
import type { PatentRiskLevel } from "./shared";

const RISK_META: Record<PatentRiskLevel, {
  label: string;
  variant: "success" | "warning" | "danger" | "default";
}> = {
  low: { label: "低", variant: "success" },
  medium: { label: "中", variant: "warning" },
  high: { label: "高", variant: "danger" },
  unknown: { label: "待复核", variant: "default" },
};

function RiskSummary({ label, level }: { label: string; level: PatentRiskLevel }) {
  const meta = RISK_META[level];
  return (
    <Card variant="inset" padding="sm" className="min-w-0 space-y-2">
      <p className="text-[11px] font-medium text-ink-tertiary">{label}</p>
      <Badge variant={meta.variant}>{meta.label}</Badge>
    </Card>
  );
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm text-apple-red"
      style={{
        background: "color-mix(in srgb, var(--rc-card-inset-bg) 88%, var(--rc-danger, #FF3B30) 12%)",
        borderColor: "color-mix(in srgb, var(--rc-danger, #FF3B30) 24%, var(--rc-border))",
        boxShadow: "var(--rc-card-inset-shadow)",
      }}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function PatentWorkspace() {
  const patent = usePatentSearch();

  return (
    <div className="space-y-5">
      <Card padding="lg" className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
            <FileSearch className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-primary">中国专利线索检索与初步风险提示</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-tertiary">
              描述技术方案，先定位可能的现有技术，再围绕新颖性、创造性与公开风险做初筛。
            </p>
          </div>
        </div>

        <Textarea
          label="技术方案 *"
          value={patent.description}
          onChange={(event) => patent.setDescription(event.target.value)}
          rows={6}
          placeholder="例如：一种面向工业缺陷检测的方法，通过……解决……，关键步骤包括……"
          className="min-h-[148px] resize-y leading-6"
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Input
            label="关键技术特征（建议填写）"
            value={patent.keywords}
            onChange={(event) => patent.setKeywords(event.target.value)}
            placeholder="用逗号分隔，例如：多尺度特征融合，在线蒸馏"
          />
          <Select
            label="披露状态"
            value={patent.disclosureStatus}
            onChange={(value) => patent.setDisclosureStatus(value as typeof patent.disclosureStatus)}
            options={[
              { value: "private", label: "尚未对外公开" },
              { value: "submitted", label: "已投稿 / 答辩材料流转中" },
              { value: "public", label: "已发表 / 开源 / 公开展示" },
            ]}
          />
        </div>

        <Card variant="inset" padding="sm" className="space-y-1.5">
          <p className="break-words text-xs leading-5 text-ink-tertiary">
            <span className="font-semibold text-ink-secondary">检索式预览：</span>
            {patent.plan.booleanQuery || "填写技术方案后生成"}
          </p>
          <p className="text-xs leading-5 text-ink-tertiary">
            公开网络结果用于快速发现线索，正式申请前仍应在官方数据库复核。
          </p>
        </Card>

        <PatentPrivacyControls
          plan={patent.plan}
          searchConsent={patent.searchConsent}
          aiConsent={patent.aiConsent}
          onSearchConsentChange={patent.setSearchConsent}
          onAiConsentChange={patent.setAiConsent}
        />

        <ErrorNotice message={patent.error} />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void patent.search()}
            loading={patent.loading}
            disabled={!patent.description.trim() || !patent.searchConsent}
          >
            <Search className="h-4 w-4" />
            检索公开网络线索
          </Button>
          <span className="text-xs text-ink-tertiary">优先检索中国公开专利，并按技术特征重叠度排序</span>
        </div>
      </Card>

      {patent.searched && !patent.loading ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <Card padding="md" className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">相关公开结果</h3>
                <p className="mt-1 text-xs leading-5 text-ink-tertiary">打开全文核对独立权利要求，而不只看标题和摘要。</p>
              </div>
              <div className="flex gap-2">
                <Badge variant="info">{patent.provider || "公开网络"}</Badge>
                <Badge>{patent.results.length} 条</Badge>
              </div>
            </div>

            <CardSection>
              {patent.results.length > 0 ? (
                <div>
                  {patent.results.map((result, index) => (
                    <article
                      key={`${result.url}-${index}`}
                      className="py-4 first:pt-0 last:pb-0"
                      style={index > 0 ? { borderTop: "1px solid var(--rc-border)" } : undefined}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <ExternalLink
                            href={result.url}
                            className="text-sm font-semibold leading-6 text-ink-primary hover:text-apple-blue hover:underline"
                          >
                            {result.title || result.url}
                          </ExternalLink>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {result.publicationNumber ? <Badge>{result.publicationNumber}</Badge> : null}
                            <Badge variant={result.sourceVerified ? "info" : "default"}>
                              {result.sourceVerified ? "来源可核验" : "网页线索"}
                            </Badge>
                            <ExternalLink href={result.url} className="inline-flex items-center gap-1 text-xs font-medium text-apple-blue">
                              查看来源 <ExternalLinkIcon className="h-3 w-3" />
                            </ExternalLink>
                          </div>
                        </div>
                        <div className="w-24 flex-shrink-0 text-right">
                          <span className="text-[11px] font-medium tabular-nums text-ink-tertiary">
                            匹配 {Math.round(result.relevanceScore * 100)}%
                          </span>
                          <div
                            className="mt-2 h-1.5 overflow-hidden rounded-full"
                            style={{ background: "var(--rc-card-inset-bg)", boxShadow: "var(--rc-card-inset-shadow)" }}
                            aria-label={`特征匹配度 ${Math.round(result.relevanceScore * 100)}%`}
                          >
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${Math.max(4, result.relevanceScore * 100)}%`, background: "var(--rc-accent)" }}
                            />
                          </div>
                        </div>
                      </div>
                      {result.snippet ? <p className="mt-3 text-xs leading-5 text-ink-tertiary">{result.snippet}</p> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <Card variant="inset" padding="lg" className="text-center">
                  <Search className="mx-auto h-6 w-6 text-ink-tertiary" />
                  <p className="mt-2 text-sm font-medium text-ink-secondary">未找到公开结果</p>
                  <p className="mt-1 text-xs text-ink-tertiary">补充同义词、英文名称或上位概念后重试。</p>
                </Card>
              )}
            </CardSection>
          </Card>

          <Card padding="md" className="self-start">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-apple-orange" />
              <h3 className="text-sm font-semibold text-ink-primary">初步风险报告</h3>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <RiskSummary label="新颖性" level={patent.report.noveltyRisk} />
              <RiskSummary label="创造性" level={patent.report.inventivenessRisk} />
              <RiskSummary label="披露" level={patent.report.disclosureRisk} />
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-secondary">{patent.report.summary}</p>
            <p className="mt-2 text-xs leading-5 text-ink-tertiary">{patent.report.evidenceSummary}</p>

            <CardSection>
              <p className="text-xs font-semibold text-ink-secondary">可重点论证</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-tertiary">
                {patent.report.arguablePoints.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </CardSection>
            <CardSection>
              <p className="text-xs font-semibold text-ink-secondary">下一步</p>
              <ol className="mt-2 space-y-1.5 text-xs leading-5 text-ink-tertiary">
                {patent.report.nextSteps.map((item, index) => <li key={item}>{index + 1}. {item}</li>)}
              </ol>
            </CardSection>

            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={() => void patent.generateAiReport()}
              loading={patent.aiLoading}
              disabled={patent.results.length === 0 || !patent.aiConsent}
            >
              <BrainCircuit className="h-4 w-4" />
              AI 深度评估
            </Button>
            <ErrorNotice message={patent.aiError} />
          </Card>
        </div>
      ) : null}

      {patent.aiReport ? (
        <Card padding="lg">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-apple-purple" />
            <h3 className="text-sm font-semibold text-ink-primary">AI 专利性初步评估</h3>
          </div>
          <CardSection>
            <MarkdownRenderer content={patent.aiReport} />
          </CardSection>
        </Card>
      ) : null}

      <Card variant="inset" padding="sm" className="flex items-start gap-2 text-xs leading-5 text-ink-tertiary">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>专利检索与评估仅用于研究和沟通准备，不构成法律意见或授权保证；正式申请前请由专利代理师复核。</span>
      </Card>
    </div>
  );
}
