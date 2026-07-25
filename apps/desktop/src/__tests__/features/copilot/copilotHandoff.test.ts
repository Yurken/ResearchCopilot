import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeCopilotPaperHandoff,
  queueCopilotPaperHandoff,
  removeCopilotHandoffDetail,
} from "../../../features/copilot/copilotHandoff";

describe("copilot paper handoff", () => {
  beforeEach(() => sessionStorage.clear());

  it("只消费一次论文上下文交接", () => {
    queueCopilotPaperHandoff({
      contextId: "paper-1",
      contextLabel: "Paper One",
      page: 6,
      selection: "selected evidence",
      prompt: "解释这一页",
    });

    expect(consumeCopilotPaperHandoff()).toMatchObject({
      contextType: "paper",
      contextId: "paper-1",
      contextLabel: "Paper One",
      page: 6,
      selection: "selected evidence",
      prompt: "解释这一页",
    });
    expect(consumeCopilotPaperHandoff()).toBeNull();
  });

  it("移除选区时同步重建未发送提示词", () => {
    const next = removeCopilotHandoffDetail({
      contextType: "paper",
      contextId: "paper-1",
      contextLabel: "Paper One",
      page: 6,
      selection: "selected evidence",
      prompt: "old prompt",
      createdAt: "2026-07-22T00:00:00Z",
    }, "selection");

    expect(next.selection).toBeUndefined();
    expect(next.prompt).toContain("第 6 页");
    expect(next.prompt).not.toContain("selected evidence");
  });
});
