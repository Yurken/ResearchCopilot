import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Square } from "lucide-react";
import { Button } from "@research-copilot/ui";
import PiWebIcon from "./PiWebIcon";
import PiWebLaunchPanel from "./PiWebLaunchPanel";
import { PI_WEB_PHASE_LABELS, type PiWebRuntimeConfig, type PiWebRuntimePhase } from "./shared";
import { usePiWebRuntime } from "./usePiWebRuntime";

function RuntimeControls({
  phase,
  tone,
  busy,
  floating,
  onRestart,
  onStop,
}: {
  phase: PiWebRuntimePhase;
  tone: string;
  busy: boolean;
  floating?: boolean;
  onRestart: () => void;
  onStop: () => void;
}) {
  return (
    <div role={floating ? "toolbar" : undefined} aria-label={floating ? "Pi 运行控制" : undefined} className={`flex items-center gap-1.5 ${floating ? "pointer-events-auto rounded-2xl border border-nm-dark/10 p-1.5" : ""}`} style={floating ? { background: "var(--rc-elevated)", boxShadow: "var(--rc-card-shadow)" } : undefined}>
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--rc-chip-inset-bg)", color: tone }}>
        <span className={`h-1.5 w-1.5 rounded-full ${phase === "starting" ? "animate-pulse" : ""}`} style={{ background: tone }} />
        {PI_WEB_PHASE_LABELS[phase]}
      </span>
      {phase === "running" ? <><Button variant="ghost" size="sm" onClick={onRestart} disabled={busy}><RefreshCw className="h-3.5 w-3.5" />重启</Button><Button variant="secondary" size="sm" onClick={onStop} disabled={busy}><Square className="h-3 w-3" />停止</Button></> : null}
    </div>
  );
}

export default function PiWebWorkspace() {
  const runtime = usePiWebRuntime();
  const [draft, setDraft] = useState<PiWebRuntimeConfig>(runtime.config);
  useEffect(() => {
    if (runtime.snapshot && runtime.snapshot.phase !== "running") setDraft(runtime.snapshot.config);
  }, [runtime.snapshot]);
  const phase = runtime.snapshot?.phase ?? "stopped";
  const isRunning = phase === "running" && Boolean(runtime.snapshot?.url);
  const tone = useMemo(() => phase === "running" ? "#248A3D" : phase === "failed" ? "#C9342C" : phase === "starting" ? "#B35C00" : "var(--rc-text-muted)", [phase]);
  const updateDraft = <K extends keyof PiWebRuntimeConfig>(key: K, value: PiWebRuntimeConfig[K]) => setDraft((current) => ({ ...current, [key]: value }));

  if (runtime.loading) return <div className="flex h-full items-center justify-center bg-nm-bg"><Loader2 className="h-5 w-5 animate-spin text-ink-tertiary" /></div>;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-nm-bg">
      {!isRunning ? (
        <header className="app-header flex flex-shrink-0 items-center justify-between gap-4 border-b border-nm-dark/10 px-6 pb-3">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-2xl" style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-chip-shadow)" }}><PiWebIcon className="h-4.5 w-4.5" /></span><h1 className="text-[15px] font-semibold text-ink-primary">Pi</h1></div>
          <RuntimeControls phase={phase} tone={tone} busy={runtime.busy} onRestart={() => void runtime.restart()} onStop={() => void runtime.stop()} />
        </header>
      ) : null}
      {isRunning ? (
        <div className="relative min-h-0 flex-1 bg-white">
          <iframe key={runtime.snapshot?.url} src={runtime.snapshot?.url ?? undefined} title="Pi" className="absolute inset-0 h-full w-full border-0" allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox" />
          <div className="pointer-events-none absolute right-3 top-3 z-20"><RuntimeControls floating phase={phase} tone={tone} busy={runtime.busy} onRestart={() => void runtime.restart()} onStop={() => void runtime.stop()} /></div>
        </div>
      ) : <PiWebLaunchPanel runtime={runtime} draft={draft} onDraftChange={updateDraft} />}
    </div>
  );
}
