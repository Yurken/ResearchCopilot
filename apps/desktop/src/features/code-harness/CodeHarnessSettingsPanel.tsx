import { useLocation, useNavigate } from "react-router-dom";
import { CODE_HARNESS_PATHS, isCodeHarnessPath, type CodeHarnessProvider } from "./shared";
import { useCodeHarnessProvider } from "./useCodeHarnessProvider";
import CodexIcon from "../codex/CodexIcon";
import DeepSeekIcon from "../deepseek-harness/DeepSeekIcon";
import OpenCodeIcon from "../opencode/OpenCodeIcon";
import PiWebIcon from "../pi-web/PiWebIcon";

const OPTIONS: Array<{
  id: CodeHarnessProvider;
  title: string;
  description: string;
  icon: typeof DeepSeekIcon;
}> = [
  {
    id: "dsh",
    title: "DeepSeek Harness",
    description: "托管官方 DSH Web 页面，小妍只负责进程和容器。",
    icon: DeepSeekIcon,
  },
  {
    id: "codex",
    title: "Codex Harness",
    description: "使用官方 app-server，并托管小妍 Codex Web 页面。",
    icon: CodexIcon,
  },
  {
    id: "opencode",
    title: "OpenCode",
    description: "运行 OpenCode 官方 Web 页面，优先使用本机版本。",
    icon: OpenCodeIcon,
  },
  {
    id: "pi",
    title: "Pi",
    description: "嵌入 Pi 的完整 Web 工作台、会话与技能管理。",
    icon: PiWebIcon,
  },
];

export default function CodeHarnessSettingsPanel() {
  const { provider, setProvider } = useCodeHarnessProvider();
  const location = useLocation();
  const navigate = useNavigate();

  const select = (next: CodeHarnessProvider) => {
    if (next === provider) return;
    setProvider(next);
    const current = location.pathname.replace(/\/+$/, "") || "/";
    if (isCodeHarnessPath(current)) {
      navigate(CODE_HARNESS_PATHS[next], { replace: true });
    }
  };

  return (
    <div>
      <p className="mb-2 ml-1 text-xs font-medium text-ink-tertiary">代码助手</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {OPTIONS.map((option) => {
          const selected = provider === option.id;
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => select(option.id)}
              aria-pressed={selected}
              className="rounded-[24px] p-4 text-left transition-all duration-150"
              style={
                selected
                  ? {
                      background: "color-mix(in srgb, var(--rc-accent) 10%, var(--rc-elevated))",
                      border: "1px solid color-mix(in srgb, var(--rc-accent) 28%, var(--rc-border))",
                      boxShadow: "0 14px 28px rgb(var(--rc-sidebar-shadow-rgb) / 0.1)",
                    }
                  : {
                      background: "var(--rc-elevated)",
                      border: "1px solid var(--rc-border)",
                      boxShadow: "var(--rc-flat-shadow)",
                    }
              }
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border"
                    style={{ borderColor: "var(--rc-border)", color: "var(--rc-text)" }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-semibold text-ink-primary">{option.title}</p>
                </div>
                {selected ? (
                  <span
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--rc-accent)" }}
                  >
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                      <path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : null}
              </div>
              <p className="text-xs leading-5 text-ink-secondary">{option.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
