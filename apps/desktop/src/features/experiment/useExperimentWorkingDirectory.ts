import { useCallback, useEffect, useRef } from "react";
import { readPersistentValue, usePersistentState } from "../../hooks/usePersistentStringState";
import { experimentApi, formatErrorMessage } from "../../lib/client";

const WORKING_DIRECTORIES_KEY = "rc:experiment:code:working-dirs";

function readLegacyDirectory(key: string): string | null | undefined {
  const raw = readPersistentValue(key);
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === "string" || value === null ? value : undefined;
  } catch {
    return raw || undefined;
  }
}

export function useExperimentWorkingDirectory(
  experimentId: string | null,
  defaultWorkingDir: string | null,
  onSyncError?: (message: string) => void,
) {
  const [directories, setDirectories] = usePersistentState<Record<string, string | null>>(
    WORKING_DIRECTORIES_KEY,
    {},
  );
  const syncSequenceRef = useRef(0);

  const syncWorkingDirectory = useCallback((directory: string | null) => {
    if (!experimentId) return;
    const sequence = ++syncSequenceRef.current;
    void experimentApi.update(experimentId, { defaultWorkingDir: directory ?? "" })
      .catch((error) => {
        if (sequence === syncSequenceRef.current) {
          onSyncError?.(`工作目录已保存在本机，但数据库同步失败：${formatErrorMessage(error)}`);
        }
      });
  }, [experimentId, onSyncError]);

  useEffect(() => {
    syncSequenceRef.current += 1;
  }, [experimentId]);

  const hasStoredDirectory = experimentId
    ? Object.prototype.hasOwnProperty.call(directories, experimentId)
    : false;
  const workingDir = experimentId && hasStoredDirectory
    ? directories[experimentId] ?? null
    : defaultWorkingDir;

  useEffect(() => {
    if (!experimentId || hasStoredDirectory) return;
    const legacy = readLegacyDirectory(`rc:experiment:${experimentId}:code:working-dir`)
      ?? readLegacyDirectory("rc:experiment:code:working-dir")
      ?? defaultWorkingDir;
    if (legacy !== undefined) {
      setDirectories((current) => ({ ...current, [experimentId]: legacy ?? null }));
      if ((legacy ?? null) !== defaultWorkingDir) syncWorkingDirectory(legacy ?? null);
    }
  }, [defaultWorkingDir, experimentId, hasStoredDirectory, setDirectories, syncWorkingDirectory]);

  const setWorkingDir = useCallback((directory: string | null) => {
    if (!experimentId) return;
    setDirectories((current) => ({ ...current, [experimentId]: directory }));
    syncWorkingDirectory(directory);
  }, [experimentId, setDirectories, syncWorkingDirectory]);

  return [workingDir, setWorkingDir] as const;
}
