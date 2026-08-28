import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../helpers/render";
import { mockInvoke, resetInvokeMock } from "../mocks/tauri";
import App from "../../App";

// Mock lazy-loaded pages to avoid Tauri dependency issues
vi.mock("../../pages/Home", () => ({
  default: () => <div data-testid="home-page">首页</div>,
}));
vi.mock("../../pages/Planner", () => ({
  default: () => <div data-testid="planner-page">规划</div>,
}));
vi.mock("../../pages/Survey", () => ({
  default: () => <div data-testid="survey-page">综述</div>,
}));
vi.mock("../../pages/Papers", () => ({
  default: () => <div data-testid="papers-page">论文</div>,
}));
vi.mock("../../pages/PaperReader", () => ({
  default: () => <div data-testid="paper-reader-page">论文阅读</div>,
}));
vi.mock("../../pages/Copilot", () => ({
  default: () => <div data-testid="copilot-page">对话</div>,
}));
vi.mock("../../pages/Knowledge", () => ({
  default: () => <div data-testid="knowledge-page">知识</div>,
}));
vi.mock("../../pages/Settings", () => ({
  default: () => <div data-testid="settings-page">设置</div>,
}));
vi.mock("../../pages/Tools", () => ({
  default: () => <div data-testid="tools-page">工具</div>,
}));
vi.mock("../../pages/Submission", () => ({
  default: () => <div data-testid="submission-page">投稿</div>,
}));
vi.mock("../../pages/Experiment", () => ({
  default: () => <div data-testid="experiment-page">实验</div>,
}));
vi.mock("../../pages/Writing", () => ({
  default: () => <div data-testid="writing-page">写作</div>,
}));
vi.mock("../../pages/ResearchTheme", () => ({
  default: () => <div data-testid="research-theme-page">研究主题</div>,
}));
vi.mock("../../pages/FocusLayout", () => ({
  default: () => <div data-testid="focus-layout">专注模式</div>,
}));

// Mock features
vi.mock("../../features/appLock/LockScreen", () => ({
  default: ({ onVerified }: { onVerified: () => void }) => (
    <div data-testid="lock-screen">
      锁屏
      <button onClick={onVerified}>解锁</button>
    </div>
  ),
}));
vi.mock("../../features/appLock/useAppLock", () => ({
  useAppLock: () => ({ locked: false, setLocked: vi.fn(), lockChecked: true }),
}));
vi.mock("../../features/onboarding/QuickStartDialog", () => ({
  default: () => null,
}));
vi.mock("../../features/onboarding/useFirstRunQuickStart", () => ({
  useFirstRunQuickStart: () => ({ open: false, steps: [], dismiss: vi.fn() }),
}));
vi.mock("../../features/knowledge/useInterestPlanRuns", () => ({
  useInterestPlanEventBridge: () => {},
}));
vi.mock("../../components/XiaoYanPet", () => ({
  default: () => <div data-testid="pet">宠物</div>,
}));
vi.mock("../../components/MacWindowDragStrip", () => ({
  default: () => <div data-testid="drag-strip" />,
}));
vi.mock("../../components/UpdateNotification", () => ({
  default: () => null,
}));
vi.mock("../../components/RouteErrorBoundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock hooks
vi.mock("../../hooks/useThemeInit", () => ({
  useThemeInit: () => {},
}));
vi.mock("../../hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: () => {},
}));
vi.mock("../../lib/useAutoUpdate", () => ({
  useAutoUpdate: () => ({ available: false, downloading: false, downloaded: false }),
}));
vi.mock("../../lib/layoutMode", () => ({
  getLayoutMode: () => "landscape",
  landscapePathForFocusPath: (p: string) => p,
  LAYOUT_MODE_CHANGE_EVENT: "layout-mode-change",
}));
vi.mock("../../lib/windowChrome", () => ({
  IS_MACOS_DESKTOP: false,
}));
vi.mock("../../hooks/usePersistentStringState", () => ({
  writePersistentValue: vi.fn(),
}));

describe("App 路由与导航", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInvokeMock();
    mockInvoke({
      "get_lock_status": { locked: false },
    });
  });

  it("应渲染侧边导航栏", async () => {
    renderWithRouter(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText("首页")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("DSH").querySelector(".deepseek-icon")).toBeInTheDocument();
  });

  it("应包含所有导航项", async () => {
    renderWithRouter(<App />);
    await waitFor(() => {
      const navLabels = ["首页", "规划", "对话", "综述", "论文", "写作", "知识", "DSH", "投稿", "工具", "设置"];
      for (const label of navLabels) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
    });
  });

  it("应默认显示首页", async () => {
    renderWithRouter(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });

  it("导航项应有正确的链接目标", async () => {
    renderWithRouter(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText("首页")).toHaveAttribute("href", "/");
      expect(screen.getByLabelText("规划")).toHaveAttribute("href", "/planner");
      expect(screen.getByLabelText("对话")).toHaveAttribute("href", "/chat");
      expect(screen.getByLabelText("综述")).toHaveAttribute("href", "/survey");
      expect(screen.getByLabelText("论文")).toHaveAttribute("href", "/papers");
      expect(screen.getByLabelText("写作")).toHaveAttribute("href", "/writing");
      expect(screen.getByLabelText("知识")).toHaveAttribute("href", "/knowledge");
      expect(screen.getByLabelText("DSH")).toHaveAttribute("href", "/code");
      expect(screen.getByLabelText("投稿")).toHaveAttribute("href", "/submission");
      expect(screen.getByLabelText("工具")).toHaveAttribute("href", "/tools");
      expect(screen.getByLabelText("设置")).toHaveAttribute("href", "/settings");
    });
  });

  it("代码助手切换为 Codex 后侧栏显示 Codex", async () => {
    window.localStorage.setItem("rc:code-harness-provider", "codex");
    renderWithRouter(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText("Codex")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Codex")).toHaveAttribute("href", "/codex");
    expect(screen.getByLabelText("Codex").querySelector(".codex-icon")).toBeInTheDocument();
    expect(screen.queryByLabelText("DSH")).not.toBeInTheDocument();
  });

  it("代码助手切换为 OpenCode 后侧栏显示 OpenCode", async () => {
    window.localStorage.setItem("rc:code-harness-provider", "opencode");
    renderWithRouter(<App />);
    await waitFor(() => expect(screen.getByLabelText("OpenCode")).toBeInTheDocument());
    expect(screen.getByLabelText("OpenCode")).toHaveAttribute("href", "/opencode");
    expect(screen.getByLabelText("OpenCode").querySelector(".opencode-icon")).toBeInTheDocument();
    expect(screen.queryByLabelText("DSH")).not.toBeInTheDocument();
  });

  it("代码助手切换为 Pi 后侧栏显示 Pi", async () => {
    window.localStorage.setItem("rc:code-harness-provider", "pi");
    renderWithRouter(<App />);
    await waitFor(() => expect(screen.getByLabelText("Pi")).toBeInTheDocument());
    expect(screen.getByLabelText("Pi")).toHaveAttribute("href", "/pi");
    expect(screen.getByLabelText("Pi").querySelector(".pi-web-icon")).toBeInTheDocument();
    expect(screen.queryByLabelText("DSH")).not.toBeInTheDocument();
  });
});
