import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IdeaFromMaterialsPanel from "../../../features/knowledge/IdeaFromMaterialsPanel";

const generate = vi.fn();
const setFeedback = vi.fn();
const onSelect = vi.fn();

vi.mock("../../../features/knowledge/useIdeaFromMaterials", () => ({
  useIdeaFromMaterials: () => ({
    notes: "Graph RAG 回答缺少证据路径",
    setNotes: vi.fn(),
    items: [],
    ideas: [{
      title: "用图路径约束减少无来源断言",
      hypothesis: "加入证据路径约束后，无来源断言比例会下降",
      rationale: "材料明确提到回答难以追溯",
      evidence: ["手记：Graph RAG 回答缺少证据路径"],
      counter_evidence: ["材料中未提供反证，需主动检索"],
      falsification: "加入约束后无来源断言比例没有下降",
      validation_steps: ["冻结问题集", "比较约束前后", "统计无来源断言比例"],
      uncertainties: ["问题集规模尚未确定"],
      keywords: ["Graph RAG", "evidence grounding"],
    }],
    feedback: "",
    setFeedback,
    reading: false,
    loading: false,
    error: "",
    addFiles: vi.fn(),
    removeItem: vi.fn(),
    generate,
  }),
}));

describe("IdeaFromMaterialsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("展示候选假设的证据、反证、证伪条件和验证步骤", () => {
    render(<IdeaFromMaterialsPanel onSelect={onSelect} onClose={vi.fn()} />);

    expect(screen.getByText(/加入证据路径约束后/)).toBeInTheDocument();
    expect(screen.getByText("材料支持线索")).toBeInTheDocument();
    expect(screen.getByText("反证与冲突")).toBeInTheDocument();
    expect(screen.getByText(/加入约束后无来源断言比例没有下降/)).toBeInTheDocument();
    expect(screen.getByText("验证步骤")).toBeInTheDocument();
    expect(screen.getByText(/问题集规模尚未确定/)).toBeInTheDocument();
  });

  it("允许填写修正要求并重新生成", () => {
    render(<IdeaFromMaterialsPanel onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("修正要求（可选）"), {
      target: { value: "限制为两周内完成" },
    });
    expect(setFeedback).toHaveBeenCalledWith("限制为两周内完成");

    fireEvent.click(screen.getByRole("button", { name: "按修正重新生成" }));
    expect(generate).toHaveBeenCalled();
  });

  it("从候选假设标题进入研究规划", () => {
    render(<IdeaFromMaterialsPanel onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /用图路径约束减少无来源断言/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      topic: "用图路径约束减少无来源断言",
      keywords: ["Graph RAG", "evidence grounding"],
      goal: expect.stringContaining("加入证据路径约束后"),
      knownContext: expect.stringContaining("材料支持"),
      hypothesisCard: expect.objectContaining({
        hypothesis: "加入证据路径约束后，无来源断言比例会下降",
        falsification: "加入约束后无来源断言比例没有下降",
        validation_steps: ["冻结问题集", "比较约束前后", "统计无来源断言比例"],
      }),
    }));
  });
});
