export type CodexRuntimeMode = "path" | "external";
export type CodexRuntimePhase = "stopped" | "starting" | "running" | "failed";

export interface CodexRuntimeConfig {
  mode: CodexRuntimeMode;
  externalExecutable: string | null;
  externalHome: string | null;
  workspaceDir: string | null;
}

export interface CodexRuntimeSnapshot {
  phase: CodexRuntimePhase;
  config: CodexRuntimeConfig;
  url: string | null;
  error: string | null;
  logs: string[];
  pathAvailable: boolean;
  pathExecutable: string | null;
  source: string;
  dataHome: string;
}

export interface CodexApiImportResult {
  provider: string;
  model: string;
  dataHome: string;
}

export const DEFAULT_CODEX_CONFIG: CodexRuntimeConfig = {
  mode: "path",
  externalExecutable: null,
  externalHome: null,
  workspaceDir: null,
};

export const CODEX_PHASE_LABELS: Record<CodexRuntimePhase, string> = {
  stopped: "未启动",
  starting: "启动中",
  running: "运行中",
  failed: "启动失败",
};

export const CODEX_SOURCE = "https://github.com/openai/codex";

export function formatCodexError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "Codex 操作未完成，请查看运行日志。";
}
