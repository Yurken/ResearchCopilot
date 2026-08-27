import { useEffect, useSyncExternalStore } from "react";
import { safeListen } from "../../lib/tauriEvent";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { LearningPath, ResearchInterest } from "@research-copilot/types";
import type { InterestAgentState, InterestPlanRunSnapshot, InterestPlanRunSnapshots } from "./shared";

interface InterestStatusEvent {
  id: string;
  status: string;
  learning_path?: LearningPath;
}

interface InterestPlanEvent {
  id: string;
  learning_path: LearningPath;
}

interface InterestErrorEvent {
  id: string;
  error: string;
}

interface InterestAgentEvent {
  id: string;
  agent: Partial<InterestAgentState> & { id: string };
}

const NON_PLAN_EVENT_IDS = new Set(["hints", "suggest", "workbench_overview", "planner"]);
const INTEREST_PLAN_STORAGE_KEY = "rc:interest-plan:runs";
// 快照只为恢复「正在进行中」的任务进度；超过 TTL 的快照在加载时丢弃，
// 避免重启后旧 planning 快照把 DB 已复位的终态覆盖回去。
export const INTEREST_PLAN_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

let snapshots: InterestPlanRunSnapshots = readStoredSnapshots();
let listenerPromise: Promise<UnlistenFn[]> | null = null;

const subscribers = new Set<() => void>();

export function isInterestPlanSnapshotStale(snapshot: InterestPlanRunSnapshot, now = Date.now()) {
  return typeof snapshot.updatedAt !== "number" || now - snapshot.updatedAt > INTEREST_PLAN_SNAPSHOT_TTL_MS;
}

function readStoredSnapshots(): InterestPlanRunSnapshots {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(INTEREST_PLAN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as InterestPlanRunSnapshots;
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([id, snapshot]) =>
          !shouldIgnorePlanEvent(id) &&
          snapshot &&
          typeof snapshot === "object" &&
          !isInterestPlanSnapshotStale(snapshot, now),
      ),
    );
  } catch {
    return {};
  }
}

function persistSnapshots() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTEREST_PLAN_STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // localStorage is best-effort; in-memory snapshots still keep navigation within this session recoverable.
  }
}

function shouldIgnorePlanEvent(id: string) {
  return !id || NON_PLAN_EVENT_IDS.has(id);
}

function notify() {
  persistSnapshots();
  subscribers.forEach((subscriber) => subscriber());
}

function updateSnapshot(
  id: string,
  updater: (current: InterestPlanRunSnapshot) => InterestPlanRunSnapshot,
) {
  if (shouldIgnorePlanEvent(id)) return;

  const current = snapshots[id] ?? { agents: [], updatedAt: Date.now() };
  snapshots = {
    ...snapshots,
    [id]: {
      ...updater(current),
      updatedAt: Date.now(),
    },
  };
  notify();
}

function normalizeAgent(
  agent: Partial<InterestAgentState> & { id: string },
  fallbackStatus: InterestAgentState["status"],
): InterestAgentState {
  return {
    id: agent.id,
    name: agent.name || "小妍",
    role: agent.role || "处理研究路线",
    status: agent.status || fallbackStatus,
    summary: agent.summary,
    error: agent.error,
  };
}

function upsertAgent(
  interestId: string,
  agent: Partial<InterestAgentState> & { id: string },
  fallbackStatus: InterestAgentState["status"],
) {
  updateSnapshot(interestId, (current) => {
    const nextAgent = normalizeAgent(agent, fallbackStatus);
    const index = current.agents.findIndex((item) => item.id === nextAgent.id);
    const agents = index === -1
      ? [...current.agents, nextAgent]
      : current.agents.map((item) =>
          item.id === nextAgent.id ? { ...item, ...nextAgent } : item
        );

    return {
      ...current,
      status: current.status === "planned" ? current.status : "planning",
      agents,
    };
  });
}

function resolveFailureStatus(current: InterestPlanRunSnapshot) {
  // 后端在失败前会先 emit interest:status（携带 restore 后的真实 DB 状态），优先沿用；
  // 仅在拿不到真实状态时（仍为 planning 或缺省）才退回按 learningPath 推导。
  if (current.status && current.status !== "planning") return current.status;
  return current.learningPath ? "planned" : "active";
}

