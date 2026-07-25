import { CalendarDays, Search } from "lucide-react";
import { Badge, Card } from "@research-copilot/ui";
import type { ArxivRecommendation, ArxivSearchResponse, WebSearchOutcome } from "@research-copilot/types";
import ExternalLink from "../../components/ExternalLink";
import { formatDate, scoreVariant } from "./shared";
import { WebSupplementResults } from "./WebSupplementResults";

interface AppliedFilterEntry {
  label: string;
  values: string[];
}

interface PaperResultCardProps {
  paper: ArxivRecommendation;
  detailActionLabel: string;
  detailActionTitle: string;
  pdfActionLabel: string;
  pdfActionTitle: string;
}

function PaperResultCard({
  paper,
  detailActionLabel,
  detailActionTitle,
  pdfActionLabel,
  pdfActionTitle,
}: PaperResultCardProps) {
  const hasAbstract = paper.abstract_text && paper.abstract_text.trim().length > 0;
  const hasTldr = paper.tldr_zh && paper.tldr_zh.trim().length > 0;

  return (
    <Card padding="md" className="group space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={scoreVariant(paper.score)}>{`${paper.score} 分`}</Badge>
            {paper.category ? <Badge variant="default">{paper.category}</Badge> : null}
            {paper.published_at ? (
              <Badge variant="default">{formatDate(paper.published_at)}</Badge>
            ) : null}
          </div>
          <ExternalLink
            href={paper.abs_url}
            className="block text-base font-semibold leading-6 text-ink-primary hover:text-apple-blue hover:underline"
          >
            {paper.title}
          </ExternalLink>
          {paper.title_zh ? (
            <p className="text-sm font-medium leading-5 text-ink-secondary">{paper.title_zh}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <ExternalLink
            href={paper.abs_url}
            className="rc-accent-chip rc-accent-chip--interactive inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            title={detailActionTitle}
          >
            {detailActionLabel}
          </ExternalLink>
          <ExternalLink
            href={paper.pdf_url}
            className="rc-accent-chip rc-accent-chip--interactive inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            title={pdfActionTitle}
          >
            {pdfActionLabel}
          </ExternalLink>
        </div>
      </div>

      <p className="text-xs leading-5 text-ink-tertiary">{paper.authors || "作者信息缺失"}</p>

      {paper.reason ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-secondary">推荐理由</p>
          <p className="text-sm leading-6 text-ink-secondary">{paper.reason}</p>
        </div>
      ) : null}

      {hasAbstract ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-secondary">摘要</p>
          <p className="text-sm leading-6 text-ink-tertiary">{paper.abstract_text}</p>
        </div>
      ) : null}

      {hasTldr ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-secondary">一句话总结</p>
          <p className="text-sm leading-6 text-ink-secondary">{paper.tldr_zh}</p>
        </div>
      ) : null}

      {paper.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {paper.tags.map((tag) => (
            <Badge key={`${paper.arxiv_id}-${tag}`} variant="default">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

interface ArxivSearchResultsProps {
  result: ArxivSearchResponse | null;
  webSupplement?: WebSearchOutcome | null;
  webSupplementError?: string;
  appliedFilters: AppliedFilterEntry[];
  searched: boolean;
  loading: boolean;
  error: string;
  expressionLabel: string;
  emptyMatchHint: string;
  emptySearchHint: string;
  detailActionLabel: string;
  detailActionTitle: string;
  pdfActionLabel: string;
  pdfActionTitle: string;
}

export function ArxivSearchResults({
  result,
  webSupplement = null,
  webSupplementError = "",
  appliedFilters,
  searched,
  loading,
  error,
  expressionLabel,
  emptyMatchHint,
  emptySearchHint,
  detailActionLabel,
  detailActionTitle,
  pdfActionLabel,
  pdfActionTitle,
}: ArxivSearchResultsProps) {
  if (result) {
    return (
      <div className="space-y-4">
        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{result.ranking_mode === "quality" ? "质量预测" : "最相关"}</Badge>
            <Badge variant={result.candidate_count === 0 ? "default" : result.llm_used ? "success" : "warning"}>
              {result.candidate_count === 0
                ? "无候选，未进入模型重排"
                : result.llm_used
                  ? "小妍模型已重排"
                  : "已使用启发式排序"}
            </Badge>
            {result.search_queries && result.search_queries.length > 0 ? (
              <Badge variant={result.query_plan_llm_used ? "success" : "info"}>
                {`${result.query_plan_llm_used ? "小妍" : "本地规则"}拆分 ${result.search_queries.length} 条查询`}
              </Badge>
            ) : null}
            <Badge variant="default">{`候选 ${result.candidate_count} 篇`}</Badge>
            <Badge variant="default">{`返回 ${result.papers.length} 篇`}</Badge>
          </div>

          <div className="space-y-2">
            {result.query_plan_note ? (
              <p className="text-xs leading-5 text-ink-tertiary">{result.query_plan_note}</p>
            ) : null}
            <p className="text-sm font-semibold text-ink-primary">{result.overall_summary}</p>
            <p className="text-sm leading-6 text-ink-secondary">{result.ranking_note}</p>
            <p className="text-xs leading-5 text-ink-tertiary">{result.disclaimer}</p>
          </div>

          {appliedFilters.length > 0 || (result.search_queries?.length ?? 0) > 0 ? (
            <div className="space-y-2 rounded-2xl bg-white/40 px-3 py-3">
              <p className="text-xs font-semibold text-ink-secondary">本次检索条件</p>
              {appliedFilters.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {appliedFilters.flatMap((entry) =>
                    entry.values.map((value) => (
                      <Badge key={`${entry.label}-${value}`} variant="default">
                        {`${entry.label}：${value}`}
                      </Badge>
                    ))
                  )}
                </div>
              ) : null}
              <p className="text-[11px] leading-5 text-ink-tertiary">{expressionLabel}</p>
              {result.search_queries && result.search_queries.length > 0 ? (
                <ol className="space-y-1 rounded-2xl bg-white/55 px-3 py-2 font-mono text-[11px] leading-5 text-ink-tertiary">
                  {result.search_queries.map((query, index) => (
                    <li key={`${query}-${index}`} className="break-all">
                      {`${index + 1}. ${query}`}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="break-all rounded-2xl bg-white/55 px-3 py-2 font-mono text-[11px] leading-5 text-ink-tertiary">
                  {result.search_expression}
                </p>
              )}
            </div>
          ) : null}
        </Card>

        {result.papers.length > 0 ? (
          <div className="space-y-3">
            {result.papers.map((paper, index) => (
              <PaperResultCard
                key={`${paper.arxiv_id}-${index}`}
                paper={paper}
                detailActionLabel={detailActionLabel}
                detailActionTitle={detailActionTitle}
                pdfActionLabel={pdfActionLabel}
                pdfActionTitle={pdfActionTitle}
              />
            ))}
          </div>
        ) : (
          <Card className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarDays className="h-8 w-8 text-ink-tertiary" />
            <div>
              <p className="font-medium text-ink-secondary">当前条件下没有匹配论文</p>
              <p className="mt-1 text-sm text-ink-tertiary">{emptyMatchHint}</p>
            </div>
          </Card>
        )}

        <WebSupplementResults
          outcome={webSupplement}
          error={webSupplementError}
          cutoffDate={result.cutoff_date}
        />
      </div>
    );
  }

  if (searched && !loading && !error) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <Search className="h-8 w-8 text-ink-tertiary" />
        <div>
          <p className="font-medium text-ink-secondary">暂无结果</p>
          <p className="mt-1 text-sm text-ink-tertiary">{emptySearchHint}</p>
        </div>
      </Card>
    );
  }

  return null;
}
