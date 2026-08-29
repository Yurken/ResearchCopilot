import { useState } from "react";
import { AlertTriangle, ChevronDown, FolderOpen, Play } from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import type { CodexRuntimeConfig } from "./shared";
import type { useCodexRuntime } from "./useCodexRuntime";
import RuntimeExecutableSettings from "../code-harness/RuntimeExecutableSettings";
import RuntimeSourceSummary from "../code-harness/RuntimeSourceSummary";
import XiaoyanApiImportSection from "../code-harness/XiaoyanApiImportSection";

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
  const usingCustom = draft.mode === "external" && Boolean(draft.externalExecutable?.trim());
  const canStart = usingCustom
    ? true
    : Boolean(runtime.snapshot?.pathAvailable || runtime.snapshot?.bundledAvailable);

  const setLocalExecutable = (value: string | null) => {
    onDraftChange("externalExecutable", value);
    onDraftChange("mode", value?.trim() ? "external" : "auto");
  };

  const pickExecutable = async () => {
    const selected = await runtime.chooseFile("选择 codex 可执行文件");
    if (selected) setLocalExecutable(selected);
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
          <p className="mt-1.5 text-sm text-ink-tertiary">确认自动发现的运行环境和工作目录，然后进入小妍 Codex Web。</p>
        </div>

        <Card padding="lg" className="overflow-hidden">
          <div>
            <h3 className="text-sm font-semibold text-ink-primary">运行环境</h3>
            <p className="mt-1 text-xs leading-5 text-ink-tertiary">自动优先使用本机 Codex；未找到时可一键安装到小妍私有目录。</p>
          </div>

          <RuntimeSourceSummary
            provider="codex"
            label="Codex"
            usingCustom={usingCustom}
            customExecutable={draft.externalExecutable}
            pathAvailable={Boolean(runtime.snapshot?.pathAvailable)}
            pathExecutable={runtime.snapshot?.pathExecutable ?? null}
            managedAvailable={Boolean(runtime.snapshot?.bundledAvailable)}
            managedExecutable={runtime.snapshot?.bundledExecutable}
            onInstalled={runtime.refresh}
          />

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

          <XiaoyanApiImportSection
            description="同步当前主模型到 Codex Harness。官方 harness 走 Responses API，Chat Completions 兼容接口可能无法使用。"
            resultText={runtime.apiImportResult ? `已配置 ${runtime.apiImportResult.model} · ${runtime.apiImportResult.provider}` : null}
            busy={runtime.busy}
            disabled={!canStart || phase === "starting"}
            onImport={() => void runtime.configureAndImportXiaoyanApi(draft)}
          />

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
              <div className="space-y-4 pt-4">
                <RuntimeExecutableSettings
                  id="codex-executable"
                  label="Codex"
                  value={usingCustom ? draft.externalExecutable : null}
                  detectedExecutable={runtime.snapshot?.pathExecutable}
                  validationResult={externalVersion ? `已识别 Codex ${externalVersion}` : ""}
                  busy={runtime.busy}
                  onChange={setLocalExecutable}
                  onPick={() => void pickExecutable()}
                  onValidate={() => void validateExternal()}
                  onUseAuto={() => setLocalExecutable(null)}
                />
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
