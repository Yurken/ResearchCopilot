import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MockReviewModal from "../../../features/submission/MockReviewModal";

const result = {
  id: "submission-1:0",
  reviewer: "方法审稿人",
  content: "**建议：** 补充消融实验",
  suggestions: ["补充消融实验"],
  tags: ["方法"],
  verdict: "major_revision" as const,
};

function renderModal(onFeedback = vi.fn()) {
  render(<MockReviewModal
    open
    mockReviewInput={{ abstract: "论文内容", reviewerCount: 3, strictness: "balanced" }}
    mockReviewResult={[result]}
    mockReviewLoading={false}
    mockFileExtracting={false}
    mockFileName={null}
    onClose={vi.fn()}
    onSetInput={vi.fn()}
    onPickPdf={vi.fn()}
    onReset={vi.fn()}
    onImport={vi.fn()}
    onGenerate={vi.fn()}
    feedback={{}}
    feedbackSummary={{ pending: 0, adopted: 0, ignored: 0, done: 0 }}
    feedbackSavingKey={null}
    onFeedback={onFeedback}
  />);
  return onFeedback;
}

describe("MockReviewModal value feedback", () => {
  it("允许逐条标记采纳与完成", () => {
    const onFeedback = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    expect(onFeedback).toHaveBeenCalledWith(result, 0, "adopted", undefined);
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    expect(onFeedback).toHaveBeenCalledWith(result, 0, "done", undefined);
  });

  it("忽略建议会提交结构化原因", () => {
    const onFeedback = renderModal();
    fireEvent.change(screen.getByLabelText("忽略原因"), { target: { value: "成本过高" } });
    expect(onFeedback).toHaveBeenCalledWith(result, 0, "ignored", "成本过高");
  });
});
