import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_PI_WEB_CONFIG,
  formatPiWebError,
  type PiWebRuntimeConfig,
  type PiWebRuntimeSnapshot,
} from "./shared";

export function usePiWebRuntime() {
  const [snapshot, setSnapshot] = useState<PiWebRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
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
    const request = ++sequence.current;
    try {
      const next = await invoke<PiWebRuntimeSnapshot>("pi_web_runtime_status");
      if (request === sequence.current) {
        setSnapshot(next);
        setError("");
      }
      return next;
    } catch (cause) {
      if (request === sequence.current) setError(formatPiWebError(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!snapshot || !["starting", "running"].includes(snapshot.phase)) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot]);

  const perform = useCallback(async (action: () => Promise<PiWebRuntimeSnapshot>) => {
    const request = ++sequence.current;
    beginOperation();
    setError("");
    try {
      const next = await action();
      if (request === sequence.current) setSnapshot(next);
      return next;
    } catch (cause) {
      if (request === sequence.current) setError(formatPiWebError(cause));
      return null;
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation]);

  const saveAndStart = useCallback((config: PiWebRuntimeConfig) => perform(async () => {
    await invoke("pi_web_runtime_configure", { config });
    return invoke<PiWebRuntimeSnapshot>("pi_web_runtime_start");
  }), [perform]);
  const stop = useCallback(() => perform(() => invoke("pi_web_runtime_stop")), [perform]);
  const restart = useCallback(() => perform(async () => {
    await invoke("pi_web_runtime_stop");
    return invoke<PiWebRuntimeSnapshot>("pi_web_runtime_start");
  }), [perform]);
  const validateExternal = useCallback(async (executable: string) => {
    beginOperation();
    setError("");
    try {
      return await invoke<string>("pi_web_runtime_validate_external", { executable });
    } catch (cause) {
      const message = formatPiWebError(cause);
      setError(message);
      throw new Error(message);
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
    config: snapshot?.config ?? DEFAULT_PI_WEB_CONFIG,
    loading,
    busy,
    error,
    refresh,
    saveAndStart,
    stop,
    restart,
    validateExternal,
    chooseFile,
    chooseDirectory,
  };
}
