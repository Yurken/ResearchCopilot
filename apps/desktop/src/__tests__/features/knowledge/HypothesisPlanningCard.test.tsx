import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HypothesisPlanningCard from "../../../features/knowledge/HypothesisPlanningCard";

const card = {
  id: "hypothesis-1",
  version: 1,
  decision: "draft" as const,
  title: "证据路径约束",
  hypothesis: "加入路径约束后无来源断言下降",
  rationale: "回答难以追溯",
  evidence: ["材料支持"],
  counter_evidence: ["暂无反证"],
  falsification: "无来源断言未下降",
  validation_steps: ["冻结问题集", "比较基线"],
  uncertainties: ["样本量未知"],
  keywords: ["Graph RAG"],
  created_at: "2026-08-13T00:00:00Z",
  updated_at: "2026-08-13T00:00:00Z",
  origin: {
    hypothesis: "加入路径约束后无来源断言下降",
    falsification: "无来源断言未下降",
    validation_steps: ["冻结问题集", "比较基线"],
    captured_at: "2026-08-13T00:00:00Z",
  },
};

describe("HypothesisPlanningCard versioning", () => {
  it("编辑假设会生成可比较的修正版", () => {
    const onChange = vi.fn();
    const { rerender } = render(<HypothesisPlanningCard card={card} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("候选假设"), {
      target: { value: "缩小对象后无来源断言下降" },
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      version: 2,
      parent_version: 1,
      decision: "revised",
      hypothesis: "缩小对象后无来源断言下降",
    }));

    rerender(<HypothesisPlanningCard card={onChange.mock.calls[0][0]} onChange={onChange} />);
    expect(screen.getByText("版本对比：v1 原始版 → v2 当前版")).toBeInTheDocument();
    expect(screen.getByText(/加入路径约束后无来源断言下降 → 缩小对象后无来源断言下降/)).toBeInTheDocument();
  });

  it("直接采用也会保留原始版和采用版", () => {
    const onChange = vi.fn();
    render(<HypothesisPlanningCard card={card} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "采用" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      version: 2,
      parent_version: 1,
      decision: "adopted",
    }));
  });
});
