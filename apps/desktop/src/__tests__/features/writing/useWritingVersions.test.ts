import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWritingVersions } from "../../../features/writing/useWritingVersions";
import { getInvokeMock, resetInvokeMock } from "../../mocks/tauri";

function draftOptions(overrides: Record<string, unknown> = {}) {
  return {
    draftId: "draft-1",
    mainTex: "\\section{Intro}",
    bibtex: "",
    texFiles: [{ path: "sections/intro.tex", content: "intro" }],
    notes: "",
    onApplyVersion: vi.fn(),
    ...overrides,
  };
}

const snapshot = {
  id: "version-1",
  draftId: "draft-1",
  source: "manual",
  createdAt: "2026-08-27 10:00:00",
  mainTex: "\\section{Old}",
  bibtex: "@article{a}",
  texFiles: [],
  notes: "旧便签",
};

describe("useWritingVersions", () => {
  beforeEach(() => resetInvokeMock());
  afterEach(() => vi.useRealTimers());

  it("内容变化防抖后自动记录 auto 版本，内容未变不重复调用", async () => {
    vi.useFakeTimers();
    getInvokeMock().mockImplementation(async (command: string) => {
      if (command === "writing_record_version") {
        return { recorded: true, versionId: "v-1", reason: null };
      }
      throw new Error(`Unmocked invoke: ${command}`);
    });

    const { rerender } = renderHook((props) => useWritingVersions(props as never), {
      initialProps: draftOptions(),
    });

    // 防抖窗口内不触发。
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(getInvokeMock()).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(getInvokeMock()).toHaveBeenCalledTimes(1);
    expect(getInvokeMock()).toHaveBeenCalledWith("writing_record_version", {
      request: expect.objectContaining({ draftId: "draft-1", source: "auto" }),
    });

    // 内容未变化时不再次发起 invoke。
    rerender(draftOptions());
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getInvokeMock()).toHaveBeenCalledTimes(1);

    // 内容变化但在 60s 最小间隔内，延后到间隔结束才记录。
    rerender(draftOptions({ mainTex: "\\section{Intro} 新内容" }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getInvokeMock()).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(getInvokeMock()).toHaveBeenCalledTimes(2);
    expect(getInvokeMock()).toHaveBeenLastCalledWith("writing_record_version", {
      request: expect.objectContaining({ mainTex: "\\section{Intro} 新内容", source: "auto" }),
    });
  });

  it("恢复版本前先把当前内容强制记录为 auto 版本，再应用快照", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    getInvokeMock().mockImplementation(async (command: string, args?: unknown) => {
      calls.push({ command, args });
      if (command === "writing_record_version") {
        return { recorded: true, versionId: "v-backup", reason: null };
      }
      if (command === "writing_get_version") return snapshot;
      if (command === "writing_list_versions") return [];
      throw new Error(`Unmocked invoke: ${command}`);
    });

    const onApplyVersion = vi.fn();
    const { result } = renderHook(() =>
      useWritingVersions({ ...draftOptions(), onApplyVersion }),
    );

    let restored = false;
    await act(async () => {
      restored = await result.current.restoreVersion("version-1");
    });

    expect(restored).toBe(true);
    expect(calls.map((call) => call.command)).toEqual([
      "writing_record_version",
      "writing_get_version",
      "writing_list_versions",
    ]);
    expect(calls[0].args).toEqual({
      request: expect.objectContaining({ draftId: "draft-1", source: "auto", force: true }),
    });
    expect(onApplyVersion).toHaveBeenCalledWith({
      mainTex: snapshot.mainTex,
      bibtex: snapshot.bibtex,
      texFiles: snapshot.texFiles,
      notes: snapshot.notes,
    });
  });

  it("恢复前备份失败时不应用快照", async () => {
    getInvokeMock().mockImplementation(async (command: string) => {
      if (command === "writing_record_version") throw new Error("disk full");
      throw new Error(`Unmocked invoke: ${command}`);
    });
    const onApplyVersion = vi.fn();
    const { result } = renderHook(() =>
      useWritingVersions({ ...draftOptions(), onApplyVersion }),
    );

    let restored = true;
    await act(async () => {
      restored = await result.current.restoreVersion("version-1");
    });

    expect(restored).toBe(false);
    expect(onApplyVersion).not.toHaveBeenCalled();
    expect(result.current.error).toContain("恢复前备份当前内容失败");
  });

  it("删除单个版本与删除草稿时清空版本", async () => {
    getInvokeMock().mockImplementation(async (command: string) => {
      if (command === "writing_delete_version" || command === "writing_clear_draft_versions") {
        return undefined;
      }
      throw new Error(`Unmocked invoke: ${command}`);
    });

    const { result } = renderHook(() => useWritingVersions(draftOptions() as never));

    await act(async () => {
      expect(await result.current.deleteVersion("version-1")).toBe(true);
    });
    expect(getInvokeMock()).toHaveBeenCalledWith("writing_delete_version", { id: "version-1" });

    await act(async () => {
      await result.current.clearDraftVersions("draft-1");
    });
    expect(getInvokeMock()).toHaveBeenCalledWith("writing_clear_draft_versions", { draftId: "draft-1" });
  });
});
