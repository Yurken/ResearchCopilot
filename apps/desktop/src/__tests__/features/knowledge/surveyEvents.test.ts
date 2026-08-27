import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyAgentState } from "../../../features/knowledge/shared";

const handlers: Record<string, (event: { payload: never }) => void> = {};

vi.mock("../../../lib/tauriEvent", () => ({
  safeListen: vi.fn((event: string, handler: (event: { payload: never }) => void) => {
    handlers[event] = handler;
    return Promise.resolve(() => {});
  }),
}));

import { listenSurveyGenerated, registerSurveyEventListeners } from "../../../features/knowledge/surveyEvents";

function makeOptions() {
  return {
    requestIdRef: { current: "req-1" },
    contentRef: { current: "" },
    setContent: vi.fn(),
    setGenerating: vi.fn(),
    setError: vi.fn(),
    setActionError: vi.fn(),
    setAgents: vi.fn(),
    setStructured: vi.fn(),
    cleanupSurveyListeners: vi.fn(),
  };
}

describe("registerSurveyEventListeners", () => {
  beforeEach(() => {
    for (const key of Object.keys(handlers)) delete handlers[key];
  });

  it("agent_error 只更新阶段状态，不结束整体生成（B2）", async () => {
    const options = makeOptions();
    await registerSurveyEventListeners(options);

    const agent: SurveyAgentState = { id: "a1", name: "时序分析 Agent", role: "梳理脉络", status: "running" };
    handlers["survey:agent_error"]({
      payload: { request_id: "req-1", agent: { ...agent, error: "LLM 超时" } } as never,
    });

    expect(options.setAgents).toHaveBeenCalledTimes(1);
    const updater = options.setAgents.mock.calls[0][0] as (prev: SurveyAgentState[]) => SurveyAgentState[];
    const next = updater([agent]);
    expect(next[0].status).toBe("failed");
    expect(next[0].error).toBe("LLM 超时");
    expect(options.setError).not.toHaveBeenCalled();
    expect(options.setGenerating).not.toHaveBeenCalled();
    expect(options.cleanupSurveyListeners).not.toHaveBeenCalled();
  });

  it("survey:error 才结束整体生成（B2）", async () => {
    const options = makeOptions();
    await registerSurveyEventListeners(options);

    handlers["survey:error"]({ payload: { request_id: "req-1", error: "整体失败" } as never });

    expect(options.setError).toHaveBeenCalledWith("整体失败");
    expect(options.setGenerating).toHaveBeenCalledWith(false);
    expect(options.cleanupSurveyListeners).toHaveBeenCalledTimes(1);
  });

  it("survey:done 携带 saved=false 时提示保存失败但不报错中断（B5）", async () => {
    const options = makeOptions();
    await registerSurveyEventListeners(options);

    handlers["survey:done"]({
      payload: { request_id: "req-1", saved: false, save_error: "disk full" } as never,
    });

    expect(options.setActionError).toHaveBeenCalledTimes(1);
    expect(options.setActionError.mock.calls[0][0]).toContain("保存到历史记录失败");
    expect(options.setError).not.toHaveBeenCalled();
    expect(options.setGenerating).toHaveBeenCalledWith(false);
  });

  it("survey:done 正常落库时不产生保存失败提示", async () => {
    const options = makeOptions();
    await registerSurveyEventListeners(options);

    handlers["survey:done"]({ payload: { request_id: "req-1", saved: true } as never });

    expect(options.setActionError).not.toHaveBeenCalled();
    expect(options.setGenerating).toHaveBeenCalledWith(false);
  });
});

describe("listenSurveyGenerated（B6：聊天触发综述联动刷新）", () => {
  beforeEach(() => {
    for (const key of Object.keys(handlers)) delete handlers[key];
  });

  it("收到 survey:generated 事件时触发回调，销毁后不再触发", async () => {
    const onGenerated = vi.fn();
    const dispose = listenSurveyGenerated(onGenerated);
    await Promise.resolve();
    await Promise.resolve();

    expect(handlers["survey:generated"]).toBeDefined();
    handlers["survey:generated"]({ payload: { request_id: "chat-1", query: "q" } as never });
    expect(onGenerated).toHaveBeenCalledTimes(1);

    dispose();
    handlers["survey:generated"]({ payload: { request_id: "chat-2", query: "q" } as never });
    expect(onGenerated).toHaveBeenCalledTimes(1);
  });
});
