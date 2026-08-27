import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@research-copilot/types";
import { useCopilotSessions } from "../../../features/copilot/useCopilotSessions";

const {
  mockListSessions,
  mockSetSessionPinned,
  mockRenameSession,
  mockListInterests,
} = vi.hoisted(() => ({
  mockListSessions: vi.fn(),
  mockSetSessionPinned: vi.fn(),
  mockRenameSession: vi.fn(),
  mockListInterests: vi.fn(),
}));

vi.mock("../../../lib/client", () => ({
  apiClient: {
    chat: {
      listSessions: mockListSessions,
      setSessionPinned: mockSetSessionPinned,
      renameSession: mockRenameSession,
      updateSessionContext: vi.fn(),
      deleteSession: vi.fn(),
      getSession: vi.fn(),
    },
    knowledge: {
      listInterests: mockListInterests,
      deleteInterestBundle: vi.fn(),
      deleteInterestOnly: vi.fn(),
    },
    memory: { add: vi.fn() },
  },
  formatErrorMessage: (error: unknown) => String(error ?? ""),
}));

function makeSession(id: string, title: string, extra: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title,
    context_type: "general",
    created_at: "2026-08-26T00:00:00Z",
    updated_at: null,
    ...extra,
  };
}

describe("useCopilotSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessions.mockResolvedValue([makeSession("a", "会话甲"), makeSession("b", "会话乙")]);
    mockListInterests.mockResolvedValue([]);
    mockSetSessionPinned.mockImplementation((id: string, pinned: boolean) =>
      Promise.resolve(makeSession(id, id === "b" ? "会话乙" : "会话甲", { pinned })),
    );
    mockRenameSession.mockImplementation((id: string, title: string) =>
      Promise.resolve(makeSession(id, title)),
    );
  });

  async function renderLoaded() {
    const rendered = renderHook(() => useCopilotSessions());
    await waitFor(() => expect(rendered.result.current.sessionsLoaded).toBe(true));
    return rendered;
  }

  it("置顶写库成功后把会话移到列表前并保留 pinned 标记", async () => {
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handlePinSession("b");
    });

    expect(mockSetSessionPinned).toHaveBeenCalledWith("b", true);
    expect(result.current.sessions.map((s) => s.id)).toEqual(["b", "a"]);
    expect(result.current.sessions[0].pinned).toBe(true);
  });

  it("取消置顶写库成功后恢复普通排序标记", async () => {
    mockListSessions.mockResolvedValue([
      makeSession("b", "会话乙", { pinned: true }),
      makeSession("a", "会话甲"),
    ]);
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handlePinSession("b");
    });

    expect(mockSetSessionPinned).toHaveBeenCalledWith("b", false);
    expect(result.current.sessions.find((s) => s.id === "b")?.pinned).toBe(false);
  });

  it("置顶写库失败时回滚列表并提示错误", async () => {
    mockSetSessionPinned.mockRejectedValue(new Error("db locked"));
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.handlePinSession("b");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.current.sessions.find((s) => s.id === "b")?.pinned).toBeFalsy();
    expect(result.current.loadError).toContain("db locked");
  });

  it("重命名写库成功后更新标题", async () => {
    const { result } = await renderLoaded();

    act(() => result.current.startRename(makeSession("b", "会话乙")));
    act(() => result.current.setRenameTitle("  新标题  "));
    await act(async () => {
      await result.current.commitRename();
    });

    expect(mockRenameSession).toHaveBeenCalledWith("b", "新标题");
    expect(result.current.sessions.find((s) => s.id === "b")?.title).toBe("新标题");
    expect(result.current.renamingId).toBeNull();
  });

  it("重命名写库失败时回滚标题并提示错误", async () => {
    mockRenameSession.mockRejectedValue(new Error("db locked"));
    const { result } = await renderLoaded();

    act(() => result.current.startRename(makeSession("b", "会话乙")));
    act(() => result.current.setRenameTitle("新标题"));
    await act(async () => {
      await result.current.commitRename();
    });

    expect(result.current.sessions.find((s) => s.id === "b")?.title).toBe("会话乙");
    expect(result.current.loadError).toContain("db locked");
  });

  it("标题未变化或为空时不发请求", async () => {
    const { result } = await renderLoaded();

    act(() => result.current.startRename(makeSession("b", "会话乙")));
    act(() => result.current.setRenameTitle("会话乙"));
    await act(async () => {
      await result.current.commitRename();
    });
    expect(mockRenameSession).not.toHaveBeenCalled();

    act(() => result.current.startRename(makeSession("b", "会话乙")));
    act(() => result.current.setRenameTitle("   "));
    await act(async () => {
      await result.current.commitRename();
    });
    expect(mockRenameSession).not.toHaveBeenCalled();
  });
});
