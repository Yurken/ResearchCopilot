import { useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import type { OpenCodeRuntimeConfig } from "./shared";
import type { useOpenCodeRuntime } from "./useOpenCodeRuntime";
import RuntimeExecutableSettings from "../code-harness/RuntimeExecutableSettings";
import RuntimeSourceSummary from "../code-harness/RuntimeSourceSummary";
import XiaoyanApiImportSection from "../code-harness/XiaoyanApiImportSection";

export default function OpenCodeLaunchPanel({
  runtime,
  draft,
  onDraftChange,
}: {
  runtime: ReturnType<typeof useOpenCodeRuntime>;
  draft: OpenCodeRuntimeConfig;
  onDraftChange: <K extends keyof OpenCodeRuntimeConfig>(
    key: K,
    value: OpenCodeRuntimeConfig[K],
  ) => void;
}) {
  const [externalVersion, setExternalVersion] = useState("");
  const phase = runtime.snapshot?.phase ?? "stopped";
  const usingCustom = draft.mode === "external" && Boolean(draft.externalExecutable?.trim());
  const canStart = usingCustom
    ? true
    : Boolean(runtime.snapshot?.pathAvailable || runtime.snapshot?.bundledAvailable);

  const setLocalExecutable = (value: string | null) => {
    onDraftChange("externalExecutable", value);
    onDraftChange("mode", value?.trim() ? "external" : "auto");
    setExternalVersion("");
  };
  const pickExecutable = async () => {
    const selected = await runtime.chooseFile("选择 opencode 可执行文件");
    if (selected) setLocalExecutable(selected);
  };
  const pickWorkspace = async () => {
    const selected = await runtime.chooseDirectory("选择 OpenCode 工作目录");
    if (selected) onDraftChange("workspaceDir", selected);
  };
  const validate = async () => {
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
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-primary">启动 OpenCode</h2>
          <p className="mt-1.5 text-sm text-ink-tertiary">在小妍内托管 OpenCode 官方 Web 界面。</p>
        </div>
        <Card padding="lg">
          <h3 className="text-sm font-semibold text-ink-primary">运行环境</h3>
          <p className="mt-1 text-xs leading-5 text-ink-tertiary">
            自动优先使用本机 OpenCode；未找到时可一键安装到小妍私有目录。
          </p>
          <RuntimeSourceSummary
            provider="opencode"
            label="OpenCode"
            usingCustom={usingCustom}
            customExecutable={draft.externalExecutable}
            pathAvailable={Boolean(runtime.snapshot?.pathAvailable)}
            pathExecutable={runtime.snapshot?.pathExecutable ?? null}
            managedAvailable={Boolean(runtime.snapshot?.bundledAvailable)}
            managedExecutable={runtime.snapshot?.bundledExecutable}
            onInstalled={runtime.refresh}
          />

          <div className="mt-5 space-y-2">
            <label className="text-xs font-medium text-ink-secondary" htmlFor="opencode-workspace">工作目录</label>
            <div className="flex gap-2">
              <Input
                id="opencode-workspace"
                value={draft.workspaceDir ?? ""}
                onChange={(event) => onDraftChange("workspaceDir", event.target.value || null)}
                placeholder="未选择时使用小妍隔离目录"
                className="min-w-0 flex-1"
              />
              <Button variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => void pickWorkspace()}>
                选择
              </Button>
            </div>
          </div>

          <XiaoyanApiImportSection
            description="将当前主模型同步到 OpenCode，凭据不会显示在页面中。"
            resultText={runtime.apiImportResult ? `已配置 ${runtime.apiImportResult.model} · ${runtime.apiImportResult.provider}` : null}
            busy={runtime.busy}
            disabled={!canStart || phase === "starting"}
            onImport={() => void runtime.configureAndImportXiaoyanApi(draft)}
          />

          <details className="group mt-4 pt-1">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-ink-tertiary">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              高级设置
            </summary>
            <div className="pt-4">
              <RuntimeExecutableSettings
                id="opencode-executable"
                label="OpenCode"
                value={usingCustom ? draft.externalExecutable : null}
                detectedExecutable={runtime.snapshot?.pathExecutable}
                validationResult={externalVersion ? `已识别 OpenCode ${externalVersion}` : ""}
                busy={runtime.busy}
                onChange={setLocalExecutable}
                onPick={() => void pickExecutable()}
                onValidate={() => void validate()}
                onUseAuto={() => setLocalExecutable(null)}
              />
            </div>
          </details>

          {runtime.error || runtime.snapshot?.error ? (
            <div className="mt-4 rounded-2xl border border-red-700/15 bg-red-50/60 px-3.5 py-3 text-xs text-red-800">
              {runtime.error || runtime.snapshot?.error}
            </div>
          ) : null}
          <div className="mt-6 flex justify-end">
            <Button onClick={() => void runtime.saveAndStart(draft)} disabled={!canStart || runtime.busy}>
              <Play className="h-3.5 w-3.5" />
              启动 OpenCode
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
