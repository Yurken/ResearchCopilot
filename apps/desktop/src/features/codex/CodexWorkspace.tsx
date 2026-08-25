import { useEffect, useMemo, useState } from "react";
import { Loader2, TerminalSquare } from "lucide-react";
import type { CodexRuntimeConfig } from "./shared";
import { useCodexRuntime } from "./useCodexRuntime";
import CodexLaunchPanel from "./CodexLaunchPanel";
import CodexRuntimeControls from "./CodexRuntimeControls";

export default function CodexWorkspace() {
  const runtime = useCodexRuntime();
  const [draft, setDraft] = useState<CodexRuntimeConfig>(runtime.config);

  useEffect(() => {
    if (runtime.snapshot && runtime.snapshot.phase !== "running") setDraft(runtime.snapshot.config);
  }, [runtime.snapshot]);

  const phase = runtime.snapshot?.phase ?? "stopped";
  const isRunning = phase === "running" && Boolean(runtime.snapshot?.url);
  const statusTone = useMemo(() => {
    if (phase === "running") return "#248A3D";
    if (phase === "failed") return "#C9342C";
    if (phase === "starting") return "#B35C00";
    return "var(--rc-text-muted)";
  }, [phase]);

  const updateDraft = <K extends keyof CodexRuntimeConfig>(key: K, value: CodexRuntimeConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    runtime.clearApiImportResult();
  };

  if (runtime.loading) {
    return <div className="flex h-full items-center justify-center bg-nm-bg"><Loader2 className="h-5 w-5 animate-spin text-ink-tertiary" /></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-nm-bg">
      {!isRunning && (
        <header className="app-header flex flex-shrink-0 items-center justify-between gap-4 border-b border-nm-dark/10 px-6 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl text-ink-primary" style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-chip-shadow)" }}>
              <TerminalSquare className="h-4.5 w-4.5" />
            </div>
            <h1 className="truncate text-[15px] font-semibold text-ink-primary">Codex Harness</h1>
          </div>
          <CodexRuntimeControls phase={phase} statusTone={statusTone} busy={runtime.busy} onRestart={() => void runtime.restart()} onStop={() => void runtime.stop()} />
        </header>
      )}

      {isRunning ? (
        <div className="relative min-h-0 flex-1 bg-white">
          <iframe
            key={runtime.snapshot?.url}
            src={runtime.snapshot?.url ?? undefined}
            title="Codex Web"
            className="absolute inset-0 h-full w-full border-0"
            allow="clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
          />
          <div className="pointer-events-none absolute right-3 top-3 z-20">
            <CodexRuntimeControls floating phase={phase} statusTone={statusTone} busy={runtime.busy} onRestart={() => void runtime.restart()} onStop={() => void runtime.stop()} />
          </div>
        </div>
      ) : (
        <CodexLaunchPanel runtime={runtime} draft={draft} onDraftChange={updateDraft} />
      )}
    </div>
  );
}
