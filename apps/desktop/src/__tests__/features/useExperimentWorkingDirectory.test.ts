import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useExperimentWorkingDirectory } from "../../features/experiment/useExperimentWorkingDirectory";
import { getInvokeMock, resetInvokeMock } from "../mocks/tauri";

describe("useExperimentWorkingDirectory", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInvokeMock();
    getInvokeMock().mockResolvedValue(undefined);
  });

  it("按实验分别保存工作目录", async () => {
    const { result, rerender } = renderHook(
      ({ experimentId }) => useExperimentWorkingDirectory(experimentId, null),
      { initialProps: { experimentId: "experiment-1" } },
    );

    act(() => result.current[1]("/project/one"));
    expect(result.current[0]).toBe("/project/one");
    expect(getInvokeMock()).toHaveBeenCalledWith("experiment_update", {
      id: "experiment-1",
      defaultWorkingDir: "/project/one",
    });

    rerender({ experimentId: "experiment-2" });
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("/project/two"));

    rerender({ experimentId: "experiment-1" });
    expect(result.current[0]).toBe("/project/one");
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("rc:experiment:code:working-dirs") ?? "{}"))
        .toEqual({ "experiment-1": "/project/one", "experiment-2": "/project/two" });
    });
  });

  it("迁移旧版按实验保存的目录", async () => {
    localStorage.setItem("rc:experiment:experiment-1:code:working-dir", JSON.stringify("/legacy/project"));
    const { result } = renderHook(() => useExperimentWorkingDirectory("experiment-1", null));

    await waitFor(() => expect(result.current[0]).toBe("/legacy/project"));
  });
});
