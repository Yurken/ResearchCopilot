import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithRouter } from "../helpers/render";
import { getInvokeMock, resetInvokeMock } from "../mocks/tauri";
import Copilot from "../../pages/Copilot";

// 共享 setup 的 @tauri-apps/api/event mock 缺少 TauriEvent 导出，
// 而拖拽区 hook(useCopilotDropZone -> safeOnDragDrop) 在挂载时会引用它。
// 在测试文件内补齐该 mock，避免未处理的拒绝。
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
  once: vi.fn(),
  TauriEvent: {
    DRAG_ENTER: "tauri://drag-enter",
    DRAG_OVER: "tauri://drag-over",
    DRAG_DROP: "tauri://drag-drop",
    DRAG_LEAVE: "tauri://drag-leave",
  },
}));

// Copilot 页面挂载时各 hook 会通过 apiClient(底层 invoke) 拉取会话/兴趣/技能。
// 这里按命令返回正确形状的默认值，避免 hook 内 undefined.then 报错。
function mockCopilotInvoke() {
  getInvokeMock().mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "chat_list_sessions":
        return [];
      case "knowledge_list_interests":
        return [];
      case "skills_list":
        return [];
      case "chat_get_session":
        return {
          id: typeof args?.id === "string" ? args.id : "assistant-session-1",
          title: "桌面助手会话",
          context_type: "general",
          context_id: null,
          messages: [],
        };
      case "chat_list_agent_runs":
        return [];
      default:
        return undefined;
    }
  });
}

// Mock copilot components
vi.mock("../../features/copilot/CopilotSessionSidebar", () => ({
  CopilotSessionSidebar: () => <div data-testid="session-sidebar">会话侧边栏</div>,
}));

vi.mock("../../features/copilot/CopilotChatArea", () => ({
  CopilotChatArea: () => <div data-testid="chat-area">对话区域</div>,
}));

vi.mock("../../features/copilot/CopilotComposer", () => ({
  default: ({ input }: { input: string }) => <div data-testid="composer">{input || "消息输入"}</div>,
}));

vi.mock("../../features/copilot/CopilotOverviewSidebar", () => ({
  default: () => <div data-testid="overview-sidebar">概览</div>,
}));

vi.mock("../../features/copilot/SkillVariableFillModal", () => ({
  default: () => null,
}));

vi.mock("../../features/copilot/shared", () => ({
  parseCopilotMessageContent: (text: string) => text,
}));

describe("Copilot 页面", () => {
  beforeEach(() => {
    resetInvokeMock();
    mockCopilotInvoke();
    localStorage.clear();
  });

  it("应渲染对话界面", () => {
    renderWithRouter(<Copilot />);
    expect(screen.getByTestId("chat-area")).toBeInTheDocument();
  });

  it("应显示消息输入组件", () => {
    renderWithRouter(<Copilot />);
    expect(screen.getByTestId("composer")).toBeInTheDocument();
  });

  it("应显示会话侧边栏", () => {
    renderWithRouter(<Copilot />);
    expect(screen.getByTestId("session-sidebar")).toBeInTheDocument();
  });

  it("应恢复 checkpoint 原会话并预填可编辑的续接请求", async () => {
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: "/chat",
          state: {
            researchCheckpointHandoff: {
              kind: "research_checkpoint",
              version: 1,
              id: "checkpoint-1",
              sessionId: "checkpoint-session-1",
              contextType: "interest",
              contextId: "interest-1",
              goal: "完成证据检索方案",
              summary: "已确定混合检索基线。",
              completedItems: ["整理代表论文"],
              openQuestions: ["如何评测路径质量？"],
              nextSteps: ["定义离线评测指标"],
              status: "completed",
              updatedAt: "2026-08-06T00:00:00Z",
            },
          },
        }]}
      >
        <Copilot />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getInvokeMock()).toHaveBeenCalledWith("chat_get_session", {
        id: "checkpoint-session-1",
      });
    });
    expect(await screen.findByTestId("checkpoint-context-bar")).toHaveTextContent("从 checkpoint 续接");
    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("定义离线评测指标");
    });

    fireEvent.click(screen.getByRole("button", { name: "移除 checkpoint 续接上下文" }));
    expect(screen.queryByTestId("checkpoint-context-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer")).toHaveTextContent("消息输入");
  });

  it("来源会话不存在时仍保留 checkpoint 并退化为新会话", async () => {
    getInvokeMock().mockImplementation(async (cmd: string) => {
      if (cmd === "chat_get_session") throw new Error("session missing");
      if (cmd === "chat_list_sessions" || cmd === "knowledge_list_interests" || cmd === "skills_list") return [];
      return undefined;
    });

    render(
      <MemoryRouter
        initialEntries={[{
          pathname: "/chat",
          state: {
            researchCheckpointHandoff: {
              kind: "research_checkpoint",
              version: 1,
              id: "checkpoint-fallback",
              sessionId: "missing-session",
              contextType: "interest",
              contextId: "interest-1",
              goal: "恢复未完成研究",
              summary: "来源会话已被删除。",
              completedItems: [],
              openQuestions: ["下一步是什么？"],
              nextSteps: ["重建任务上下文"],
              status: "completed",
              updatedAt: "2026-08-06T00:00:00Z",
            },
          },
        }]}
      >
        <Copilot />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("重建任务上下文");
    });
    expect(screen.getByTestId("checkpoint-context-bar")).toHaveTextContent("恢复未完成研究");
  });
});
