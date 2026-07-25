import { describe, expect, it } from "vitest";
import type { Paper } from "@research-copilot/types";
import {
  buildPaperExperimentDraft,
  buildReaderResearchPrompt,
  derivePaperResearchStatus,
} from "../../../features/reader/research-actions/shared";

const paper: Paper = {
  id: "paper-1",
  title: "Evidence-aware Research",
  status: "analyzed",
  created_at: "2026-07-22T00:00:00Z",
  updated_at: "2026-07-22T00:00:00Z",
  analysis: {
    id: "analysis-1",
    research_question: "How should evidence be linked?",
    core_method: "Anchor every conclusion.",
    limitations: "Coordinates are incomplete.",
    created_at: "2026-07-22T00:00:00Z",
  },
  reproduction_guide: {
    id: "guide-1",
    code_repository: "https://example.com/repo",
    evaluation_metrics: "MRR",
    created_at: "2026-07-22T00:00:00Z",
  },
};

describe("reader research actions", () => {
  it("在选区提示词中保留论文、页码与原文", () => {
    const prompt = buildReaderResearchPrompt("summarize-selection", paper, 4, "Original evidence", "Nearby page text");
    expect(prompt).toContain("Evidence-aware Research");
    expect(prompt).toContain("第 4 页");
    expect(prompt).toContain("Original evidence");
    expect(prompt).toContain("Nearby page text");
  });

  it("从已有论文分析和复现结果生成实验草稿", () => {
    const draft = buildPaperExperimentDraft(paper);
    expect(draft.title).toBe("复现：Evidence-aware Research");
    expect(draft.config).toMatchObject({ paper_id: "paper-1", evaluation_metrics: "MRR" });
    expect(draft.notes).toContain("How should evidence be linked?");
    expect(draft.notes).toContain("Anchor every conclusion.");
  });

  it("优先把复现产物识别为下一研究阶段", () => {
    expect(derivePaperResearchStatus(paper)).toMatchObject({
      phase: "已形成复现方案",
      nextAction: "创建实验并验证论文结果",
      assets: ["论文解读", "复现指南"],
    });
  });
});
