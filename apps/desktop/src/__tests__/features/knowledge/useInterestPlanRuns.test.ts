import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchInterest } from "@research-copilot/types";

const eventHandlers = vi.hoisted(() => ({
  map: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    eventHandlers.map.set(name, handler);
    return Promise.resolve(() => {});
  }),
  emit: vi.fn(),
  once: vi.fn(),
  TauriEvent: {
    DRAG_ENTER: "tauri://drag-enter",
    DRAG_OVER: "tauri://drag-over",
    DRAG_DROP: "tauri://drag-drop",
    DRAG_LEAVE: "tauri://drag-leave",
  },
}));

const STORAGE_KEY = "rc:interest-plan:runs";
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadModule() {
  vi.resetModules();
  return import("../../../features/knowledge/useInterestPlanRuns");
}

function emitEvent(name: string, payload: unknown) {
  const handler = eventHandlers.map.get(name);
  if (!handler) throw new Error(`listener ${name} 未注册`);
  act(() => handler({ payload }));
}

describe("useInterestPlanRuns", () => {
  beforeEach(() => {
    localStorage.clear();
    eventHandlers.map.clear();
  });

  it("加载时丢弃过期快照与遗留 planner 垃圾快照（B1/B2）", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        stale: { status: "planning", agents: [], updatedAt: Date.now() - DAY_MS - 1000 },
        fresh: {
          status: "planning",
          agents: [{ id: "a1", name: "洞见模型", role: "拆解", status: "running" }],
          updatedAt: Date.now(),
        },
        planner: { status: "planning", agents: [], updatedAt: Date.now() },
      }),
    );

    const mod = await loadModule();
    const { result } = renderHook(() => mod.useInterestPlanSnapshots());

    expect(result.current.stale).toBeUndefined();
    expect(result.current.planner).toBeUndefined();
    expect(result.current.fresh).toBeDefined();
  });

  it("快照不得把 DB 终态盖回 planning；有运行中 agent 时除外（B1）", async () => {
    const mod = await loadModule();
    const interests = [
      { id: "a", status: "planned", learning_path: { overview: "已生成" } },
      { id: "b", status: "active", learning_path: null },
      { id: "c", status: "planned", learning_path: { overview: "已生成" } },
    ] as unknown as ResearchInterest[];

    const applied = mod.applyInterestPlanSnapshots(interests, {
      a: { status: "planning", agents: [], updatedAt: Date.now() },
      b: {
        status: "planning",
        agents: [{ id: "s1", name: "探知模型", role: "筛选", status: "running" }],
        updatedAt: Date.now(),
      },
      c: { status: "planning", agents: [], updatedAt: Date.now() - DAY_MS - 1000 },
    });

    // 无运行中任务证据：以 DB 的 planned 为准
    expect(applied[0].status).toBe("planned");
    // 有运行中 agent：快照补充真实进度
    expect(applied[1].status).toBe("planning");
    // 过期快照：整体忽略
    expect(applied[2].status).toBe("planned");
  });

  it("interest:error 优先沿用 interest:status 事件携带的真实 DB 状态（B6）", async () => {
    const mod = await loadModule();
    const reader = renderHook(() => mod.useInterestPlanSnapshots());
    renderHook(() => mod.useInterestPlanEventBridge());

    await waitFor(() => expect(eventHandlers.map.has("interest:error")).toBe(true));

    // 先有一次成功规划（快照里留下 learningPath），随后新一轮规划失败，
    // 后端先 emit interest:status（复位后的真实状态 active），再 emit interest:error。
    emitEvent("interest:plan", { id: "x", learning_path: { overview: "旧路线" } });
    emitEvent("interest:status", { id: "x", status: "active" });
    emitEvent("interest:error", { id: "x", error: "模型超时" });

    // 推导（learningPath 存在 → planned）只作兜底；真实 DB 状态 active 优先。
    expect(reader.result.current.x.status).toBe("active");
    expect(reader.result.current.x.error).toBe("模型超时");
  });

  it("interest:error 在没有真实状态事件时退回按 learningPath 推导（B6 兜底）", async () => {
    const mod = await loadModule();
    const reader = renderHook(() => mod.useInterestPlanSnapshots());
    renderHook(() => mod.useInterestPlanEventBridge());

    await waitFor(() => expect(eventHandlers.map.has("interest:error")).toBe(true));

    emitEvent("interest:plan", { id: "with-path", learning_path: { overview: "路线" } });
    emitEvent("interest:status", { id: "with-path", status: "planning" });
    emitEvent("interest:error", { id: "with-path", error: "失败" });
    expect(reader.result.current["with-path"].status).toBe("planned");

    emitEvent("interest:status", { id: "no-path", status: "planning" });
    emitEvent("interest:error", { id: "no-path", error: "失败" });
    expect(reader.result.current["no-path"].status).toBe("active");
  });

  it("忽略 planner 等非规划事件 id，不产生垃圾快照（B2）", async () => {
    const mod = await loadModule();
    const reader = renderHook(() => mod.useInterestPlanSnapshots());
    renderHook(() => mod.useInterestPlanEventBridge());

    await waitFor(() => expect(eventHandlers.map.has("interest:agent_start")).toBe(true));

    for (const id of ["planner", "hints", "suggest", "workbench_overview"]) {
      emitEvent("interest:agent_start", { id, agent: { id: `${id}-1` } });
      emitEvent("interest:error", { id, error: "boom" });
    }

    expect(reader.result.current.planner).toBeUndefined();
    expect(reader.result.current.hints).toBeUndefined();
    expect(reader.result.current.suggest).toBeUndefined();
    expect(reader.result.current.workbench_overview).toBeUndefined();
  });

  it("识别后端并发防护文案（B5）", async () => {
    const mod = await loadModule();
    expect(mod.isInterestPlanBusyError("该研究主题的规划正在生成中，请等待完成后再试。")).toBe(true);
    expect(mod.isInterestPlanBusyError("未找到对应研究方向。")).toBe(false);
  });
});
