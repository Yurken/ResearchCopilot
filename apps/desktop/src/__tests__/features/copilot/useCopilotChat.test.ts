import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamChunk, Skill } from "@research-copilot/types";
import { useCopilotChat } from "../../../features/copilot/useCopilotChat";
import { ToolSkillNotImplementedError } from "../../../features/tools/registry/executeToolSkill";

const { mockStream, mockMemoryAdd, mockEnsureSession, mockSaveMessage, mockTruncateSession } = vi.hoisted(() => ({
  mockStream: vi.fn(),
  mockMemoryAdd: vi.fn(),
  mockEnsureSession: vi.fn(),
  mockSaveMessage: vi.fn(),
  mockTruncateSession: vi.fn(),
}));

const { mockExecuteToolSkill } = vi.hoisted(() => ({
  mockExecuteToolSkill: vi.fn(),
}));

vi.mock("../../../lib/client", () => ({
  apiClient: {
    chat: {
      stream: mockStream,
      ensureSession: mockEnsureSession,
      saveMessage: mockSaveMessage,
      truncateSession: mockTruncateSession,
    },
    memory: { add: mockMemoryAdd },
    settings: { get: vi.fn() },
  },
  formatErrorMessage: (error: unknown) => String(error ?? ""),
}));

vi.mock("../../../features/tools/registry/executeToolSkill", () => ({
  executeToolSkill: mockExecuteToolSkill,
  ToolSkillNotImplementedError: class ToolSkillNotImplementedError extends Error {
    toolName: string;
    constructor(name: string) {
      super(`工具技能“${name}”尚未实现`);
      this.toolName = name;
    }
  },
}));

