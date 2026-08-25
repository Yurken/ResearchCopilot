import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_CODEX_CONFIG,
  formatCodexError,
  type CodexApiImportResult,
  type CodexRuntimeConfig,
  type CodexRuntimeSnapshot,
} from "./shared";

export function useCodexRuntime() {
  const [snapshot, setSnapshot] = useState<CodexRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [apiImportResult, setApiImportResult] = useState<CodexApiImportResult | null>(null);
  const requestSequence = useRef(0);
  const pendingOperations = useRef(0);

  const beginOperation = useCallback(() => {
    pendingOperations.current += 1;
    setBusy(true);
  }, []);

  const endOperation = useCallback(() => {
    pendingOperations.current = Math.max(0, pendingOperations.current - 1);
    if (pendingOperations.current === 0) setBusy(false);
  }, []);

  const refresh = useCallback(async () => {
    if (pendingOperations.current > 0) return null;
    const sequence = ++requestSequence.current;
    try {
      const next = await invoke<CodexRuntimeSnapshot>("codex_runtime_status");
      if (sequence === requestSequence.current) {
        setSnapshot(next);
        setError("");
      }
      return next;
    } catch (cause) {
      if (sequence === requestSequence.current) setError(formatCodexError(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!snapshot) return;
    const missingRuntime = snapshot.phase === "stopped" && !snapshot.pathAvailable;
    if (!["starting", "running"].includes(snapshot.phase) && !missingRuntime) return;
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(interval);
  }, [refresh, snapshot]);

  const perform = useCallback(async (
    action: () => Promise<CodexRuntimeSnapshot>,
  ) => {
    const sequence = ++requestSequence.current;
    beginOperation();
    setError("");
    try {
      const next = await action();
      if (sequence === requestSequence.current) setSnapshot(next);
      return next;
    } catch (cause) {
      const message = formatCodexError(cause);
      if (sequence === requestSequence.current) setError(message);
      return null;
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation]);

  const configure = useCallback((config: CodexRuntimeConfig) => perform(
    () => invoke<CodexRuntimeSnapshot>("codex_runtime_configure", { config }),
  ), [perform]);

  const start = useCallback(() => perform(
    () => invoke<CodexRuntimeSnapshot>("codex_runtime_start"),
  ), [perform]);

  const stop = useCallback(() => perform(
    () => invoke<CodexRuntimeSnapshot>("codex_runtime_stop"),
  ), [perform]);

  const saveAndStart = useCallback((config: CodexRuntimeConfig) => perform(async () => {
    await invoke<CodexRuntimeSnapshot>("codex_runtime_configure", { config });
    return invoke<CodexRuntimeSnapshot>("codex_runtime_start");
  }), [perform]);

  const restart = useCallback(() => perform(async () => {
    await invoke<CodexRuntimeSnapshot>("codex_runtime_stop");
    return invoke<CodexRuntimeSnapshot>("codex_runtime_start");
  }), [perform]);

  const validateExternal = useCallback(async (executable: string) => {
    const sequence = ++requestSequence.current;
    beginOperation();
    setError("");
    try {
      return await invoke<string>("codex_runtime_validate_external", { executable });
    } catch (cause) {
      const message = formatCodexError(cause);
      if (sequence === requestSequence.current) setError(message);
      throw new Error(message);
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation]);

  const configureAndImportXiaoyanApi = useCallback(async (config: CodexRuntimeConfig) => {
    const sequence = ++requestSequence.current;
    beginOperation();
    setError("");
    setApiImportResult(null);
    try {
      const configured = await invoke<CodexRuntimeSnapshot>("codex_runtime_configure", { config });
      const result = await invoke<CodexApiImportResult>("codex_runtime_import_xiaoyan_api");
      if (sequence === requestSequence.current) {
        setSnapshot(configured);
        setApiImportResult(result);
      }
      return result;
    } catch (cause) {
      if (sequence === requestSequence.current) setError(formatCodexError(cause));
      return null;
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation]);

  const chooseFile = useCallback(async (title: string) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ title, multiple: false, directory: false });
    return typeof selected === "string" ? selected : null;
  }, []);

  const chooseDirectory = useCallback(async (title: string) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ title, multiple: false, directory: true });
    return typeof selected === "string" ? selected : null;
  }, []);

  return {
    snapshot,
    config: snapshot?.config ?? DEFAULT_CODEX_CONFIG,
    loading,
    busy,
    error,
    apiImportResult,
    refresh,
    configure,
    start,
    stop,
    saveAndStart,
    restart,
    validateExternal,
    configureAndImportXiaoyanApi,
    clearApiImportResult: () => setApiImportResult(null),
    chooseFile,
    chooseDirectory,
  };
}
