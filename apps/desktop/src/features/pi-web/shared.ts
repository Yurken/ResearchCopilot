export type PiWebRuntimeMode = "bundled" | "path" | "external";
export type PiWebRuntimePhase = "stopped" | "starting" | "running" | "failed";

export interface PiWebRuntimeConfig {
  mode: PiWebRuntimeMode;
  externalExecutable: string | null;
  agentDir: string | null;
  workspaceDir: string | null;
}

export interface PiWebRuntimeSnapshot {
  phase: PiWebRuntimePhase;
  config: PiWebRuntimeConfig;
  url: string | null;
  error: string | null;
  logs: string[];
  bundledAvailable: boolean;
  bundledExecutable: string | null;
  pathAvailable: boolean;
  pathExecutable: string | null;
  source: string;
  dataHome: string;
}

export const DEFAULT_PI_WEB_CONFIG: PiWebRuntimeConfig = {
  mode: "bundled",
  externalExecutable: null,
  agentDir: null,
  workspaceDir: null,
};

export const PI_WEB_PHASE_LABELS: Record<PiWebRuntimePhase, string> = {
  stopped: "未启动",
  starting: "启动中",
  running: "运行中",
  failed: "启动失败",
};

export function formatPiWebError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "Pi 操作未完成，请查看运行日志。";
}
