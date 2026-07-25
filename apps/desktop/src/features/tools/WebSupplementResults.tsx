import { AlertCircle, Globe } from "lucide-react";
import { Badge, Card } from "@research-copilot/ui";
import type { WebSearchOutcome } from "@research-copilot/types";
import ExternalLink from "../../components/ExternalLink";
import { truncateText } from "./shared";

interface WebSupplementResultsProps {
  outcome: WebSearchOutcome | null;
  error: string;
  cutoffDate?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  tavily: "Tavily",
  duckduckgo: "DuckDuckGo",
};

export function WebSupplementResults({ outcome, error, cutoffDate }: WebSupplementResultsProps) {
  if (!outcome && !error) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Globe className="h-4 w-4 text-apple-blue" />
        <h3 className="text-sm font-semibold text-ink-primary">网络补充</h3>
        {outcome ? (
          <>
            <Badge variant="info">{PROVIDER_LABEL[outcome.provider] ?? outcome.provider}</Badge>
            <Badge variant="default">{`${outcome.items.length} 条结果`}</Badge>
            {cutoffDate ? <Badge variant="default">{`截止 ${cutoffDate}`}</Badge> : null}
          </>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-apple-red/10 bg-[#F7ECEA] px-3 py-2 text-sm text-apple-red">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {outcome?.note ? <p className="px-1 text-xs leading-5 text-ink-tertiary">{outcome.note}</p> : null}
      {outcome?.answer ? (
        <p className="rounded-2xl bg-white/55 px-3 py-2 text-sm leading-6 text-ink-secondary">
          {outcome.answer}
        </p>
      ) : null}

      {outcome?.items.map((item, index) => (
        <Card key={`${item.url || item.title}-${index}`} padding="md" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">网络来源</Badge>
            {item.url ? (
              <ExternalLink
                href={item.url}
                className="text-base font-semibold leading-7 text-ink-primary hover:text-apple-blue hover:underline"
              >
                {item.title || item.url}
              </ExternalLink>
            ) : (
              <p className="text-base font-semibold leading-7 text-ink-primary">{item.title}</p>
            )}
          </div>
          {item.snippet ? (
            <p className="text-sm leading-6 text-ink-tertiary">{truncateText(item.snippet)}</p>
          ) : null}
        </Card>
      ))}

      {outcome && outcome.items.length === 0 ? (
        <p className="text-sm text-ink-tertiary">未找到额外网络来源。</p>
      ) : null}
    </section>
  );
}
