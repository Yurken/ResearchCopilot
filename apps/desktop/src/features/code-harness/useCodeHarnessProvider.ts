import { useCallback, useEffect, useState } from "react";
import {
  CODE_HARNESS_PROVIDER_CHANGE_EVENT,
  persistCodeHarnessProvider,
  readCodeHarnessProvider,
  type CodeHarnessProvider,
} from "./shared";

export function useCodeHarnessProvider() {
  const [provider, setProviderState] = useState<CodeHarnessProvider>(readCodeHarnessProvider);

  useEffect(() => {
    const sync = () => setProviderState(readCodeHarnessProvider());
    window.addEventListener(CODE_HARNESS_PROVIDER_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CODE_HARNESS_PROVIDER_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setProvider = useCallback((next: CodeHarnessProvider) => {
    persistCodeHarnessProvider(next);
    setProviderState(next);
  }, []);

  return { provider, setProvider };
}
