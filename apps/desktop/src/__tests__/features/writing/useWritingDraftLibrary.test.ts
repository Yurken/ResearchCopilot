import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWritingDraftLibrary } from "../../../features/writing/useWritingDraftLibrary";
import {
  WRITING_LIBRARY_STORAGE_KEY,
  type WritingDraft,
} from "../../../features/writing/shared";
import { WRITING_LIBRARY_MIGRATED_KEY } from "../../../features/writing/legacyDraftLibrary";
import { getInvokeMock, resetInvokeMock } from "../../mocks/tauri";

function backendDraft(id: string, projectName: string): WritingDraft {
  return {
    id,
    projectName,
    templateId: "journal",
    mainTex: `\\section{${projectName}}`,
    bibtex: "",
    texFiles: [],
    notes: "",
    imageAssets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mockBackend(drafts: WritingDraft[]) {
  getInvokeMock().mockImplementation(async (command: string, args?: { request?: WritingDraft }) => {
    if (command === "knowledge_list_interests") return [];
    if (command === "writing_draft_list") return drafts;
    if (command === "writing_draft_create") return args?.request;
    if (command === "writing_draft_update" || command === "writing_draft_delete") return undefined;
    throw new Error(`Unmocked invoke: ${command}`);
  });
}

describe("useWritingDraftLibrary", () => {
  beforeEach(() => {
    resetInvokeMock();
    localStorage.clear();
  });

  it("后端模式：草稿从后端加载，编辑防抖后回写 update 命令", async () => {
    mockBackend([backendDraft("d1", "论文一"), backendDraft("d2", "论文二")]);
    const { result } = renderHook(() => useWritingDraftLibrary());

    await waitFor(() => expect(result.current.libraryReady).toBe(true));
    expect(result.current.drafts.map((draft) => draft.id)).toEqual(["d1", "d2"]);
    expect(result.current.activeDraftId).toBe("d1");
    // 与后端一致的内容不触发回写。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(getInvokeMock()).not.toHaveBeenCalledWith("writing_draft_update", expect.anything());

    act(() => {
      result.current.updateActiveDraft({ mainTex: "\\section{新内容}" });
    });
    await waitFor(() => {
      expect(getInvokeMock()).toHaveBeenCalledWith("writing_draft_update", {
        request: expect.objectContaining({ id: "d1", mainTex: "\\section{新内容}" }),
      });
    });
  });

  it("后端模式：新建与删除草稿走后端命令", async () => {
    mockBackend([backendDraft("d1", "论文一"), backendDraft("d2", "论文二")]);
    const { result } = renderHook(() => useWritingDraftLibrary());
    await waitFor(() => expect(result.current.libraryReady).toBe(true));

    let created: WritingDraft | undefined;
    act(() => {
      created = result.current.createDraft();
    });
    expect(created?.id).toBeTruthy();
    await waitFor(() => {
      expect(getInvokeMock()).toHaveBeenCalledWith("writing_draft_create", {
        request: expect.objectContaining({ id: created?.id }),
      });
    });

    act(() => {
      expect(result.current.deleteDraft("d2")).toBe(true);
    });
    await waitFor(() => {
      expect(getInvokeMock()).toHaveBeenCalledWith("writing_draft_delete", { id: "d2" });
    });
  });

  it("检测到旧 localStorage 草稿库时一次性导入后端并写迁移标记", async () => {
    localStorage.setItem(
      WRITING_LIBRARY_STORAGE_KEY,
      JSON.stringify({ drafts: [backendDraft("legacy-1", "旧论文")] }),
    );
    mockBackend([]);
    const { result } = renderHook(() => useWritingDraftLibrary());

    await waitFor(() => expect(result.current.libraryReady).toBe(true));
    await waitFor(() => {
      expect(getInvokeMock()).toHaveBeenCalledWith("writing_draft_create", {
        request: expect.objectContaining({ id: "legacy-1", projectName: "旧论文" }),
      });
    });
    expect(localStorage.getItem(WRITING_LIBRARY_MIGRATED_KEY)).toBeTruthy();
    expect(result.current.migrationSummary?.imported).toBe(1);

    // 再次启动（已有标记）不重复导入。
    resetInvokeMock();
    mockBackend([backendDraft("legacy-1", "旧论文")]);
    const { result: second } = renderHook(() => useWritingDraftLibrary());
    await waitFor(() => expect(second.current.libraryReady).toBe(true));
    expect(getInvokeMock()).not.toHaveBeenCalledWith("writing_draft_create", expect.anything());
  });

  it("非 Tauri 环境降级为 localStorage 读写", async () => {
    localStorage.setItem(
      WRITING_LIBRARY_STORAGE_KEY,
      JSON.stringify({ drafts: [backendDraft("local-1", "本地草稿")] }),
    );
    getInvokeMock().mockImplementation(async () => {
      throw new Error("Cannot read properties of undefined (reading 'invoke')");
    });
    const { result } = renderHook(() => useWritingDraftLibrary());

    await waitFor(() => expect(result.current.libraryReady).toBe(true));
    expect(result.current.drafts.map((draft) => draft.id)).toEqual(["local-1"]);

    act(() => {
      result.current.updateActiveDraft({ notes: "降级便签" });
    });
    await waitFor(() => {
      const raw = localStorage.getItem(WRITING_LIBRARY_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw ?? "{}").drafts[0].notes).toBe("降级便签");
    });
    expect(getInvokeMock()).not.toHaveBeenCalledWith("writing_draft_update", expect.anything());
  });
});
