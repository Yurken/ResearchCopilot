import { RefreshCw, Square } from "lucide-react";
import { Button } from "@research-copilot/ui";
import { CODEX_PHASE_LABELS, type CodexRuntimePhase } from "./shared";

export default function CodexRuntimeControls({
  phase,
  statusTone,
  busy,
  onRestart,
  onStop,
}: {
  phase: CodexRuntimePhase;
  statusTone: string;
  busy: boolean;
  onRestart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        style={{ background: "var(--rc-chip-inset-bg)", color: statusTone, boxShadow: "var(--rc-chip-inset-shadow)" }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${phase === "starting" ? "animate-pulse" : ""}`} style={{ background: statusTone }} />
        {CODEX_PHASE_LABELS[phase]}
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
