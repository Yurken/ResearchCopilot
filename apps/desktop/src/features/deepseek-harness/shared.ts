export type DshRuntimeMode = "auto" | "bundled" | "external";
export type DshRuntimePhase = "stopped" | "starting" | "running" | "failed";

export interface DshRuntimeConfig {
  mode: DshRuntimeMode;
  externalExecutable: string | null;
  externalHome: string | null;
  profile: string;
  workspaceDir: string | null;
}

export interface DshRuntimeSnapshot {
  phase: DshRuntimePhase;
  config: DshRuntimeConfig;
  url: string | null;
  error: string | null;
  logs: string[];
  bundledAvailable: boolean;
  pathAvailable: boolean;
  pathExecutable: string | null;
  lockedVersion: string;
  lockedCommit: string;
  nodeRequirement: string;
  source: string;
  dataHome: string;
}

export interface DshApiImportResult {
  route: string;
  protocol: string;
  model: string;
  dataHome: string;
}

export const DEFAULT_DSH_CONFIG: DshRuntimeConfig = {
  mode: "auto",
  externalExecutable: null,
  externalHome: null,
  profile: "web",
  workspaceDir: null,
};

export const DSH_PHASE_LABELS: Record<DshRuntimePhase, string> = {
  stopped: "未启动",
  starting: "启动中",
  running: "运行中",
  failed: "启动失败",
};

export function formatDshError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "DSH 操作未完成，请查看运行日志。";
}
