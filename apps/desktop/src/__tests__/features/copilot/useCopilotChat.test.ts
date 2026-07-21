import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamChunk, Skill } from "@research-copilot/types";
import { useCopilotChat } from "../../../features/copilot/useCopilotChat";
import { ToolSkillNotImplementedError } from "../../../features/tools/registry/executeToolSkill";

const { mockStream, mockMemoryAdd, mockEnsureSession, mockSaveMessage } = vi.hoisted(() => ({
  mockStream: vi.fn(),
  mockMemoryAdd: vi.fn(),
  mockEnsureSession: vi.fn(),
  mockSaveMessage: vi.fn(),
}));

const { mockExecuteToolSkill } = vi.hoisted(() => ({
  mockExecuteToolSkill: vi.fn(),
}));

vi.mock("../../../lib/client", () => ({
  apiClient: {
    chat: { stream: mockStream, ensureSession: mockEnsureSession, saveMessage: mockSaveMessage },
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
    mockStream.mockReturnValue(createStreamThatStallsAfterDone());
    mockEnsureSession.mockResolvedValue({ id: "session-1", title: "测试", context_type: "general" });
    mockSaveMessage.mockResolvedValue({});
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
});