function failRunningAgents(agents: InterestAgentState[], error: string) {
  return agents.map((agent) =>
    agent.status === "running"
      ? { ...agent, status: "failed" as const, error: agent.error || error }
      : agent
  );
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function getSnapshot() {
  return snapshots;
}

async function installInterestPlanListeners() {
  return Promise.all([
    safeListen<InterestStatusEvent>("interest:status", (event) => {
      const { id, status, learning_path: learningPath } = event.payload;
      updateSnapshot(id, (current) => ({
        ...current,
        status,
        learningPath: learningPath ?? current.learningPath,
        error: status === "planning" ? undefined : current.error,
      }));
    }),
    safeListen<InterestPlanEvent>("interest:plan", (event) => {
      updateSnapshot(event.payload.id, (current) => ({
        ...current,
        status: "planned",
        learningPath: event.payload.learning_path,
        error: undefined,
      }));
    }),
    safeListen<InterestErrorEvent>("interest:error", (event) => {
      const { id, error } = event.payload;
      updateSnapshot(id, (current) => ({
        ...current,
        status: resolveFailureStatus(current),
        agents: failRunningAgents(current.agents, error),
        error,
      }));
    }),
    safeListen<InterestAgentEvent>("interest:agent_start", (event) => {
      upsertAgent(event.payload.id, event.payload.agent, "running");
    }),
    safeListen<InterestAgentEvent>("interest:agent_complete", (event) => {
      upsertAgent(event.payload.id, { ...event.payload.agent, status: "done" }, "done");
    }),
    safeListen<InterestAgentEvent>("interest:agent_error", (event) => {
      upsertAgent(event.payload.id, { ...event.payload.agent, status: "failed" }, "failed");
    }),
  ]);
}

export function useInterestPlanEventBridge() {
  useEffect(() => {
    if (!listenerPromise) {
      listenerPromise = installInterestPlanListeners();
    }
  }, []);
}

export function useInterestPlanSnapshots() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function startInterestPlanRun(id: string, existingLearningPath?: LearningPath) {
  updateSnapshot(id, (current) => ({
    ...current,
    status: "planning",
    learningPath: existingLearningPath ?? current.learningPath,
    agents: [],
    error: undefined,
  }));
}

export function resumeInterestPlanRun(id: string, startStep: number) {
  updateSnapshot(id, (current) => ({
    ...current,
    status: "planning",
    agents: current.agents.slice(0, startStep),
    error: undefined,
  }));
}

export function failInterestPlanRun(id: string, error: string) {
  updateSnapshot(id, (current) => ({
    ...current,
    status: resolveFailureStatus(current),
    agents: failRunningAgents(current.agents, error),
    error,
  }));
}

export function removeInterestPlanSnapshot(id: string) {
  if (!(id in snapshots)) return;
  const next = { ...snapshots };
  delete next[id];
  snapshots = next;
  notify();
}

// 与后端 knowledge_generate_plan 的并发防护文案对应：
// 同一主题已有规划任务在跑时，后端拒绝新的 generate_plan 并返回该文案。
export const INTEREST_PLAN_BUSY_ERROR_MARKER = "规划正在生成中";

export function isInterestPlanBusyError(message: string) {
  return message.includes(INTEREST_PLAN_BUSY_ERROR_MARKER);
}

export function applyInterestPlanSnapshots<T extends ResearchInterest>(
  interests: T[],
  planSnapshots: InterestPlanRunSnapshots,
): T[] {
  return interests.map((interest) => {
    const snapshot = planSnapshots[interest.id];
    if (!snapshot || isInterestPlanSnapshotStale(snapshot)) return interest;

    // 快照只能补充「正在运行的任务进度」：当 DB 侧已是终态（active/planned），
    // 且快照里没有正在运行的 agent 作为任务仍在进行的证据时，以 DB 状态为准，
    // 不把旧快照的 planning 盖回去。
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
    const hasRunningAgent = agents.some((agent) => agent.status === "running");
    const status =
      snapshot.status === "planning" && interest.status !== "planning" && !hasRunningAgent
        ? interest.status
        : snapshot.status ?? interest.status;

    return {
      ...interest,
      status,
      learning_path: snapshot.learningPath ?? interest.learning_path,
    };
  });
}
