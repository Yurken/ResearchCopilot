import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderOpen,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Square,
  TerminalSquare,
} from "lucide-react";
import { Button, Card, Input } from "@research-copilot/ui";
import {
  DSH_PHASE_LABELS,
  type DshRuntimeConfig,
  type DshRuntimeMode,
  type DshRuntimePhase,
} from "./shared";
import { useDeepSeekHarnessRuntime } from "./useDeepSeekHarnessRuntime";

function RuntimeModeOption({
  mode,
  active,
  title,
  description,
  onSelect,
}: {
  mode: DshRuntimeMode;
  active: boolean;
  title: string;
  description: string;
  onSelect: (mode: DshRuntimeMode) => void;
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

function RuntimeLog({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  return (
    <details className="group border-t border-nm-dark/10 px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-ink-tertiary">
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        运行日志 · {logs.length} 行
      </summary>
      <pre
        className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-2xl px-4 py-3 text-[11px] leading-5 text-ink-secondary"
        style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
      >
        {logs.join("\n")}
      </pre>
    </details>
  );
}

function RuntimeControls({
  phase,
  statusTone,
  busy,
  floating = false,
  onRestart,
  onStop,
}: {
  phase: DshRuntimePhase;
  statusTone: string;
  busy: boolean;
  floating?: boolean;
  onRestart: () => void;
  onStop: () => void;
}) {
  return (
    <div
      role={floating ? "toolbar" : undefined}
      aria-label={floating ? "DSH 运行控制" : undefined}
      className={`flex flex-shrink-0 items-center gap-1.5 ${floating ? "pointer-events-auto rounded-2xl border border-nm-dark/10 p-1.5" : ""}`}
      style={floating ? { background: "var(--rc-elevated)", boxShadow: "var(--rc-card-shadow)" } : undefined}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        style={{ background: "var(--rc-chip-inset-bg)", color: statusTone, boxShadow: "var(--rc-chip-inset-shadow)" }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${phase === "starting" ? "animate-pulse" : ""}`} style={{ background: statusTone }} />
        {DSH_PHASE_LABELS[phase]}
      </span>
      {phase === "running" && (
        <>
          <Button variant="ghost" size="sm" onClick={onRestart} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" />
            重启
          </Button>
          <Button variant="secondary" size="sm" onClick={onStop} disabled={busy}>
            <Square className="h-3 w-3" />
            停止
          </Button>
        </>
      )}
    </div>
  );
}

export default function DeepSeekHarnessWorkspace() {
  const runtime = useDeepSeekHarnessRuntime();
  const [draft, setDraft] = useState<DshRuntimeConfig>(runtime.config);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [externalVersion, setExternalVersion] = useState("");

  useEffect(() => {
    if (runtime.snapshot && runtime.snapshot.phase !== "running") {
      setDraft(runtime.snapshot.config);
    }
  }, [runtime.snapshot]);

  const phase = runtime.snapshot?.phase ?? "stopped";
  const isRunning = phase === "running" && Boolean(runtime.snapshot?.url);
  const canStart = draft.mode === "bundled"
    ? Boolean(runtime.snapshot?.bundledAvailable)
    : Boolean(draft.externalExecutable?.trim());
  const statusTone = useMemo(() => {
    if (phase === "running") return "#248A3D";
    if (phase === "failed") return "#C9342C";
    if (phase === "starting") return "#B35C00";
    return "var(--rc-text-muted)";
  }, [phase]);

  const updateDraft = <K extends keyof DshRuntimeConfig>(key: K, value: DshRuntimeConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    runtime.clearApiImportResult();
    if (key === "externalExecutable") setExternalVersion("");
  };

  const pickExecutable = async () => {
    const selected = await runtime.chooseFile("选择 dsh 可执行文件");
    if (selected) updateDraft("externalExecutable", selected);
  };

  const pickDirectory = async (key: "workspaceDir" | "externalHome", title: string) => {
    const selected = await runtime.chooseDirectory(title);
    if (selected) updateDraft(key, selected);
  };

  const validateExternal = async () => {
    if (!draft.externalExecutable) return;
    try {
      setExternalVersion(await runtime.validateExternal(draft.externalExecutable));
    } catch {
      setExternalVersion("");
    }
  };

  if (runtime.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-nm-bg">
        <Loader2 className="h-5 w-5 animate-spin text-ink-tertiary" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-nm-bg">
      {!isRunning && (
        <header className="app-header flex flex-shrink-0 items-center justify-between gap-4 border-b border-nm-dark/10 px-6 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl text-ink-primary"
              style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-chip-shadow)" }}
            >
              <TerminalSquare className="h-4.5 w-4.5" />
            </div>
            <h1 className="truncate text-[15px] font-semibold text-ink-primary">DeepSeek Harness</h1>
          </div>
          <RuntimeControls
            phase={phase}
            statusTone={statusTone}
            busy={runtime.busy}
            onRestart={() => void runtime.restart()}
            onStop={() => void runtime.stop()}
          />
        </header>
      )}

      {isRunning ? (
        <div className="relative min-h-0 flex-1 bg-white">
          <iframe
            key={runtime.snapshot?.url}
            src={runtime.snapshot?.url ?? undefined}
            title="DeepSeek Harness"
            className="absolute inset-0 h-full w-full border-0"
            allow="clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
          />
          <div className="pointer-events-none absolute right-3 top-3 z-20 md:right-[11.5rem]">
            <RuntimeControls
              floating
              phase={phase}
              statusTone={statusTone}
              busy={runtime.busy}
              onRestart={() => void runtime.restart()}
              onStop={() => void runtime.stop()}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-primary">启动 DSH</h2>
              <p className="mt-1.5 text-sm text-ink-tertiary">选择运行环境和工作目录，然后进入 Harness。</p>
            </div>

            <Card padding="lg" className="overflow-hidden">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">运行环境</h3>
                <p className="mt-1 text-xs leading-5 text-ink-tertiary">推荐使用随小妍发布的内置版本。</p>
              </div>

              <div className="mt-4 grid gap-1 rounded-[22px] p-1 sm:grid-cols-2" style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}>
                <RuntimeModeOption
                  mode="bundled"
                  active={draft.mode === "bundled"}
                  title="内置 DSH"
                  description="随小妍发布，无需单独安装"
                  onSelect={(mode) => updateDraft("mode", mode)}
                />
                <RuntimeModeOption
                  mode="external"
                  active={draft.mode === "external"}
                  title="自定义 DSH"
                  description="手动指定自行维护的可执行文件"
                  onSelect={(mode) => updateDraft("mode", mode)}
                />
              </div>

              {draft.mode === "bundled" && !runtime.snapshot?.bundledAvailable && (
                <div className="mt-4 flex gap-2.5 rounded-2xl border border-amber-700/15 bg-amber-50/60 px-3.5 py-3 text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p className="text-xs leading-5">当前开发构建还没有生成内置运行时。可先选择自定义 DSH，或执行运行时构建脚本后再启动。</p>
                </div>
              )}

              {draft.mode === "external" && (
                <div className="mt-4 space-y-2">
                  <label className="text-xs font-medium text-ink-secondary" htmlFor="dsh-executable">dsh 可执行文件</label>
                  <div className="flex gap-2">
                    <Input
                      id="dsh-executable"
                      value={draft.externalExecutable ?? ""}
                      onChange={(event) => updateDraft("externalExecutable", event.target.value || null)}
                      placeholder="/path/to/dsh"
                      className="min-w-0 flex-1"
                    />
                    <Button variant="secondary" onClick={() => void pickExecutable()} aria-label="选择 dsh 可执行文件">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" onClick={() => void validateExternal()} disabled={!draft.externalExecutable || runtime.busy}>
                      检查
                    </Button>
                  </div>
                  {externalVersion && <p className="text-xs font-medium text-emerald-700">已识别 DSH {externalVersion}</p>}
                </div>
              )}

              <div className="mt-5 space-y-2">
                <label className="text-xs font-medium text-ink-secondary" htmlFor="dsh-workspace">工作目录</label>
                <div className="flex min-w-0 gap-2">
                  <Input
                    id="dsh-workspace"
                    value={draft.workspaceDir ?? ""}
                    onChange={(event) => updateDraft("workspaceDir", event.target.value || null)}
                    placeholder="未选择时使用小妍隔离目录"
                    className="min-w-0 flex-1"
                  />
                  <Button className="flex-shrink-0" variant="secondary" onClick={() => void pickDirectory("workspaceDir", "选择 DSH 工作目录")}>
                    选择
                  </Button>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-y border-nm-dark/10 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink-primary">小妍 API</p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-tertiary">将当前主模型同步到 DSH，凭据不会显示在页面中。</p>
                  {runtime.apiImportResult && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                      已配置 {runtime.apiImportResult.model} · {runtime.apiImportResult.route}
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
                  <div className="grid gap-4 pt-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-ink-secondary" htmlFor="dsh-profile">Profile</label>
                      <Input
                        id="dsh-profile"
                        value={draft.profile}
                        onChange={(event) => updateDraft("profile", event.target.value)}
                        placeholder="web"
                      />
                    </div>
                    {draft.mode === "external" && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-ink-secondary" htmlFor="dsh-home">自定义 DSH_HOME</label>
                        <div className="flex gap-2">
                          <Input
                            id="dsh-home"
                            value={draft.externalHome ?? ""}
                            onChange={(event) => updateDraft("externalHome", event.target.value || null)}
                            placeholder="默认 ~/.dsh"
                            className="min-w-0 flex-1"
                          />
                          <Button variant="secondary" onClick={() => void pickDirectory("externalHome", "选择自定义 DSH_HOME")}>
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
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
                  启动 DSH
                </Button>
              </div>
              <RuntimeLog logs={runtime.snapshot?.logs ?? []} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
