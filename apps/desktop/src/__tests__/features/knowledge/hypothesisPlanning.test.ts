import { describe, expect, it } from "vitest";
import { hypothesisCardFromIdea, hypothesisCardToPlanningDraft } from "../../../features/knowledge/hypothesisPlanning";

const idea = {
  title: "证据路径约束",
  hypothesis: "加入路径约束后无来源断言下降",
  rationale: "材料指出回答难追溯",
  evidence: ["手记：回答难追溯"],
  counter_evidence: ["尚无反证"],
  falsification: "无来源断言未下降",
  validation_steps: ["冻结问题集", "做对照", "统计指标"],
  uncertainties: ["样本量未知"],
  keywords: ["Graph RAG"],
};

describe("hypothesis planning handoff", () => {
  it("整张假设卡进入规划草稿，不丢失证据和证伪边界", () => {
    const card = hypothesisCardFromIdea(idea, undefined, new Date("2026-08-13T00:00:00Z"));
    const draft = hypothesisCardToPlanningDraft(card);
    expect(draft.goal).toContain(idea.hypothesis);
    expect(draft.knownContext).toContain(idea.evidence[0]);
    expect(draft.knownContext).toContain(idea.counter_evidence[0]);
    expect(draft.hypothesisCard.falsification).toBe(idea.falsification);
    expect(draft.hypothesisCard.validation_steps).toEqual(idea.validation_steps);
  });

  it("基于上一版本生成可追溯的修正版", () => {
    const first = hypothesisCardFromIdea(idea, undefined, new Date("2026-08-13T00:00:00Z"));
    const second = hypothesisCardFromIdea({ ...idea, hypothesis: "修正版假设" }, first, new Date("2026-08-13T01:00:00Z"));
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.parent_version).toBe(1);
    expect(second.decision).toBe("revised");
  });
});
