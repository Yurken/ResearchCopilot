import type {
  WorkbenchAgendaItem,
  WorkbenchCheckpointItem,
  WorkbenchHandoffItem,
  WorkbenchLinkAction,
  WorkbenchTone,
} from "./shared";
import {
  createResearchCheckpointHandoff,
  RESEARCH_CHECKPOINT_HANDOFF_KEY,
} from "../research-context/checkpointHandoff";

interface InterestCheckpointSummary {
  count: number;
  latestUpdatedAt?: string;
  nextStep: string;
  summary: string;
  hasFailed: boolean;
  hasOpenQuestions: boolean;
}

function toTimestamp(value?: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDateTime(value?: string | null): string {
  const timestamp = toTimestamp(value);
  if (!timestamp) return "时间待确认";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function previewText(value: string, maxLength: number): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}…`;
}

function latestCheckpoint(checkpoints: WorkbenchCheckpointItem[]): WorkbenchCheckpointItem | undefined {
  return [...checkpoints].sort(
    (left, right) => toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt),
  )[0];
}

function checkpointAction(checkpoint: WorkbenchCheckpointItem): WorkbenchLinkAction {
  const handoff = createResearchCheckpointHandoff({
    id: checkpoint.id,
    sessionId: checkpoint.sessionId,
    contextType: checkpoint.contextType,
    contextId: checkpoint.contextId,
    goal: checkpoint.goal,
    summary: checkpoint.summary,
    completedItems: checkpoint.completedItems,
    openQuestions: checkpoint.openQuestions,
    nextSteps: checkpoint.nextSteps,
    status: checkpoint.status,
    updatedAt: checkpoint.updatedAt || checkpoint.createdAt,
  });

  return {
    label: checkpoint.status === "failed" ? "恢复任务" : "继续研究",
    to: "/chat",
    state: { [RESEARCH_CHECKPOINT_HANDOFF_KEY]: handoff },
  };
}

function checkpointTone(checkpoint: WorkbenchCheckpointItem): WorkbenchTone {
  if (checkpoint.status === "failed") return "rust";
  if (checkpoint.openQuestions.length > 0) return "amber";
  return "blue";
}

function actionableText(checkpoint: WorkbenchCheckpointItem): string {
  return checkpoint.nextSteps[0] || checkpoint.openQuestions[0] || checkpoint.summary;
}

export function summarizeInterestCheckpoints(
  checkpoints: WorkbenchCheckpointItem[],
  interestId: string,
): InterestCheckpointSummary {
  const related = checkpoints.filter(
    (checkpoint) => checkpoint.contextType === "interest" && checkpoint.contextId === interestId,
  );
  const latest = latestCheckpoint(related);

  return {
    count: related.length,
    latestUpdatedAt: latest?.updatedAt || latest?.createdAt,
    nextStep: latest?.nextSteps[0] || "",
    summary: latest?.summary ? previewText(latest.summary, 90) : "",
    hasFailed: related.some((checkpoint) => checkpoint.status === "failed"),
    hasOpenQuestions: related.some((checkpoint) => checkpoint.openQuestions.length > 0),
  };
}

export function hasActionableCheckpoint(checkpoints: WorkbenchCheckpointItem[]): boolean {
  return checkpoints.some((checkpoint) => actionableText(checkpoint).trim().length > 0);
}

export function buildCheckpointAgendaItem(
  checkpoints: WorkbenchCheckpointItem[],
): WorkbenchAgendaItem | null {
  const checkpoint = latestCheckpoint(
    checkpoints.filter((item) => item.nextSteps.length > 0 || item.openQuestions.length > 0),
  );
  if (!checkpoint) return null;

  const actionText = actionableText(checkpoint);
  return {
    id: `checkpoint-agenda-${checkpoint.id}`,
    label: checkpoint.status === "failed" ? "需要重试" : "小妍续接",
    title: checkpoint.goal ? `接着处理：${previewText(checkpoint.goal, 24)}` : "接着处理上次对话",
    description: previewText(actionText, 96),
    tone: checkpointTone(checkpoint),
    action: checkpointAction(checkpoint),
  };
}

export function buildCheckpointHandoffItem(
  checkpoints: WorkbenchCheckpointItem[],
): WorkbenchHandoffItem | null {
  const checkpoint = latestCheckpoint(checkpoints);
  if (!checkpoint) return null;

  const actionText = actionableText(checkpoint);
  return {
    id: `handoff-checkpoint-${checkpoint.id}`,
    label: checkpoint.status === "failed" ? "对话未完成" : "记忆续接",
    title: checkpoint.goal ? previewText(checkpoint.goal, 36) : "小妍留下了待继续事项",
    description: `${formatDateTime(checkpoint.updatedAt || checkpoint.createdAt)}：${previewText(actionText, 104)}`,
    tone: checkpointTone(checkpoint),
    action: checkpointAction(checkpoint),
  };
}
