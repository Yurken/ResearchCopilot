import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ChatSession } from "@research-copilot/types";
import {
  buildResearchCheckpointPrompt,
  readResearchCheckpointHandoff,
  type ResearchCheckpointHandoff,
} from "../research-context/checkpointHandoff";

export function useCopilotCheckpointHandoffState(locationState: unknown) {
  const [handoff, setHandoff] = useState(() => readResearchCheckpointHandoff(locationState));
  const activeHandoffRef = useRef(handoff);

  useEffect(() => {
    activeHandoffRef.current = handoff;
  }, [handoff]);

  const clearHandoff = useCallback(() => {
    activeHandoffRef.current = null;
    setHandoff(null);
  }, []);

  return { handoff, setHandoff, activeHandoffRef, clearHandoff };
}

interface ApplyCheckpointHandoffOptions {
  handoff: ResearchCheckpointHandoff | null;
  setHandoff: Dispatch<SetStateAction<ResearchCheckpointHandoff | null>>;
  activeHandoffRef: MutableRefObject<ResearchCheckpointHandoff | null>;
  sessionsLoaded: boolean;
  sessions: ChatSession[];
  loadSession: (session: ChatSession) => Promise<ChatSession | undefined>;
  startNewSession: () => void;
  selectInterest: (interestId: string) => void;
  syncSession: (session: ChatSession) => void;
  resetChat: () => void;
  setInput: Dispatch<SetStateAction<string>>;
  markLastSessionRestored: () => void;
}

export function useApplyCopilotCheckpointHandoff({
  handoff,
  setHandoff,
  activeHandoffRef,
  sessionsLoaded,
  sessions,
  loadSession,
  startNewSession,
  selectInterest,
  syncSession,
  resetChat,
  setInput,
  markLastSessionRestored,
}: ApplyCheckpointHandoffOptions) {
  const restoredHandoffRef = useRef<string | null>(null);

  useEffect(() => {
    if (!handoff || !sessionsLoaded) return;
    if (restoredHandoffRef.current === handoff.id) return;
    restoredHandoffRef.current = handoff.id;
    markLastSessionRestored();
    const prompt = buildResearchCheckpointPrompt(handoff);

    const startFromCheckpoint = () => {
      startNewSession();
      resetChat();
      if (handoff.contextType === "interest" && handoff.contextId) {
        selectInterest(handoff.contextId);
      }
      setInput(prompt);
    };

    const candidate = sessions.find(
      (session) => session.id === handoff.sessionId,
    ) ?? ({ id: handoff.sessionId } as ChatSession);

    void loadSession(candidate).then((loaded) => {
      if (activeHandoffRef.current?.id !== handoff.id) return;
      if (!loaded) {
        startFromCheckpoint();
        return;
      }
      syncSession(loaded);
      setInput(prompt);
    });
  }, [
    activeHandoffRef,
    handoff,
    loadSession,
    markLastSessionRestored,
    resetChat,
    selectInterest,
    sessions,
    sessionsLoaded,
    setInput,
    startNewSession,
    syncSession,
  ]);

  return useCallback(() => {
    if (!handoff) return;
    activeHandoffRef.current = null;
    const prompt = buildResearchCheckpointPrompt(handoff);
    setInput((input) => input === prompt ? "" : input);
    setHandoff(null);
  }, [activeHandoffRef, handoff, setHandoff, setInput]);
}
