import { useEffect, useSyncExternalStore } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { safeListen } from "../../lib/tauriEvent";
import type { StructuredSurveyResult, SurveyAgentState, SurveyRunSnapshot } from "./shared";

const SURVEY_RUN_STORAGE_KEY = "rc:survey:active-run";

/** 生成中快照的有效期：正常生成远低于 2 小时，超时视为进程被杀、任务已中断。 */
export const SURVEY_RUN_SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;
export const SURVEY_RUN_INTERRUPTED_MESSAGE = "上次生成已中断（应用可能已退出），可调整后重新生成。";

/**
 * 恢复本地持久化的运行快照：校验字段完整性；
 * running 快照超过 TTL 说明生成进程已被杀掉，降级为 failed，避免页面死锁。
 */
export function restoreSurveyRunSnapshot(
  parsed: SurveyRunSnapshot | null,
  now: number = Date.now(),
): SurveyRunSnapshot | null {
  if (!parsed?.requestId || !parsed.query) return null;
  const normalized: SurveyRunSnapshot = {
    ...parsed,
    content: parsed.content ?? "",
    agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    structured: parsed.structured ?? null,
    litTypes: Array.isArray(parsed.litTypes) ? parsed.litTypes : [],
    databases: Array.isArray(parsed.databases) ? parsed.databases : [],
  };
  if (normalized.status === "running" && now - (normalized.updatedAt || 0) > SURVEY_RUN_SNAPSHOT_TTL_MS) {
    return {
      ...normalized,
      status: "failed",
      error: SURVEY_RUN_INTERRUPTED_MESSAGE,
      agents: normalized.agents.map((agent) =>
        agent.status === "running" ? { ...agent, status: "failed", error: SURVEY_RUN_INTERRUPTED_MESSAGE } : agent,
      ),
    };
  }
  return normalized;
}

let activeSnapshot: SurveyRunSnapshot | null = readStoredSnapshot();
let listenerPromise: Promise<UnlistenFn[]> | null = null;
const subscribers = new Set<() => void>();

function readStoredSnapshot(): SurveyRunSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SURVEY_RUN_STORAGE_KEY);
    if (!raw) return null;
    return restoreSurveyRunSnapshot(JSON.parse(raw) as SurveyRunSnapshot);
  } catch {
    return null;
  }
}

function persistSnapshot() {
  if (typeof window === "undefined") return;
  try {
    if (activeSnapshot) {
      window.localStorage.setItem(SURVEY_RUN_STORAGE_KEY, JSON.stringify(activeSnapshot));
    } else {
      window.localStorage.removeItem(SURVEY_RUN_STORAGE_KEY);
    }
  } catch {
    // localStorage persistence is best-effort; in-memory state still keeps the page recoverable.
  }
}

function notify() {
  persistSnapshot();
  subscribers.forEach((subscriber) => subscriber());
}

function acceptsRequest(requestId?: string) {
  return Boolean(activeSnapshot && (!requestId || requestId === activeSnapshot.requestId));
}

function updateActiveSnapshot(updater: (current: SurveyRunSnapshot) => SurveyRunSnapshot) {
  if (!activeSnapshot) return;
  activeSnapshot = {
    ...updater(activeSnapshot),
    updatedAt: Date.now(),
  };
  notify();
}

function normalizeAgent(agent: SurveyAgentState, fallbackStatus: SurveyAgentState["status"]): SurveyAgentState {
  return {
    id: agent.id,
    name: agent.name || "小妍",
    role: agent.role || "生成文献综述",
    status: agent.status || fallbackStatus,
    summary: agent.summary,
    error: agent.error,
  };
}

