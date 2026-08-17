import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_DSH_CONFIG,
  formatDshError,
  type DshApiImportResult,
  type DshRuntimeConfig,
  type DshRuntimeSnapshot,
} from "./shared";

export function useDeepSeekHarnessRuntime() {
  const [snapshot, setSnapshot] = useState<DshRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [apiImportResult, setApiImportResult] = useState<DshApiImportResult | null>(null);
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
      const next = await invoke<DshRuntimeSnapshot>("dsh_runtime_status");
      if (sequence === requestSequence.current) {
        setSnapshot(next);
        setError("");
      }
      return next;
    } catch (cause) {
      if (sequence === requestSequence.current) setError(formatDshError(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!snapshot || !["starting", "running"].includes(snapshot.phase)) return;
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(interval);
  }, [refresh, snapshot]);

  const perform = useCallback(async (
    action: () => Promise<DshRuntimeSnapshot>,
  ) => {
    const sequence = ++requestSequence.current;
    beginOperation();
    setError("");
    try {
      const next = await action();
      if (sequence === requestSequence.current) setSnapshot(next);
      return next;
    } catch (cause) {
      const message = formatDshError(cause);
      if (sequence === requestSequence.current) setError(message);
      return null;
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation]);

  const configure = useCallback((config: DshRuntimeConfig) => perform(
    () => invoke<DshRuntimeSnapshot>("dsh_runtime_configure", { config }),
  ), [perform]);

  const start = useCallback(() => perform(
    () => invoke<DshRuntimeSnapshot>("dsh_runtime_start"),
  ), [perform]);

  const stop = useCallback(() => perform(
    () => invoke<DshRuntimeSnapshot>("dsh_runtime_stop"),
  ), [perform]);

  const saveAndStart = useCallback((config: DshRuntimeConfig) => perform(async () => {
    await invoke<DshRuntimeSnapshot>("dsh_runtime_configure", { config });
    return invoke<DshRuntimeSnapshot>("dsh_runtime_start");
  }), [perform]);

  const restart = useCallback(() => perform(async () => {
    await invoke<DshRuntimeSnapshot>("dsh_runtime_stop");
    return invoke<DshRuntimeSnapshot>("dsh_runtime_start");
  }), [perform]);

  const validateExternal = useCallback(async (executable: string) => {
    const sequence = ++requestSequence.current;
    beginOperation();
    setError("");
    try {
      return await invoke<string>("dsh_runtime_validate_external", { executable });
    } catch (cause) {
      const message = formatDshError(cause);
      if (sequence === requestSequence.current) setError(message);
      throw new Error(message);
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation]);

  const configureAndImportXiaoyanApi = useCallback(async (config: DshRuntimeConfig) => {
    const sequence = ++requestSequence.current;
    beginOperation();
    setError("");
    setApiImportResult(null);
    try {
      const configured = await invoke<DshRuntimeSnapshot>("dsh_runtime_configure", { config });
      const result = await invoke<DshApiImportResult>("dsh_runtime_import_xiaoyan_api");
      if (sequence === requestSequence.current) {
        setSnapshot(configured);
        setApiImportResult(result);
      }
      return result;
    } catch (cause) {
      if (sequence === requestSequence.current) setError(formatDshError(cause));
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
    config: snapshot?.config ?? DEFAULT_DSH_CONFIG,
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
