import { useState } from "react";
import { AlertTriangle, Check, FolderOpen, Play } from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import type { PiWebRuntimeConfig, PiWebRuntimeMode } from "./shared";
import type { usePiWebRuntime } from "./usePiWebRuntime";

function ModeOption({
  mode,
  active,
  title,
  description,
  onSelect,
}: {
  mode: PiWebRuntimeMode;
  active: boolean;
  title: string;
  description: string;
  onSelect: (mode: PiWebRuntimeMode) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      className="flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all duration-150"
      style={{
        background: active ? "var(--rc-elevated)" : "transparent",
        border: active ? "1px solid var(--rc-border-strong)" : "1px solid transparent",
        boxShadow: active ? "var(--rc-card-flat-shadow)" : "none",
      }}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full" style={{ background: active ? "var(--rc-accent)" : "var(--rc-chip-inset-bg)", color: active ? "white" : "transparent" }}>
        <Check className="h-3 w-3" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-tertiary">{description}</span>
      </span>
    </button>
  );
}

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
  const canStart = draft.mode === "bundled"
    ? Boolean(runtime.snapshot?.bundledAvailable || runtime.snapshot?.pathAvailable)
    : draft.mode === "path"
      ? Boolean(runtime.snapshot?.pathAvailable)
      : Boolean(draft.externalExecutable?.trim());

  const pickExecutable = async () => {
    const selected = await runtime.chooseFile("选择 pi-web 可执行文件");
    if (selected) onDraftChange("externalExecutable", selected);
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
          <p className="mt-1 text-xs leading-5 text-ink-tertiary">小妍分配随机 loopback 端口并禁止自动打开外部浏览器。Pi 仍以当前用户权限执行。</p>
          <div className="mt-4 grid gap-1 rounded-[22px] p-1 sm:grid-cols-3" style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}>
            <ModeOption mode="bundled" active={draft.mode === "bundled"} title="内置 Pi" description="小妍自带的官方 harness，无需安装" onSelect={(mode) => onDraftChange("mode", mode)} />
            <ModeOption mode="path" active={draft.mode === "path"} title="已安装 Pi" description="自动发现 npm 全局安装或 PATH 中的版本" onSelect={(mode) => onDraftChange("mode", mode)} />
            <ModeOption mode="external" active={draft.mode === "external"} title="自定义 Pi" description="手动指定自行维护的可执行文件" onSelect={(mode) => onDraftChange("mode", mode)} />
          </div>

          {draft.mode === "bundled" && !runtime.snapshot?.bundledAvailable ? (
            <div className="mt-4 flex gap-2.5 rounded-2xl border border-amber-700/15 bg-amber-50/60 px-3.5 py-3 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="text-xs leading-5">{runtime.snapshot?.pathAvailable
                ? "当前构建未包含内置 Pi 运行时，将回退到已安装版本。可执行 pnpm pi-web:prepare-runtime 生成内置运行时。"
                : "当前构建未包含内置 Pi 运行时，也未在环境中发现已安装版本。可执行 pnpm pi-web:prepare-runtime 生成内置运行时，或执行 npm install -g @agegr/pi-web。"}</p>
            </div>
          ) : null}
          {draft.mode === "bundled" && runtime.snapshot?.bundledExecutable ? <p className="mt-3 text-xs text-ink-tertiary">内置运行时 {runtime.snapshot.bundledExecutable}</p> : null}

          {draft.mode === "path" && !runtime.snapshot?.pathAvailable ? (
            <div className="mt-4 flex gap-2.5 rounded-2xl border border-amber-700/15 bg-amber-50/60 px-3.5 py-3 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="text-xs leading-5">未找到 Pi。请安装 Node.js 22.19+，再执行 <code className="font-mono">npm install -g @agegr/pi-web</code>。</p>
            </div>
          ) : null}
          {draft.mode === "path" && runtime.snapshot?.pathExecutable ? <p className="mt-3 text-xs text-ink-tertiary">已发现 {runtime.snapshot.pathExecutable}</p> : null}
          {draft.mode === "external" ? (
            <div className="mt-4 space-y-2">
              <label className="text-xs font-medium text-ink-secondary" htmlFor="pi-web-executable">pi-web 可执行文件</label>
              <div className="flex gap-2">
                <Input id="pi-web-executable" value={draft.externalExecutable ?? ""} onChange={(event) => onDraftChange("externalExecutable", event.target.value || null)} placeholder="/path/to/pi-web" className="min-w-0 flex-1" />
                <Button variant="secondary" onClick={() => void pickExecutable()} aria-label="选择 pi-web 可执行文件"><FolderOpen className="h-4 w-4" /></Button>
                <Button variant="ghost" onClick={() => void validate()} disabled={!draft.externalExecutable || runtime.busy}>检查</Button>
              </div>
              {externalResult ? <p className="text-xs font-medium text-emerald-700">{externalResult}</p> : null}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-ink-secondary" htmlFor="pi-web-workspace">默认工作目录</label>
              <div className="flex gap-2"><Input id="pi-web-workspace" value={draft.workspaceDir ?? ""} onChange={(event) => onDraftChange("workspaceDir", event.target.value || null)} placeholder="未选择时使用小妍隔离目录" className="min-w-0 flex-1" /><Button variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => void pickDirectory("workspaceDir", "选择 Pi 工作目录")}>选择</Button></div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-ink-secondary" htmlFor="pi-web-agent-dir">Pi 数据目录</label>
              <div className="flex gap-2"><Input id="pi-web-agent-dir" value={draft.agentDir ?? ""} onChange={(event) => onDraftChange("agentDir", event.target.value || null)} placeholder={runtime.snapshot?.dataHome ?? "默认使用 ~/.pi/agent"} className="min-w-0 flex-1" /><Button variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => void pickDirectory("agentDir", "选择 Pi 数据目录")}>选择</Button></div>
            </div>
          </div>

          {(runtime.error || runtime.snapshot?.error) ? <div className="mt-4 rounded-2xl border border-red-700/15 bg-red-50/60 px-3.5 py-3 text-xs text-red-800">{runtime.error || runtime.snapshot?.error}</div> : null}
          <div className="mt-6 flex justify-end"><Button onClick={() => void runtime.saveAndStart(draft)} disabled={!canStart || runtime.busy}><Play className="h-3.5 w-3.5" />启动 Pi</Button></div>
        </Card>
      </div>
    </div>
  );
}
