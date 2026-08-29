export type OpenCodeRuntimeMode = "auto" | "bundled" | "path" | "external";
export type OpenCodeRuntimePhase = "stopped" | "starting" | "running" | "failed";
export interface OpenCodeRuntimeConfig { mode: OpenCodeRuntimeMode; externalExecutable: string | null; workspaceDir: string | null; }
export interface OpenCodeRuntimeSnapshot {
  phase: OpenCodeRuntimePhase; config: OpenCodeRuntimeConfig; url: string | null; error: string | null; logs: string[];
  bundledAvailable: boolean; bundledExecutable: string | null; pathAvailable: boolean; pathExecutable: string | null; source: string;
  dataHome: string;
}
export interface OpenCodeApiImportResult {
  provider: string;
  model: string;
  dataHome: string;
}
export const DEFAULT_OPENCODE_CONFIG: OpenCodeRuntimeConfig = { mode: "auto", externalExecutable: null, workspaceDir: null };
export const OPENCODE_PHASE_LABELS: Record<OpenCodeRuntimePhase, string> = { stopped: "未启动", starting: "启动中", running: "运行中", failed: "启动失败" };
export function formatOpenCodeError(error: unknown): string { const message = error instanceof Error ? error.message : String(error ?? ""); return message.trim() || "OpenCode 操作未完成，请查看运行日志。"; }
