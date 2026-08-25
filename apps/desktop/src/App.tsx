import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Library,
  Map,
  MessageSquare,
  PenLine,
  Send,
  Settings as SettingsIcon,
  Wrench,
} from "lucide-react";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { useCodeHarnessProvider } from "./features/code-harness/useCodeHarnessProvider";
import { CODE_HARNESS_LABELS, CODE_HARNESS_PATHS, type CodeHarnessProvider } from "./features/code-harness/shared";
import CodexIcon from "./features/codex/CodexIcon";
import DeepSeekIcon from "./features/deepseek-harness/DeepSeekIcon";
import OpenCodeIcon from "./features/opencode/OpenCodeIcon";

const Home = lazy(() => import("./pages/Home"));
const Planner = lazy(() => import("./pages/Planner"));
const Survey = lazy(() => import("./pages/Survey"));
const Papers = lazy(() => import("./pages/Papers"));
const PaperReader = lazy(() => import("./pages/PaperReader"));
const NoteReader = lazy(() => import("./pages/NoteReader"));
const Copilot = lazy(() => import("./pages/Copilot"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const Settings = lazy(() => import("./pages/Settings"));
const Tools = lazy(() => import("./pages/Tools"));
const Submission = lazy(() => import("./pages/Submission"));
const Code = lazy(() => import("./pages/Code"));
const Codex = lazy(() => import("./pages/Codex"));
const OpenCode = lazy(() => import("./pages/OpenCode"));
const Writing = lazy(() => import("./pages/Writing"));
const ResearchTheme = lazy(() => import("./pages/ResearchTheme"));
const FocusApp = lazy(() => import("./pages/FocusLayout"));
import LockScreen from "./features/appLock/LockScreen";
import { useAppLock } from "./features/appLock/useAppLock";
import { apiClient } from "./lib/client";
import {
  getLayoutMode,
  landscapePathForFocusPath,
  LAYOUT_MODE_CHANGE_EVENT,
  type LayoutMode,
} from "./lib/layoutMode";
import { useThemeInit } from "./hooks/useThemeInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAutoUpdate } from "./lib/useAutoUpdate";
import { IS_MACOS_DESKTOP } from "./lib/windowChrome";
import MacWindowDragStrip from "./components/MacWindowDragStrip";
import UpdateNotification from "./components/UpdateNotification";
import XiaoYanPet from "./components/XiaoYanPet";
import { useInterestPlanEventBridge } from "./features/knowledge/useInterestPlanRuns";
import QuickStartDialog from "./features/onboarding/QuickStartDialog";
import { useFirstRunQuickStart } from "./features/onboarding/useFirstRunQuickStart";
import { SETTINGS_ACTIVE_SECTION_STORAGE_KEY } from "./features/settings/pageConfig";
import { writePersistentValue } from "./hooks/usePersistentStringState";

function buildNavItems(provider: CodeHarnessProvider) {
  const icons = { dsh: DeepSeekIcon, codex: CodexIcon, opencode: OpenCodeIcon };
  const codeItem = { to: CODE_HARNESS_PATHS[provider], icon: icons[provider], label: CODE_HARNESS_LABELS[provider] };

  return [
    { to: "/", icon: LayoutDashboard, label: "首页" },
    { to: "/planner", icon: Map, label: "规划" },
    { to: "/chat", icon: MessageSquare, label: "对话" },
    { to: "/survey", icon: BookOpen, label: "综述" },
    { to: "/papers", icon: FileText, label: "论文" },
    { to: "/writing", icon: PenLine, label: "写作" },
    { to: "/knowledge", icon: Library, label: "知识" },
    codeItem,
    { to: "/submission", icon: Send, label: "投稿" },
    { to: "/tools", icon: Wrench, label: "工具" },
    { to: "/settings", icon: SettingsIcon, label: "设置" },
  ];
}

function LandscapeFocusRouteRedirect() {
  const location = useLocation();
  return <Navigate to={landscapePathForFocusPath(location.pathname)} replace />;
}

export default function App() {
  const autoUpdate = useAutoUpdate();
  useInterestPlanEventBridge();
  useThemeInit();
  useKeyboardShortcuts();
  const location = useLocation();
  const navigate = useNavigate();
  const [layoutMode, setCurrentLayoutMode] = useState<LayoutMode>(() => getLayoutMode());
  const { provider: codeHarness } = useCodeHarnessProvider();
  const navItems = buildNavItems(codeHarness);
  const { locked, setLocked, lockChecked } = useAppLock();
  const quickStart = useFirstRunQuickStart({ enabled: lockChecked && !locked });

  const openQuickStartSettings = () => {
    // 首次引导跳转到设置时，确保落在「快速开始」分区。
    writePersistentValue(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, "guided");
    quickStart.dismiss();
    navigate("/settings");
  };

  const quickStartDialog = (
    <QuickStartDialog
      open={quickStart.open}
      steps={quickStart.steps}
      onGotoSettings={openQuickStartSettings}
      onClose={quickStart.dismiss}
    />
  );

  // 论文阅读页沉浸式：隐藏全局侧边导航，腾出空间给阅读器自带的论文库/工具栏。
  const immersiveReader = /^\/papers\/[^/]+\/reader\/?$/.test(location.pathname);

  useEffect(() => {
    const syncLayoutMode = () => setCurrentLayoutMode(getLayoutMode());

    window.addEventListener("storage", syncLayoutMode);
    window.addEventListener(LAYOUT_MODE_CHANGE_EVENT, syncLayoutMode);

    return () => {
      window.removeEventListener("storage", syncLayoutMode);
      window.removeEventListener(LAYOUT_MODE_CHANGE_EVENT, syncLayoutMode);
    };
  }, []);

  // Lock screen — shown before any app content
  if (locked) {
    return (
      <LockScreen
        onVerified={() => setLocked(false)}
        onVerify={async (password) => {
          try {
            return await apiClient.settings.appLock.verifyPassword(password);
          } catch {
            return false;
          }
        }}
        onGetRecoveryInfo={async () => {
          try {
            return await apiClient.settings.appLock.getRecoveryInfo();
          } catch {
            return { hint: "", question: "", hasEmail: false, hasSecurity: false };
          }
        }}
        onVerifyRecovery={async (email, answer) => {
          return await apiClient.settings.appLock.verifyRecovery(email, answer);
        }}
        onResetPassword={async (email, answer, newPassword) => {
          try {
            await apiClient.settings.appLock.resetPassword(email, answer, newPassword);
          } catch (err) {
            console.warn("Failed to reset password:", err);
            throw err;
          }
        }}
      />
    );
  }

  if (!lockChecked) return null;



  if (layoutMode === "focus") {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-apple-blue border-t-transparent" /></div>}>
        <FocusApp />
        <UpdateNotification {...autoUpdate} />
        <XiaoYanPet />
        {quickStartDialog}
      </Suspense>
    );
  }

  return (
    <div className={`app-shell ${IS_MACOS_DESKTOP ? "app-shell--macos-overlay" : ""}`.trim()}>
      {!immersiveReader ? (
        <aside className="app-sidebar">
          <MacWindowDragStrip className="app-sidebar__window-drag-region" />

          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              draggable={false}
              className="app-nav-link"
            >
              {({ isActive }) => (
                <span
                  className={`app-nav-item ${isActive ? "is-active" : ""}`.trim()}
                >
                  <span className="app-nav-item__marker" />
                  <Icon className="app-nav-item__icon" />
                  <span className="app-nav-item__label">{label}</span>
                </span>
              )}
            </NavLink>
          ))}

          <div className="app-sidebar__pet">
            <XiaoYanPet inline />
          </div>
        </aside>
      ) : null}

      <main className="app-main">
        <MacWindowDragStrip className="app-main__window-drag-region" />
        <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-apple-blue border-t-transparent" /></div>}>
          <Routes>
            <Route path="/" element={<RouteErrorBoundary><Home /></RouteErrorBoundary>} />
            <Route path="/planner" element={<RouteErrorBoundary><Planner /></RouteErrorBoundary>} />
            <Route path="/survey" element={<RouteErrorBoundary><Survey /></RouteErrorBoundary>} />
            <Route path="/write" element={<Navigate to="/writing" replace />} />
            <Route path="/papers" element={<RouteErrorBoundary><Papers /></RouteErrorBoundary>} />
            <Route path="/papers/:id/reader" element={<RouteErrorBoundary><PaperReader /></RouteErrorBoundary>} />
            <Route path="/writing" element={<RouteErrorBoundary><Writing /></RouteErrorBoundary>} />
            <Route path="/submission" element={<RouteErrorBoundary><Submission /></RouteErrorBoundary>} />
            <Route path="/experiment" element={<Navigate to={CODE_HARNESS_PATHS[codeHarness]} replace />} />
            <Route path="/tools" element={<RouteErrorBoundary><Tools /></RouteErrorBoundary>} />
            <Route path="/code" element={<RouteErrorBoundary><Code /></RouteErrorBoundary>} />
            <Route path="/codex" element={<RouteErrorBoundary><Codex /></RouteErrorBoundary>} />
            <Route path="/opencode" element={<RouteErrorBoundary><OpenCode /></RouteErrorBoundary>} />
            <Route path="/chat" element={<RouteErrorBoundary><Copilot /></RouteErrorBoundary>} />
            <Route path="/xiaoyan" element={<Navigate to="/chat" replace />} />
            <Route path="/copilot" element={<Navigate to="/chat" replace />} />
            <Route path="/knowledge" element={<RouteErrorBoundary><Knowledge /></RouteErrorBoundary>} />
            <Route path="/notes/:id" element={<RouteErrorBoundary><NoteReader /></RouteErrorBoundary>} />
            <Route path="/research-theme/:id" element={<RouteErrorBoundary><ResearchTheme /></RouteErrorBoundary>} />
            <Route path="/settings" element={<RouteErrorBoundary><Settings /></RouteErrorBoundary>} />
            <Route path="/workbench/*" element={<LandscapeFocusRouteRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <UpdateNotification {...autoUpdate} />
      {quickStartDialog}
    </div>
  );
}
