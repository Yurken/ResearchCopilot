import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useCodexRuntime } from "../../features/codex/useCodexRuntime";
import type { CodexRuntimeSnapshot } from "../../features/codex/shared";

const stoppedSnapshot: CodexRuntimeSnapshot = {
  phase: "stopped",
  config: {
    mode: "path",
    externalExecutable: null,
    externalHome: null,
    workspaceDir: null,
  },
  url: null,
  error: null,
  logs: [],
  pathAvailable: true,
  pathExecutable: "/usr/local/bin/codex",
  source: "https://github.com/openai/codex",
  dataHome: "/tmp/xiaoyan/codex/home",
};

describe("useCodexRuntime", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(stoppedSnapshot);
  });

  it("does not let an older status response overwrite a newer start result", async () => {
    const { result } = renderHook(() => useCodexRuntime());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveStaleStatus: (snapshot: CodexRuntimeSnapshot) => void = () => {};
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => {
      resolveStaleStatus = resolve as (snapshot: CodexRuntimeSnapshot) => void;
    }));
    const staleRefresh = result.current.refresh();

    const runningSnapshot = {
      ...stoppedSnapshot,
      phase: "running" as const,
      url: "ws://127.0.0.1:4500",
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
