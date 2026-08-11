import { ArrowRight, GitFork } from "lucide-react";
import { Badge, Card } from "@research-copilot/ui";
import type { ArxivRecommendation, PaperSearchRelation } from "@research-copilot/types";
import ExternalLink from "../../components/ExternalLink";
import { truncateText } from "./shared";

interface PaperSearchRelationGraphProps {
  papers: ArxivRecommendation[];
  relations?: PaperSearchRelation[];
}

export function PaperSearchRelationGraph({ papers, relations = [] }: PaperSearchRelationGraphProps) {
  if (relations.length === 0) return null;
  const paperMap = new Map(papers.map((paper) => [paper.arxiv_id, paper]));
  const visibleRelations = relations
    .map((relation) => ({
      relation,
      source: paperMap.get(relation.source_id) ?? {
        title: relation.source_id,
        abs_url: `https://www.semanticscholar.org/paper/${encodeURIComponent(relation.source_id)}`,
      },
      target: paperMap.get(relation.target_id) ?? {
        title: relation.target_id,
        abs_url: `https://www.semanticscholar.org/paper/${encodeURIComponent(relation.target_id)}`,
      },
    }))
    .slice(0, 12);
  if (visibleRelations.length === 0) return null;

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitFork className="h-4 w-4 text-apple-purple" />
          <p className="text-sm font-semibold text-ink-primary">论文关系图</p>
        </div>
        <Badge variant="default">{visibleRelations.length} 条引文关系</Badge>
      </div>
      <p className="text-xs leading-5 text-ink-tertiary">
        这些关系来自 Semantic Scholar 引文网络，用于说明论文为何在迭代搜索中被发现。
      </p>
      <div className="space-y-2">
        {visibleRelations.map(({ relation, source, target }, index) => {
          return (
            <div key={`${relation.source_id}-${relation.target_id}-${index}`} className="grid items-center gap-2 rounded-2xl bg-white/40 px-3 py-2.5 md:grid-cols-[1fr_auto_1fr]">
              <ExternalLink href={source.abs_url} className="min-w-0 text-xs font-medium leading-5 text-ink-secondary hover:text-apple-blue">
                {truncateText(source.title, 72)}
              </ExternalLink>
              <div className="flex items-center justify-center gap-1 text-[11px] text-ink-tertiary">
                <ArrowRight className="h-3.5 w-3.5" />
                <span>{relation.kind === "cites" ? "引用" : "被引用"}</span>
              </div>
              <ExternalLink href={target.abs_url} className="min-w-0 text-xs font-medium leading-5 text-ink-secondary hover:text-apple-blue">
                {truncateText(target.title, 72)}
              </ExternalLink>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
