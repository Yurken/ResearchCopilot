import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type ManagedRuntimeProvider = "codex" | "dsh" | "opencode" | "pi_web";

interface ManagedRuntimeInstall {
  provider: string;
  version: string;
  installedPath: string;
}

function formatDownloadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "运行时下载失败，请稍后重试。";
}

export function useManagedRuntimeDownload(
  provider: ManagedRuntimeProvider,
  onInstalled: () => void | Promise<unknown>,
) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [install, setInstall] = useState<ManagedRuntimeInstall | null>(null);

  const download = useCallback(async () => {
    setDownloading(true);
    setError("");
    try {
      const result = await invoke<ManagedRuntimeInstall>("runtime_download_managed", { provider });
      setInstall(result);
      await onInstalled();
      return result;
    } catch (cause) {
      setError(formatDownloadError(cause));
      return null;
    } finally {
      setDownloading(false);
    }
  }, [onInstalled, provider]);

  return { download, downloading, error, install };
}