function createStreamThatStallsAfterDone() {
  const chunks: ChatStreamChunk[] = [
    { type: "request_id", value: "request-1" },
    { type: "done" },
  ];
  let index = 0;
  const iterator: AsyncIterableIterator<ChatStreamChunk> = {
    next: vi.fn(() => {
      const chunk = chunks[index++];
      return chunk
        ? Promise.resolve({ value: chunk, done: false })
        : new Promise<IteratorResult<ChatStreamChunk>>(() => undefined);
    }),
    return: vi.fn((): Promise<IteratorResult<ChatStreamChunk>> => (
      Promise.resolve({ value: undefined, done: true })
    )),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return iterator;
}

/** 先吐一个 delta，之后一直挂起，直到调用方 abort signal 才结束（模拟真实流桥在取消时收尾）。 */
function createInterruptibleStream(chunks: ChatStreamChunk[]) {
  return (_body: unknown, signal?: AbortSignal): AsyncIterableIterator<ChatStreamChunk> => {
    let index = 0;
    return {
      next: () => {
        const chunk = chunks[index++];
        if (chunk) return Promise.resolve({ value: chunk, done: false });
        return new Promise<IteratorResult<ChatStreamChunk>>((resolve) => {
          if (signal?.aborted) {
            resolve({ value: undefined, done: true });
            return;
          }
          signal?.addEventListener("abort", () => resolve({ value: undefined, done: true }), {
            once: true,
          });
        });
      },
      return: () => Promise.resolve({ value: undefined, done: true }),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

const pptSkill: Skill = {
  id: "ppt",
  name: "ppt-generate",
  title: "AI 幻灯片生成",
  description: "",
  prompt: "",
  tags: [],
  kind: "tool",
  is_builtin: true,
  is_enabled: true,
  created_at: "",
  updated_at: "",
};

const promptSkill: Skill = {
  id: "polish",
  name: "polish",
  title: "学术文稿精修",
  description: "",
  prompt: "润色以下文本：",
  tags: [],
  kind: "prompt",
  is_builtin: true,
  is_enabled: true,
  created_at: "",
  updated_at: "",
};

describe("useCopilotChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryAdd.mockResolvedValue(undefined);
    mockStream.mockImplementation(() => createStreamThatStallsAfterDone());
    mockEnsureSession.mockResolvedValue({ id: "session-1", title: "测试", context_type: "general" });
    mockSaveMessage.mockImplementation((input: { role: string }) =>
      Promise.resolve({ id: `db-${input.role}-1` }),
    );
    mockTruncateSession.mockResolvedValue({ removed: 1 });
  });

  it("收到完成事件后立即恢复发送按钮，不等待流桥收尾", async () => {
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => {
      result.current.setInput("测试完成状态");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => {
      expect(result.current.sending).toBe(false);
    });
    expect(mockStream.mock.results[0]?.value.return).toHaveBeenCalledTimes(1);
  });

  it("prompt 技能仍走普通聊天流", async () => {
    const clearAttachments = vi.fn();
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [promptSkill],
      selectedSkillId: promptSkill.id,
      attachments: [],
      clearAttachments,
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("帮我润色这段话"));
    await act(async () => {
      await result.current.handleSend();
    });

    expect(mockStream).toHaveBeenCalled();
    expect(mockExecuteToolSkill).not.toHaveBeenCalled();
    expect(clearAttachments).toHaveBeenCalled();
  });

  it("tool 技能调用 Tool Registry 而不走普通聊天流", async () => {
    const clearAttachments = vi.fn();
    const onSessionCreated = vi.fn();
    mockExecuteToolSkill.mockResolvedValue({
      content: "已生成 12 页 PPT",
      artifacts: [{
        id: "art-1",
        kind: "pptx",
        name: "slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        localPath: "/tmp/art-1/slides.pptx",
        size: 1024,
        createdAt: "2026-01-01T00:00:00Z",
      }],
    });

    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [pptSkill],
      selectedSkillId: pptSkill.id,
      attachments: [],
      clearAttachments,
      onSessionCreated,
    }));

    act(() => result.current.setInput("生成一份 Graph RAG 的 PPT"));
    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => expect(result.current.sending).toBe(false));

    expect(mockExecuteToolSkill).toHaveBeenCalledWith(
      "ppt-generate",
      expect.objectContaining({ userMessage: "生成一份 Graph RAG 的 PPT" }),
    );
    expect(mockStream).not.toHaveBeenCalled();
    expect(clearAttachments).toHaveBeenCalled();
    expect(mockEnsureSession).toHaveBeenCalled();
    expect(mockSaveMessage).toHaveBeenCalledTimes(2);

    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content).toBe("已生成 12 页 PPT");
    expect(assistantMsg?.artifacts).toHaveLength(1);
  });

  it("未实现的 tool 技能在助手消息中显示明确错误", async () => {
    mockExecuteToolSkill.mockRejectedValue(new ToolSkillNotImplementedError("unknown"));

    const unknownSkill: Skill = { ...pptSkill, id: "unknown", name: "unknown", kind: "tool" };
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [unknownSkill],
      selectedSkillId: unknownSkill.id,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("测试"));
    await act(async () => {
      await result.current.handleSend();
    });

    await waitFor(() => expect(result.current.sending).toBe(false));
    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toContain("该工具技能尚未实现");
  });

  it("发送阅读页交接消息时保留 paper 上下文", async () => {
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      contextType: "paper",
      contextId: "paper-1",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("解释第 3 页"));
    await act(async () => result.current.handleSend());

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ context_type: "paper", context_id: "paper-1" }),
      expect.any(AbortSignal),
    );
  });

  it("发送时用户消息使用稳定 id 并传给后端作为落库主键", async () => {
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("你好"));
    await act(async () => result.current.handleSend());

    await waitFor(() => expect(result.current.sending).toBe(false));
    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg?.id).toBeTruthy();
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ user_message_id: userMsg?.id }),
      expect.any(AbortSignal),
    );
  });

  it("重试先截断 DB 会话再重发，且复用同一用户消息 id", async () => {
    const currentSession = {
      id: "s1",
      title: "会话",
      context_type: "general",
      created_at: "2026-08-26T00:00:00Z",
      updated_at: null,
    };
    const { result } = renderHook(() => useCopilotChat({
      currentSession,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("原始问题"));
    await act(async () => result.current.handleSend());
    await waitFor(() => expect(result.current.sending).toBe(false));

    const userMsg = result.current.messages.find((m) => m.role === "user");
    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(userMsg && assistantMsg).toBeTruthy();

    act(() => result.current.retry(assistantMsg!.id));

    await waitFor(() => {
      expect(mockTruncateSession).toHaveBeenCalledWith("s1", userMsg!.id);
    });
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(2));
    expect(mockStream).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "原始问题", user_message_id: userMsg!.id }),
      expect.any(AbortSignal),
    );
    // UI 列表依旧只有一轮（用户消息 + 新助手占位），不产生重复消息。
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(result.current.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("编辑重发先截断 DB 再用新文本重发", async () => {
    const currentSession = {
      id: "s1",
      title: "会话",
      context_type: "general",
      created_at: "2026-08-26T00:00:00Z",
      updated_at: null,
    };
    const { result } = renderHook(() => useCopilotChat({
      currentSession,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("原始问题"));
    await act(async () => result.current.handleSend());
    await waitFor(() => expect(result.current.sending).toBe(false));

    const userMsg = result.current.messages.find((m) => m.role === "user");
    act(() => result.current.editAndResend(userMsg!.id, "改成这个问题"));

    await waitFor(() => {
      expect(mockTruncateSession).toHaveBeenCalledWith("s1", userMsg!.id);
    });
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(2));
    expect(mockStream).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "改成这个问题", user_message_id: userMsg!.id }),
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(result.current.messages.find((m) => m.role === "user")?.content).toBe("改成这个问题");
  });

  it("截断 DB 失败时中止重发并提示错误", async () => {
    mockTruncateSession.mockRejectedValue(new Error("db locked"));
    const currentSession = {
      id: "s1",
      title: "会话",
      context_type: "general",
      created_at: "2026-08-26T00:00:00Z",
      updated_at: null,
    };
    const { result } = renderHook(() => useCopilotChat({
      currentSession,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("原始问题"));
    await act(async () => result.current.handleSend());
    await waitFor(() => expect(result.current.sending).toBe(false));

    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    act(() => result.current.retry(assistantMsg!.id));

    await waitFor(() => expect(result.current.loadError).toContain("重发前清理旧消息失败"));
    // 重发被中止：不会再发起第二次流式请求，避免 DB 再次分叉。
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("用户终止后助手消息保留部分内容并标记 interrupted", async () => {
    mockStream.mockImplementation(
      createInterruptibleStream([
        { type: "request_id", value: "request-1" },
        { type: "delta", value: "部分回答" },
      ]),
    );
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("写一篇长文"));
    await act(async () => {
      void result.current.handleSend();
    });
    await waitFor(() => expect(result.current.sending).toBe(true));

    act(() => result.current.stopGenerating());

    await waitFor(() => expect(result.current.sending).toBe(false));
    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.status).toBe("interrupted");
    expect(assistantMsg?.content).toContain("部分回答");
  });

  it("模型错误路径将助手消息标记为 failed", async () => {
    mockStream.mockImplementation(
      createInterruptibleStream([
        { type: "request_id", value: "request-1" },
        { type: "error", value: "模型服务不可用" },
      ]),
    );
    const { result } = renderHook(() => useCopilotChat({
      currentSession: null,
      selectedInterestId: "",
      chatMode: "direct",
      skills: [],
      selectedSkillId: null,
      attachments: [],
      clearAttachments: vi.fn(),
      onSessionCreated: vi.fn(),
    }));

    act(() => result.current.setInput("你好"));
    await act(async () => result.current.handleSend());

    await waitFor(() => expect(result.current.sending).toBe(false));
    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.status).toBe("failed");
    expect(assistantMsg?.content).toBe("模型服务不可用");
  });
});
