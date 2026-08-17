import { describe, expect, it } from "vitest";
import {
  buildCheckpointAgendaItem,
  buildCheckpointHandoffItem,
  hasActionableCheckpoint,
} from "../../../features/workbench/checkpointOverview";
import type { WorkbenchCheckpointItem } from "../../../features/workbench/shared";
import {
  readResearchCheckpointHandoff,
} from "../../../features/research-context/checkpointHandoff";

function checkpoint(overrides: Partial<WorkbenchCheckpointItem> = {}): WorkbenchCheckpointItem {
  return {
    id: "checkpoint-1",
    sessionId: "session-1",
    requestId: "request-1",
    contextType: "interest",
    contextId: "interest-1",
    goal: "完成研究路线评审",
    summary: "已整理候选路线。",
    completedItems: ["收集代表论文"],
    openQuestions: ["是否需要新增实验？"],
    nextSteps: ["比较两条候选路线"],
    status: "completed",
    createdAt: "2026-08-05T00:00:00Z",
    updatedAt: "2026-08-06T00:00:00Z",
    ...overrides,
  };
}

describe("workbench checkpoint actions", () => {
  it("将今日推进 checkpoint 交接给小妍而不是只打开页面", () => {
    const item = buildCheckpointAgendaItem([checkpoint()]);

    expect(item?.action.to).toBe("/chat");
    expect(item?.action.label).toBe("继续研究");
    expect(readResearchCheckpointHandoff(item?.action.state)).toMatchObject({
      id: "checkpoint-1",
      sessionId: "session-1",
      contextType: "interest",
      contextId: "interest-1",
      nextSteps: ["比较两条候选路线"],
    });
  });

  it("论文 checkpoint 也进入原会话并保留论文上下文", () => {
    const item = buildCheckpointHandoffItem([
      checkpoint({ contextType: "paper", contextId: "paper-1" }),
    ]);

    expect(item?.action.to).toBe("/chat");
    expect(readResearchCheckpointHandoff(item?.action.state)).toMatchObject({
      contextType: "paper",
      contextId: "paper-1",
    });
  });

  it("失败 checkpoint 使用恢复任务动作", () => {
    const item = buildCheckpointAgendaItem([
      checkpoint({ status: "failed", nextSteps: [], openQuestions: ["重试检索"] }),
    ]);

    expect(item?.action.label).toBe("恢复任务");
    expect(item?.tone).toBe("rust");
  });

  it("撤回 checkpoint 不再出现在续接入口", () => {
    const withdrawn = checkpoint({ reviewStatus: "withdrawn" });
    expect(buildCheckpointAgendaItem([withdrawn])).toBeNull();
    expect(buildCheckpointHandoffItem([withdrawn])).toBeNull();
    expect(hasActionableCheckpoint([withdrawn])).toBe(false);
  });
});
