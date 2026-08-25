import type { ReactNode } from "react";
import { Card } from "@research-copilot/ui";
import { LayoutDashboard, Monitor, Moon, Sun } from "lucide-react";
import type { LayoutMode } from "../../lib/layoutMode";
import type { ThemePreference } from "../../lib/themeMode";
import { SectionIcon } from "./shared";
import ModuleVisibilitySettingsPanel from "../module-visibility/ModuleVisibilitySettingsPanel";
import CodeHarnessSettingsPanel from "../code-harness/CodeHarnessSettingsPanel";

function OptionCard({
  selected,
  title,
  description,
  icon,
  preview,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon?: ReactNode;
  preview?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
          {preview ?? icon}
          <div>
            <p className="text-sm font-semibold text-ink-primary">{title}</p>
          </div>
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
      <p className="text-xs leading-5 text-ink-secondary">{description}</p>
    </button>
  );
}

function ThemeSwatch({ mode }: { mode: "light" | "dark" | "auto" }) {
  if (mode === "auto") {
    return (
      <div className="flex h-10 w-10 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--rc-border)" }}>
        <div className="flex-1 bg-[#f7f4ee]" />
        <div className="flex-1 bg-[#15181d]" />
      </div>
    );
  }

  return (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-2xl border"
      style={{
        borderColor: "var(--rc-border)",
        background: mode === "light" ? "#f7f4ee" : "#15181d",
        color: mode === "light" ? "#191b1f" : "#f3f2ed",
      }}
    >
      {mode === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </div>
  );
}

export default function LayoutSettingsSection({
  currentTheme,
  pendingLayout,
  onThemeChange,
  onLayoutChange,
}: {
  currentTheme: ThemePreference;
  pendingLayout: LayoutMode;
  onThemeChange: (mode: ThemePreference) => void;
  onLayoutChange: (mode: LayoutMode) => void;
}) {
  return (
    <Card padding="md" className="space-y-5">
      <div className="flex items-center gap-3">
        <SectionIcon icon={LayoutDashboard} color="#30B0C7" />
        <div>
          <h2 className="text-base font-semibold text-ink-primary">界面布局模式</h2>
          <p className="mt-0.5 text-xs text-ink-tertiary">外观立即生效，布局模式切换后会自动重启应用</p>
        </div>
      </div>

      <div>
        <p className="mb-2 ml-1 text-xs font-medium text-ink-tertiary">外观主题</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            {
              mode: "auto" as ThemePreference,
              label: "跟随系统",
              description: "沿用系统深浅模式，让界面在白天和低光环境之间自然切换。",
              icon: (
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border" style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)", color: "var(--rc-text-soft)" }}>
                  <Monitor className="h-4 w-4" />
                </div>
              ),
              preview: <ThemeSwatch mode="auto" />,
            },
            {
              mode: "light" as ThemePreference,
              label: "浅色",
              description: "偏纸面的浅暖底色，阅读更轻，层级更像一张整理好的研究桌面。",
              preview: <ThemeSwatch mode="light" />,
            },
            {
              mode: "dark" as ThemePreference,
              label: "深色",
              description: "石墨感深色壳层，弱化装饰色，突出内容和结构。",
              preview: <ThemeSwatch mode="dark" />,
            },
          ] as const).map(({ mode, label, description, preview }) => (
            <OptionCard
              key={mode}
              selected={currentTheme === mode}
              title={label}
              description={description}
              preview={preview}
              onClick={() => onThemeChange(mode)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 ml-1 text-xs font-medium text-ink-tertiary">布局模式</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            {
              mode: "landscape" as LayoutMode,
              label: "纵横",
              description: "保留侧边导航和多模块切换，适合同时推进多个研究任务。",
            },
            {
              mode: "focus" as LayoutMode,
              label: "聚焦",
              description: "围绕研究主题进入专属工作台，减少切换，保持连续专注。",
            },
          ] as const).map(({ mode, label, description }) => (
            <OptionCard
              key={mode}
              selected={pendingLayout === mode}
              title={label}
              description={description}
              onClick={() => onLayoutChange(mode)}
            />
          ))}
        </div>
      </div>

      <CodeHarnessSettingsPanel />

      <ModuleVisibilitySettingsPanel />

      <div
        className="rounded-2xl px-4 py-3 text-xs leading-5 text-ink-tertiary"
        style={{ background: "var(--rc-card-inset-bg)", border: "1px solid var(--rc-card-inset-outline)" }}
      >
        切换布局后应用会自动重启。主题和代码助手会立即保存并作用到当前窗口。
      </div>
    </Card>
  );
}
