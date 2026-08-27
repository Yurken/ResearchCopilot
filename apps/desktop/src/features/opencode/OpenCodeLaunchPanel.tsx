import { useState } from "react";
import { AlertTriangle, Check, FolderOpen, Play } from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import type { OpenCodeRuntimeConfig, OpenCodeRuntimeMode } from "./shared";
import type { useOpenCodeRuntime } from "./useOpenCodeRuntime";

function ModeOption({ mode, active, title, description, onSelect }: { mode: OpenCodeRuntimeMode; active: boolean; title: string; description: string; onSelect: (mode: OpenCodeRuntimeMode) => void }) {
  return (
    <button type="button" onClick={() => onSelect(mode)} aria-pressed={active} className="flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all duration-150" style={{ background: active ? "var(--rc-elevated)" : "transparent", border: active ? "1px solid var(--rc-border-strong)" : "1px solid transparent", boxShadow: active ? "var(--rc-card-flat-shadow)" : "none" }}>
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full" style={{ background: active ? "var(--rc-accent)" : "var(--rc-chip-inset-bg)", color: active ? "white" : "transparent" }}><Check className="h-3 w-3" /></span>
      <span><span className="block text-sm font-semibold text-ink-primary">{title}</span><span className="mt-0.5 block text-xs text-ink-tertiary">{description}</span></span>
    </button>
  );
}

export default function OpenCodeLaunchPanel({ runtime, draft, onDraftChange }: { runtime: ReturnType<typeof useOpenCodeRuntime>; draft: OpenCodeRuntimeConfig; onDraftChange: <K extends keyof OpenCodeRuntimeConfig>(key: K, value: OpenCodeRuntimeConfig[K]) => void }) {
  const [externalVersion, setExternalVersion] = useState("");
  const canStart = draft.mode === "path" ? Boolean(runtime.snapshot?.pathAvailable) : Boolean(draft.externalExecutable?.trim());
  const pickExecutable = async () => { const selected = await runtime.chooseFile("选择 opencode 可执行文件"); if (selected) onDraftChange("externalExecutable", selected); };
  const pickWorkspace = async () => { const selected = await runtime.chooseDirectory("选择 OpenCode 工作目录"); if (selected) onDraftChange("workspaceDir", selected); };
  const validate = async () => { if (!draft.externalExecutable) return; try { setExternalVersion(await runtime.validateExternal(draft.externalExecutable)); } catch { setExternalVersion(""); } };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8"><div className="mx-auto max-w-4xl">
      <div className="mb-5"><h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-primary">启动 OpenCode</h2><p className="mt-1.5 text-sm text-ink-tertiary">在小妍内托管 OpenCode 官方 Web 界面。</p></div>
      <Card padding="lg">
        <h3 className="text-sm font-semibold text-ink-primary">运行环境</h3><p className="mt-1 text-xs leading-5 text-ink-tertiary">仅监听随机 loopback 端口，工作区和会话仍由 OpenCode 管理。</p>
        <div className="mt-4 grid gap-1 rounded-[22px] p-1 sm:grid-cols-2" style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}>
          <ModeOption mode="path" active={draft.mode === "path"} title="已安装 OpenCode" description="自动发现环境中已安装的版本" onSelect={(mode) => onDraftChange("mode", mode)} />
          <ModeOption mode="external" active={draft.mode === "external"} title="自定义 OpenCode" description="手动指定自行维护的可执行文件" onSelect={(mode) => onDraftChange("mode", mode)} />
        </div>
        {draft.mode === "path" && !runtime.snapshot?.pathAvailable && <div className="mt-4 flex gap-2.5 rounded-2xl border border-amber-700/15 bg-amber-50/60 px-3.5 py-3 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /><p className="text-xs leading-5">未找到 OpenCode。请先按官方方式安装，或改为自定义可执行文件。</p></div>}
        {draft.mode === "path" && runtime.snapshot?.pathExecutable && <p className="mt-3 text-xs text-ink-tertiary">已发现 {runtime.snapshot.pathExecutable}</p>}
        {draft.mode === "external" && <div className="mt-4 space-y-2"><label className="text-xs font-medium text-ink-secondary" htmlFor="opencode-executable">opencode 可执行文件</label><div className="flex gap-2"><Input id="opencode-executable" value={draft.externalExecutable ?? ""} onChange={(event) => onDraftChange("externalExecutable", event.target.value || null)} placeholder="/path/to/opencode" className="min-w-0 flex-1" /><Button variant="secondary" onClick={() => void pickExecutable()} aria-label="选择 opencode 可执行文件"><FolderOpen className="h-4 w-4" /></Button><Button variant="ghost" onClick={() => void validate()} disabled={!draft.externalExecutable || runtime.busy}>检查</Button></div>{externalVersion && <p className="text-xs font-medium text-emerald-700">已识别 OpenCode {externalVersion}</p>}</div>}
        <div className="mt-5 space-y-2"><label className="text-xs font-medium text-ink-secondary" htmlFor="opencode-workspace">工作目录</label><div className="flex gap-2"><Input id="opencode-workspace" value={draft.workspaceDir ?? ""} onChange={(event) => onDraftChange("workspaceDir", event.target.value || null)} placeholder="未选择时使用小妍隔离目录" className="min-w-0 flex-1" /><Button variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => void pickWorkspace()}>选择</Button></div></div>
        {(runtime.error || runtime.snapshot?.error) && <div className="mt-4 rounded-2xl border border-red-700/15 bg-red-50/60 px-3.5 py-3 text-xs text-red-800">{runtime.error || runtime.snapshot?.error}</div>}
        <div className="mt-6 flex justify-end"><Button onClick={() => void runtime.saveAndStart(draft)} disabled={!canStart || runtime.busy}><Play className="h-3.5 w-3.5" />启动 OpenCode</Button></div>
      </Card>
    </div></div>
  );
}
