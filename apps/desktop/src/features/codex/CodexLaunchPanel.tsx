import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderOpen,
  KeyRound,
  Play,
} from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import type { CodexRuntimeConfig, CodexRuntimeMode } from "./shared";
import type { useCodexRuntime } from "./useCodexRuntime";

function RuntimeModeOption({
  mode,
  active,
  title,
  description,
  onSelect,
}: {
  mode: CodexRuntimeMode;
  active: boolean;
  title: string;
  description: string;
  onSelect: (mode: CodexRuntimeMode) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      className="flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all duration-150 active:scale-[0.99]"
      style={{
        background: active ? "var(--rc-elevated)" : "transparent",
        border: active ? "1px solid var(--rc-border-strong)" : "1px solid transparent",
        boxShadow: active ? "var(--rc-card-flat-shadow)" : "none",
      }}
    >
      <span
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: active ? "var(--rc-accent)" : "var(--rc-chip-inset-bg)",
          color: active ? "white" : "transparent",
          boxShadow: "var(--rc-chip-inset-shadow)",
        }}
      >
        <Check className="h-3 w-3" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-primary">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-ink-tertiary">{description}</span>
      </span>
    </button>
  );
}

export default function CodexLaunchPanel({
  runtime,
  draft,
  onDraftChange,
}: {
  runtime: ReturnType<typeof useCodexRuntime>;
  draft: CodexRuntimeConfig;
  onDraftChange: <K extends keyof CodexRuntimeConfig>(key: K, value: CodexRuntimeConfig[K]) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [externalVersion, setExternalVersion] = useState("");
  const phase = runtime.snapshot?.phase ?? "stopped";
  const canStart = draft.mode === "path"
    ? Boolean(runtime.snapshot?.pathAvailable)
    : Boolean(draft.externalExecutable?.trim());

  const pickExecutable = async () => {
    const selected = await runtime.chooseFile("选择 codex 可执行文件");
    if (selected) onDraftChange("externalExecutable", selected);
  };

  const pickDirectory = async (key: "workspaceDir" | "externalHome", title: string) => {
    const selected = await runtime.chooseDirectory(title);
    if (selected) onDraftChange(key, selected);
  };

  const validateExternal = async () => {
    if (!draft.externalExecutable) return;
    try {
      setExternalVersion(await runtime.validateExternal(draft.externalExecutable));
    } catch {
      setExternalVersion("");
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-primary">启动 Codex</h2>
          <p className="mt-1.5 text-sm text-ink-tertiary">选择运行环境和工作目录，然后进入小妍 Codex Web。</p>
        </div>

        <Card padding="lg" className="overflow-hidden">
          <div>
            <h3 className="text-sm font-semibold text-ink-primary">运行环境</h3>
            <p className="mt-1 text-xs leading-5 text-ink-tertiary">使用官方 app-server 协议，由小妍提供独立 Web 页面、进程和本地容器。</p>
          </div>

          <div className="mt-4 grid gap-1 rounded-[22px] p-1 sm:grid-cols-2" style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}>
            <RuntimeModeOption
              mode="path"
              active={draft.mode === "path"}
              title="已安装 Codex"
              description="自动发现环境中已安装的官方 harness"
              onSelect={(mode) => onDraftChange("mode", mode)}
            />
            <RuntimeModeOption
              mode="external"
              active={draft.mode === "external"}
              title="自定义 Codex"
              description="手动指定自行维护的可执行文件"
              onSelect={(mode) => onDraftChange("mode", mode)}
            />
          </div>

          {draft.mode === "path" && !runtime.snapshot?.pathAvailable && (
            <div className="mt-4 flex gap-2.5 rounded-2xl border border-amber-700/15 bg-amber-50/60 px-3.5 py-3 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="text-xs leading-5">未找到官方 Codex Harness。可执行 `brew install --cask codex` 或 `npm i -g @openai/codex`，或改为自定义可执行文件。</p>
            </div>
          )}

          {draft.mode === "path" && runtime.snapshot?.pathExecutable && (
            <p className="mt-3 text-xs text-ink-tertiary">已发现 {runtime.snapshot.pathExecutable}</p>
          )}

          {draft.mode === "external" && (
            <div className="mt-4 space-y-2">
              <label className="text-xs font-medium text-ink-secondary" htmlFor="codex-executable">codex 可执行文件</label>
              <div className="flex gap-2">
                <Input
                  id="codex-executable"
                  value={draft.externalExecutable ?? ""}
                  onChange={(event) => onDraftChange("externalExecutable", event.target.value || null)}
                  placeholder="/path/to/codex"
                  className="min-w-0 flex-1"
                />
                <Button variant="secondary" onClick={() => void pickExecutable()} aria-label="选择 codex 可执行文件">
                  <FolderOpen className="h-4 w-4" />
                </Button>
                <Button variant="ghost" onClick={() => void validateExternal()} disabled={!draft.externalExecutable || runtime.busy}>
                  检查
                </Button>
              </div>
              {externalVersion && <p className="text-xs font-medium text-emerald-700">已识别 Codex {externalVersion}</p>}
            </div>
          )}

          <div className="mt-5 space-y-2">
            <label className="text-xs font-medium text-ink-secondary" htmlFor="codex-workspace">工作目录</label>
            <div className="flex min-w-0 gap-2">
              <Input
                id="codex-workspace"
                value={draft.workspaceDir ?? ""}
                onChange={(event) => onDraftChange("workspaceDir", event.target.value || null)}
                placeholder="未选择时使用小妍隔离目录"
                className="min-w-0 flex-1"
              />
              <Button className="flex-shrink-0" variant="secondary" onClick={() => void pickDirectory("workspaceDir", "选择 Codex 工作目录")}>
                选择
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-y border-nm-dark/10 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-primary">小妍 API</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-tertiary">同步当前主模型到 Codex Harness。官方 harness 走 Responses API，Chat Completions 兼容接口可能无法使用。</p>
              {runtime.apiImportResult && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" />
                  已配置 {runtime.apiImportResult.model} · {runtime.apiImportResult.provider}
                </p>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="flex-shrink-0"
              onClick={() => void runtime.configureAndImportXiaoyanApi(draft)}
              disabled={!canStart || runtime.busy || phase === "starting"}
            >
              <KeyRound className="h-3.5 w-3.5" />
              配置小妍 API
            </Button>
          </div>

          <button
            type="button"
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-ink-tertiary hover:text-ink-secondary"
            onClick={() => setAdvancedOpen((current) => !current)}
            aria-expanded={advancedOpen}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            高级配置
          </button>

          <div className={`grid transition-[grid-template-rows] duration-200 ${advancedOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <div className="space-y-2 pt-4">
                <label className="text-xs font-medium text-ink-secondary" htmlFor="codex-home">CODEX_HOME</label>
                <div className="flex gap-2">
                  <Input
                    id="codex-home"
                    value={draft.externalHome ?? ""}
                    onChange={(event) => onDraftChange("externalHome", event.target.value || null)}
                    placeholder="默认使用本机 ~/.codex"
                    className="min-w-0 flex-1"
                  />
                  <Button variant="secondary" onClick={() => void pickDirectory("externalHome", "选择 CODEX_HOME")}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {(runtime.error || runtime.snapshot?.error) && (
            <div className="mt-4 flex gap-2.5 rounded-2xl border border-red-700/15 bg-red-50/60 px-3.5 py-3 text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="text-xs leading-5">{runtime.error || runtime.snapshot?.error}</p>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <Button
              onClick={() => void runtime.saveAndStart(draft)}
              disabled={!canStart || runtime.busy || phase === "starting"}
              loading={runtime.busy || phase === "starting"}
            >
              <Play className="h-3.5 w-3.5" />
              启动 Codex
            </Button>
          </div>

          {(runtime.snapshot?.logs.length ?? 0) > 0 && (
            <details className="group mt-4 border-t border-nm-dark/10 pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-ink-tertiary">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                运行日志 · {runtime.snapshot?.logs.length} 行
              </summary>
              <pre
                className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-2xl px-4 py-3 text-[11px] leading-5 text-ink-secondary"
                style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
              >
                {(runtime.snapshot?.logs ?? []).join("\n")}
              </pre>
            </details>
          )}
        </Card>
      </div>
    </div>
  );
}
