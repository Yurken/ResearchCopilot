import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODE_HARNESS_PATHS,
  CODE_HARNESS_PROVIDER_CHANGE_EVENT,
  CODE_HARNESS_PROVIDER_STORAGE_KEY,
  normalizeCodeHarnessProvider,
  persistCodeHarnessProvider,
  readCodeHarnessProvider,
} from "../../features/code-harness/shared";

describe("代码助手切换", () => {
  beforeEach(() => localStorage.clear());

  it("默认使用 DSH", () => expect(readCodeHarnessProvider()).toBe("dsh"));
  it("非法存值回退到 DSH", () => expect(normalizeCodeHarnessProvider("claude")).toBe("dsh"));

  it("可持久化 Codex 并派发变更事件", () => {
    const handler = vi.fn();
    window.addEventListener(CODE_HARNESS_PROVIDER_CHANGE_EVENT, handler);
    persistCodeHarnessProvider("codex");
    expect(localStorage.getItem(CODE_HARNESS_PROVIDER_STORAGE_KEY)).toBe("codex");
    expect(readCodeHarnessProvider()).toBe("codex");
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(CODE_HARNESS_PROVIDER_CHANGE_EVENT, handler);
  });

  it("支持持久化 OpenCode 并映射独立路由", () => {
    persistCodeHarnessProvider("opencode");
    expect(readCodeHarnessProvider()).toBe("opencode");
    expect(CODE_HARNESS_PATHS.opencode).toBe("/opencode");
  });
});
