import { useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import type { PiWebRuntimeConfig } from "./shared";
import type { usePiWebRuntime } from "./usePiWebRuntime";
import RuntimeExecutableSettings from "../code-harness/RuntimeExecutableSettings";
import RuntimeSourceSummary from "../code-harness/RuntimeSourceSummary";
import XiaoyanApiImportSection from "../code-harness/XiaoyanApiImportSection";

export default function PiWebLaunchPanel({
  runtime,
  draft,
  onDraftChange,
}: {
  runtime: ReturnType<typeof usePiWebRuntime>;
  draft: PiWebRuntimeConfig;
  onDraftChange: <K extends keyof PiWebRuntimeConfig>(key: K, value: PiWebRuntimeConfig[K]) => void;
}) {
  const [externalResult, setExternalResult] = useState("");
  const phase = runtime.snapshot?.phase ?? "stopped";
  const usingCustom = draft.mode === "external" && Boolean(draft.externalExecutable?.trim());
  const canStart = usingCustom
    ? true
    : Boolean(runtime.snapshot?.pathAvailable || runtime.snapshot?.bundledAvailable);

  const setLocalExecutable = (value: string | null) => {
    onDraftChange("externalExecutable", value);
    onDraftChange("mode", value?.trim() ? "external" : "auto");
    setExternalResult("");
  };
  const pickExecutable = async () => {
    const selected = await runtime.chooseFile("选择 pi-web 可执行文件");
    if (selected) setLocalExecutable(selected);
  };
  const pickDirectory = async (field: "workspaceDir" | "agentDir", title: string) => {
    const selected = await runtime.chooseDirectory(title);
    if (selected) onDraftChange(field, selected);
  };
  const validate = async () => {
    if (!draft.externalExecutable) return;
    try {
      setExternalResult(await runtime.validateExternal(draft.externalExecutable));
    } catch {
      setExternalResult("");
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-primary">启动 Pi</h2>
          <p className="mt-1.5 text-sm text-ink-tertiary">直接嵌入 agegr/pi-web 的完整工作台、会话、模型、技能和文件预览。</p>
        </div>
        <Card padding="lg">
          <h3 className="text-sm font-semibold text-ink-primary">运行环境</h3>
          <p className="mt-1 text-xs leading-5 text-ink-tertiary">
            自动优先使用本机 Pi；未找到时可一键安装到小妍私有目录。
          </p>
          <RuntimeSourceSummary
            provider="pi_web"
            label="Pi"
            usingCustom={usingCustom}
            customExecutable={draft.externalExecutable}
            pathAvailable={Boolean(runtime.snapshot?.pathAvailable)}
            pathExecutable={runtime.snapshot?.pathExecutable ?? null}
            managedAvailable={Boolean(runtime.snapshot?.bundledAvailable)}
            managedExecutable={runtime.snapshot?.bundledExecutable}
            onInstalled={runtime.refresh}
          />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-ink-secondary" htmlFor="pi-web-workspace">默认工作目录</label>
              <div className="flex gap-2">
                <Input id="pi-web-workspace" value={draft.workspaceDir ?? ""} onChange={(event) => onDraftChange("workspaceDir", event.target.value || null)} placeholder="未选择时使用小妍隔离目录" className="min-w-0 flex-1" />
                <Button variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => void pickDirectory("workspaceDir", "选择 Pi 工作目录")}>选择</Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-ink-secondary" htmlFor="pi-web-agent-dir">Pi 数据目录</label>
              <div className="flex gap-2">
                <Input id="pi-web-agent-dir" value={draft.agentDir ?? ""} onChange={(event) => onDraftChange("agentDir", event.target.value || null)} placeholder={runtime.snapshot?.dataHome ?? "默认使用 ~/.pi/agent"} className="min-w-0 flex-1" />
                <Button variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => void pickDirectory("agentDir", "选择 Pi 数据目录")}>选择</Button>
              </div>
            </div>
          </div>

          <XiaoyanApiImportSection
            description="将当前主模型同步到 Pi，凭据不会显示在页面中。"
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
                id="pi-web-executable"
                label="Pi"
                value={usingCustom ? draft.externalExecutable : null}
                detectedExecutable={runtime.snapshot?.pathExecutable}
                validationResult={externalResult}
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
              启动 Pi
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
