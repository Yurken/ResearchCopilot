export const CODE_HARNESS_PROVIDER_STORAGE_KEY = "rc:code-harness-provider";
export const CODE_HARNESS_PROVIDER_CHANGE_EVENT = "rc:code-harness-provider-change";
export const FLOATING_RUNTIME_CONTROLS_MARGIN = 12;

export const CODE_HARNESS_PROVIDERS = ["dsh", "codex", "opencode", "pi"] as const;

export type CodeHarnessProvider = (typeof CODE_HARNESS_PROVIDERS)[number];

export interface FloatingRuntimeControlsPosition {
  x: number;
  y: number;
}

export interface FloatingRuntimeControlsBounds {
  width: number;
  height: number;
}

export const DEFAULT_CODE_HARNESS_PROVIDER: CodeHarnessProvider = "dsh";

export const CODE_HARNESS_PATHS: Record<CodeHarnessProvider, string> = {
  dsh: "/code",
  codex: "/codex",
  opencode: "/opencode",
  pi: "/pi",
};

export const CODE_HARNESS_LABELS: Record<CodeHarnessProvider, string> = {
  dsh: "DSH",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

export function isCodeHarnessProvider(value: unknown): value is CodeHarnessProvider {
  return CODE_HARNESS_PROVIDERS.some((provider) => provider === value);
}

export function normalizeCodeHarnessProvider(value: unknown): CodeHarnessProvider {
  return isCodeHarnessProvider(value) ? value : DEFAULT_CODE_HARNESS_PROVIDER;
}

export function readCodeHarnessProvider(): CodeHarnessProvider {
  if (typeof window === "undefined") return DEFAULT_CODE_HARNESS_PROVIDER;
  try {
    return normalizeCodeHarnessProvider(window.localStorage.getItem(CODE_HARNESS_PROVIDER_STORAGE_KEY));
  } catch {
    return DEFAULT_CODE_HARNESS_PROVIDER;
  }
}

export function persistCodeHarnessProvider(provider: CodeHarnessProvider) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODE_HARNESS_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // 在受限 WebView 中仍保持本次会话内状态可用。
  }
  window.dispatchEvent(new CustomEvent(CODE_HARNESS_PROVIDER_CHANGE_EVENT, { detail: provider }));
}

export function codeHarnessPath(provider: CodeHarnessProvider): string {
  return CODE_HARNESS_PATHS[provider];
}

export function isCodeHarnessPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return Object.values(CODE_HARNESS_PATHS).includes(normalized);
}

export function floatingRuntimeControlsStorageKey(provider: CodeHarnessProvider): string {
  return `rc:floating-runtime-controls:${provider}`;
}

export function clampFloatingRuntimeControlsPosition(
  position: FloatingRuntimeControlsPosition,
  container: FloatingRuntimeControlsBounds,
  panel: FloatingRuntimeControlsBounds,
  margin = FLOATING_RUNTIME_CONTROLS_MARGIN,
): FloatingRuntimeControlsPosition {
  const maxX = Math.max(margin, container.width - panel.width - margin);
  const maxY = Math.max(margin, container.height - panel.height - margin);
  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  };
}
