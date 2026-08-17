import { Check, GitBranch, RotateCcw, X } from "lucide-react";
import { Button, Textarea } from "@research-copilot/ui";
import type { ResearchHypothesisCard } from "@research-copilot/types";
import { hypothesisDecisionLabel } from "./hypothesisPlanning";

interface HypothesisPlanningCardProps {
  card: ResearchHypothesisCard;
  onChange: (card: ResearchHypothesisCard) => void;
}

function changeDecision(
  card: ResearchHypothesisCard,
  decision: ResearchHypothesisCard["decision"],
): ResearchHypothesisCard {
  return advanceVersion({ ...card, decision });
}

function advanceVersion(card: ResearchHypothesisCard): ResearchHypothesisCard {
  const startsRevision = card.version === 1 && card.origin;
  return {
    ...card,
    version: startsRevision ? 2 : card.version,
    parent_version: startsRevision ? 1 : card.parent_version,
    updated_at: new Date().toISOString(),
  };
}

export default function HypothesisPlanningCard({ card, onChange }: HypothesisPlanningCardProps) {
  const origin = card.origin;
  const versionChanges = origin ? [
    origin.hypothesis !== card.hypothesis ? `假设：${origin.hypothesis} → ${card.hypothesis}` : null,
    origin.falsification !== card.falsification ? `证伪条件：${origin.falsification} → ${card.falsification}` : null,
    JSON.stringify(origin.validation_steps) !== JSON.stringify(card.validation_steps)
      ? `验证任务：${origin.validation_steps.join("；")} → ${card.validation_steps.join("；")}`
      : null,
  ].filter((item): item is string => Boolean(item)) : [];

  return (
    <section className="rounded-3xl border border-apple-blue/20 bg-apple-blue/5 p-4" data-testid="hypothesis-planning-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <GitBranch className="h-4 w-4 text-apple-blue" />
            候选假设 v{card.version} · {hypothesisDecisionLabel(card.decision)}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">{card.hypothesis}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => onChange(changeDecision(card, "adopted"))}>
            <Check className="h-3.5 w-3.5" />采用
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange(changeDecision(card, "revised"))}>
            <RotateCcw className="h-3.5 w-3.5" />标记已修正
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange(changeDecision(card, "discarded"))}>
            <X className="h-3.5 w-3.5" />放弃
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <label htmlFor="hypothesis-text" className="text-xs font-medium text-ink-secondary">候选假设</label>
          <Textarea id="hypothesis-text" rows={3} value={card.hypothesis} onChange={(event) => onChange(advanceVersion({ ...card, hypothesis: event.target.value, decision: "revised" }))} />
        </div>
        <div>
          <label htmlFor="hypothesis-falsification" className="text-xs font-medium text-ink-secondary">证伪条件</label>
          <Textarea id="hypothesis-falsification" rows={3} value={card.falsification} onChange={(event) => onChange(advanceVersion({ ...card, falsification: event.target.value, decision: "revised" }))} />
        </div>
      </div>
      <label className="mt-3 block text-xs font-medium text-ink-secondary" htmlFor="hypothesis-validation-steps">验证任务（每行一项）</label>
      <Textarea id="hypothesis-validation-steps" rows={3} value={card.validation_steps.join("\n")} onChange={(event) => onChange(advanceVersion({ ...card, validation_steps: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean), decision: "revised" }))} />
      {origin && card.version > 1 ? (
        <div className="mt-3 rounded-2xl border border-apple-blue/15 bg-white/50 p-3 text-xs text-ink-secondary">
          <p className="font-medium text-ink-primary">版本对比：v1 原始版 → v{card.version} 当前版</p>
          {versionChanges.length > 0 ? (
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {versionChanges.map((change) => <li key={change}>{change}</li>)}
            </ul>
          ) : (
            <p className="mt-1.5">核心假设、证伪条件和验证任务与原始版一致。</p>
          )}
        </div>
      ) : null}
      <label className="mt-3 block text-xs font-medium text-ink-secondary" htmlFor="hypothesis-decision-note">
        采用、修正或放弃的理由
      </label>
      <Textarea
        id="hypothesis-decision-note"
        rows={2}
        value={card.decision_note ?? ""}
        onChange={(event) => onChange({ ...card, decision_note: event.target.value, updated_at: new Date().toISOString() })}
        placeholder="例如：数据暂不可得；先缩小对象范围；证据足够，进入验证…"
      />
      {card.decision === "discarded" ? (
        <p className="mt-2 text-xs text-apple-red">该假设会作为放弃版本保存，但不会进入规划生成。</p>
      ) : null}
    </section>
  );
}
