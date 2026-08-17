import type { ResearchHypothesisCard } from "@research-copilot/types";
import type { ResearchIdeaSuggestion } from "../../lib/client";

export interface HypothesisPlanningDraft {
  topic: string;
  keywords: string[];
  goal: string;
  knownContext: string;
  preferredOutput: string;
  hypothesisCard: ResearchHypothesisCard;
}

function lines(title: string, values: string[], empty: string) {
  return `${title}：\n${values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`}`;
}

export function hypothesisCardFromIdea(
  idea: ResearchIdeaSuggestion,
  previous?: ResearchHypothesisCard,
  now = new Date(),
): ResearchHypothesisCard {
  const timestamp = now.toISOString();
  return {
    id: previous?.id ?? globalThis.crypto?.randomUUID?.() ?? `hypothesis-${now.getTime()}`,
    version: (previous?.version ?? 0) + 1,
    parent_version: previous?.version,
    decision: previous ? "revised" : "draft",
    title: idea.title,
    hypothesis: idea.hypothesis,
    rationale: idea.rationale,
    evidence: idea.evidence,
    counter_evidence: idea.counter_evidence,
    falsification: idea.falsification,
    validation_steps: idea.validation_steps,
    uncertainties: idea.uncertainties,
    keywords: idea.keywords,
    created_at: previous?.created_at ?? timestamp,
    updated_at: timestamp,
    origin: previous?.origin ?? {
      hypothesis: idea.hypothesis,
      falsification: idea.falsification,
      validation_steps: idea.validation_steps,
      captured_at: timestamp,
    },
  };
}

export function hypothesisCardToPlanningDraft(card: ResearchHypothesisCard): HypothesisPlanningDraft {
  const knownContext = [
    `候选假设（v${card.version}）：${card.hypothesis}`,
    card.rationale ? `提出理由：${card.rationale}` : "",
    lines("材料支持", card.evidence, "材料中没有明确支持线索"),
    lines("反证与冲突", card.counter_evidence, "材料中未提供反证，需主动检索"),
    lines("仍不确定", card.uncertainties, "暂无显式记录，仍需核对"),
  ].filter(Boolean).join("\n\n");

  return {
    topic: card.title,
    keywords: card.keywords,
    goal: `验证候选假设：${card.hypothesis}`,
    knownContext,
    preferredOutput: "可执行验证计划 + 对照方案 + 判定指标 + 停止条件",
    hypothesisCard: card,
  };
}

export function hypothesisDecisionLabel(decision: ResearchHypothesisCard["decision"]): string {
  if (decision === "adopted") return "已采用";
  if (decision === "revised") return "已修正";
  if (decision === "discarded") return "已放弃";
  return "草稿";
}