function upsertAgent(agent: SurveyAgentState, fallbackStatus: SurveyAgentState["status"]) {
  updateActiveSnapshot((current) => {
    const nextAgent = normalizeAgent(agent, fallbackStatus);
    const duplicateDoneStage = current.agents.some(
      (item) => item.name === nextAgent.name && item.status === "done" && item.id !== nextAgent.id,
    );
    if (duplicateDoneStage && fallbackStatus !== "failed") {
      return current;
    }
    const exists = current.agents.some((item) => item.id === nextAgent.id);
    // 阶段级失败（survey:agent_error）不代表整体失败：后端会降级继续，
    // 只有 survey:error 才把整体状态置为 failed，避免快照卡死后拒绝后续 running 更新。
    return {
      ...current,
      status: current.status === "failed" ? "failed" : "running",
      error: current.error,
      agents: exists
        ? current.agents.map((item) => (item.id === nextAgent.id ? { ...item, ...nextAgent } : item))
        : [...current.agents, nextAgent],
    };
  });
}

function failRunningAgents(agents: SurveyAgentState[], error: string) {
  return agents.map((agent) => (agent.status === "running" ? { ...agent, status: "failed" as const, error } : agent));
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function getSnapshot() {
  return activeSnapshot;
}

async function installSurveyRunListeners() {
  return Promise.all([
    safeListen<{ request_id?: string; delta: string }>("survey:delta", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      updateActiveSnapshot((current) => ({
        ...current,
        status: "running",
        content: `${current.content}${event.payload.delta}`,
      }));
    }),
    safeListen<{ request_id?: string }>("survey:done", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      updateActiveSnapshot((current) => ({ ...current, status: "done", error: undefined }));
    }),
    safeListen<{ request_id?: string; error: string }>("survey:error", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      updateActiveSnapshot((current) => ({
        ...current,
        status: "failed",
        error: event.payload.error,
        agents: failRunningAgents(current.agents, event.payload.error),
      }));
    }),
    safeListen<{
      request_id?: string;
      query: string;
      report: StructuredSurveyResult["report"];
      papers: StructuredSurveyResult["papers"];
      formatted_citations?: string[];
      citation_format?: string;
      meta?: StructuredSurveyResult["meta"];
    }>("survey:structured", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      updateActiveSnapshot((current) => ({
        ...current,
        structured: {
          query: event.payload.query,
          report: event.payload.report,
          papers: event.payload.papers,
          formatted_citations: event.payload.formatted_citations,
          citation_format: event.payload.citation_format,
          meta: event.payload.meta,
        },
      }));
    }),
    safeListen<{ request_id?: string; agent: SurveyAgentState }>("survey:agent_start", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      upsertAgent(event.payload.agent, "running");
    }),
    safeListen<{ request_id?: string; agent: SurveyAgentState }>("survey:agent_complete", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      upsertAgent({ ...event.payload.agent, status: "done" }, "done");
    }),
    safeListen<{ request_id?: string; agent: SurveyAgentState }>("survey:agent_error", (event) => {
      if (!acceptsRequest(event.payload.request_id)) return;
      upsertAgent({ ...event.payload.agent, status: "failed" }, "failed");
    }),
  ]);
}

export function useSurveyRunEventBridge() {
  useEffect(() => {
    if (!listenerPromise) {
      listenerPromise = installSurveyRunListeners();
    }
  }, []);
}

export function useActiveSurveyRunSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function startSurveyRunSnapshot(snapshot: Omit<SurveyRunSnapshot, "status" | "content" | "agents" | "structured" | "error" | "updatedAt">) {
  activeSnapshot = {
    ...snapshot,
    status: "running",
    content: "",
    agents: [],
    structured: null,
    updatedAt: Date.now(),
  };
  notify();
}

export function resumeSurveyRunSnapshot(previous: SurveyRunSnapshot, requestId: string) {
  const failedIndex = previous.agents.findIndex((agent) => agent.status === "failed");
  activeSnapshot = {
    ...previous,
    requestId,
    status: "running",
    content: previous.content,
    agents: failedIndex === -1 ? previous.agents : previous.agents.slice(0, failedIndex),
    structured: null,
    error: undefined,
    updatedAt: Date.now(),
  };
  notify();
}

export function failSurveyRunSnapshot(error: string) {
  updateActiveSnapshot((current) => ({
    ...current,
    status: "failed",
    error,
    agents: failRunningAgents(current.agents, error),
  }));
}

export function clearSurveyRunSnapshot() {
  activeSnapshot = null;
  notify();
}
