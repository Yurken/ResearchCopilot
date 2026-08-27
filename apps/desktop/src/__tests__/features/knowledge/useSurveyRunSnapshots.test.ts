import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyRunSnapshot } from "../../../features/knowledge/shared";
import {
  restoreSurveyRunSnapshot,
  SURVEY_RUN_INTERRUPTED_MESSAGE,
  SURVEY_RUN_SNAPSHOT_TTL_MS,
} from "../../../features/knowledge/useSurveyRunSnapshots";

function baseSnapshot(overrides: Partial<SurveyRunSnapshot> = {}): SurveyRunSnapshot {
  return {
    requestId: "req-1",
    status: "running",
    query: "测试主题",
    maxPapers: 20,
    litTypes: [],
    databases: [],
    citationFormat: "gbt7714",
    language: "both",
    content: "",
    agents: [],
    structured: null,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("restoreSurveyRunSnapshot（B1：过期快照降级）", () => {
  it("缺 requestId/query 的快照直接丢弃", () => {
    expect(restoreSurveyRunSnapshot(null, 1_000)).toBeNull();
    expect(restoreSurveyRunSnapshot({ requestId: "", query: "q" } as SurveyRunSnapshot, 1_000)).toBeNull();
  });

  it("running 快照超过 TTL 时降级为 failed 并标记运行中阶段", () => {
    const now = 1_000 + SURVEY_RUN_SNAPSHOT_TTL_MS + 1;
    const restored = restoreSurveyRunSnapshot(
      baseSnapshot({
        agents: [
          { id: "a1", name: "检索规划 Agent", role: "规划", status: "done" },
          { id: "a2", name: "综述写作 Agent", role: "写作", status: "running" },
        ],
      }),
      now,
    );

    expect(restored?.status).toBe("failed");
    expect(restored?.error).toBe(SURVEY_RUN_INTERRUPTED_MESSAGE);
    expect(restored?.agents[0].status).toBe("done");
    expect(restored?.agents[1].status).toBe("failed");
    expect(restored?.agents[1].error).toBe(SURVEY_RUN_INTERRUPTED_MESSAGE);
  });

  it("TTL 内的 running 快照保持 running", () => {
    const restored = restoreSurveyRunSnapshot(baseSnapshot(), 1_000 + SURVEY_RUN_SNAPSHOT_TTL_MS - 1);
    expect(restored?.status).toBe("running");
  });

  it("done/failed 快照不受 TTL 影响", () => {
    const now = 1_000 + SURVEY_RUN_SNAPSHOT_TTL_MS * 10;
    expect(restoreSurveyRunSnapshot(baseSnapshot({ status: "done" }), now)?.status).toBe("done");
    expect(restoreSurveyRunSnapshot(baseSnapshot({ status: "failed" }), now)?.status).toBe("failed");
  });
});

describe("useSurveyRunSnapshots 事件桥（B2：阶段失败不终结整体运行）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function loadStore() {
    vi.resetModules();
    const handlers: Record<string, (event: { payload: never }) => void> = {};
    vi.doMock("../../../lib/tauriEvent", () => ({
      safeListen: vi.fn((event: string, handler: (event: { payload: never }) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }),
    }));
    const mod = await import("../../../features/knowledge/useSurveyRunSnapshots");
    return { mod, handlers };
  }

  it("agent_error 只标记对应阶段失败，整体保持 running；survey:error 才整体失败", async () => {
    const { mod, handlers } = await loadStore();
    const { result } = renderHook(() => {
      mod.useSurveyRunEventBridge();
      return mod.useActiveSurveyRunSnapshot();
    });

    act(() => {
      mod.startSurveyRunSnapshot({
        requestId: "req-b2",
        query: "主题",
        maxPapers: 20,
        litTypes: [],
        databases: [],
        citationFormat: "gbt7714",
        language: "both",
      });
    });
    expect(result.current?.status).toBe("running");

    act(() => {
      handlers["survey:agent_error"]({
        payload: {
          request_id: "req-b2",
          agent: { id: "a1", name: "时序分析 Agent", role: "梳理脉络", status: "failed", error: "LLM 超时" },
        } as never,
      });
    });

    expect(result.current?.status).toBe("running");
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.agents.find((agent) => agent.id === "a1")?.status).toBe("failed");

    act(() => {
      handlers["survey:error"]({ payload: { request_id: "req-b2", error: "整体失败" } as never });
    });
    expect(result.current?.status).toBe("failed");
    expect(result.current?.error).toBe("整体失败");

    // failed 之后不再接受 running 回跳
    act(() => {
      handlers["survey:agent_start"]({
        payload: {
          request_id: "req-b2",
          agent: { id: "a2", name: "综述写作 Agent", role: "写作", status: "running" },
        } as never,
      });
    });
    expect(result.current?.status).toBe("failed");
  });

  it("agent_error 后 survey:done 仍可正常收口为 done", async () => {
    const { mod, handlers } = await loadStore();
    const { result } = renderHook(() => {
      mod.useSurveyRunEventBridge();
      return mod.useActiveSurveyRunSnapshot();
    });

    act(() => {
      mod.startSurveyRunSnapshot({
        requestId: "req-b2b",
        query: "主题",
        maxPapers: 20,
        litTypes: [],
        databases: [],
        citationFormat: "gbt7714",
        language: "both",
      });
    });
    act(() => {
      handlers["survey:agent_error"]({
        payload: {
          request_id: "req-b2b",
          agent: { id: "a1", name: "时序分析 Agent", role: "梳理脉络", status: "failed", error: "LLM 超时" },
        } as never,
      });
    });
    act(() => {
      handlers["survey:done"]({ payload: { request_id: "req-b2b" } as never });
    });

    expect(result.current?.status).toBe("done");
    expect(result.current?.agents.find((agent) => agent.id === "a1")?.status).toBe("failed");
  });
});
