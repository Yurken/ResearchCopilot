import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useDeepSeekHarnessRuntime } from "../../features/deepseek-harness/useDeepSeekHarnessRuntime";
import type { DshRuntimeSnapshot } from "../../features/deepseek-harness/shared";

const stoppedSnapshot: DshRuntimeSnapshot = {
  phase: "stopped",
  config: {
    mode: "auto",
    externalExecutable: null,
    externalHome: null,
    profile: "web",
    workspaceDir: null,
  },
  url: null,
  error: null,
  logs: [],
  bundledAvailable: true,
  pathAvailable: false,
  pathExecutable: null,
  lockedVersion: "0.1.0-rc.5",
  lockedCommit: "47f943859bef60e4160492346772ded9b24f765a",
  nodeRequirement: "^22.19.0 || >=24.0.0",
  source: "https://github.com/deepseek-ai/deepseek-harness",
  dataHome: "/tmp/xiaoyan/dsh/bundled-home",
};

describe("useDeepSeekHarnessRuntime", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(stoppedSnapshot);
  });

  it("does not let an older status response overwrite a newer start result", async () => {
    const { result } = renderHook(() => useDeepSeekHarnessRuntime());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveStaleStatus: (snapshot: DshRuntimeSnapshot) => void = () => {};
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => {
      resolveStaleStatus = resolve as (snapshot: DshRuntimeSnapshot) => void;
    }));
    const staleRefresh = result.current.refresh();

    const runningSnapshot = {
      ...stoppedSnapshot,
      phase: "running" as const,
      url: "http://127.0.0.1:63244",
    };
    vi.mocked(invoke).mockResolvedValueOnce(runningSnapshot);
    await act(async () => {
      await result.current.start();
    });

    resolveStaleStatus(stoppedSnapshot);
    await act(async () => {
      await staleRefresh;
    });

    expect(result.current.snapshot).toEqual(runningSnapshot);
  });
});
