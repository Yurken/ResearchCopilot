import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearPersistentValue,
  readPersistentValue,
  writePersistentValue,
} from "../../hooks/usePersistentStringState";
import { apiClient, formatErrorMessage } from "../../lib/client";
import type { ChatSession, ResearchInterest } from "@research-copilot/types";

export const COPILOT_LAST_SESSION_KEY = "rc:copilot:last-session-id";

export function useCopilotSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [interests, setInterests] = useState<ResearchInterest[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedInterestId, setSelectedInterestId] = useState("");
  const [updatingSessionContext, setUpdatingSessionContext] = useState(false);
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: ChatSession } | null>(null);
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const loadSessionRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    setSessionsLoaded(false);
    apiClient.chat.listSessions()
      .then((data) => {
        if (!cancelled) {
          setSessions(data);
          setSessionsLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(formatErrorMessage(error));
          setSessions([]);
          setSessionsLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.knowledge.listInterests()
      .then((data) => { if (!cancelled) setInterests(data); })
      .catch(() => { if (!cancelled) setInterests([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!menuSessionId) return;
    const handler = () => setMenuSessionId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuSessionId]);

  // 置顶优先、其余保持现有相对顺序（后端列表本身按 pinned DESC, updated_at DESC 排列）。
  const sortSessionsByPin = (list: ChatSession[]) =>
    [...list].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

  const syncSession = (updatedSession: ChatSession) => {
    setSessions((prev) => {
      const existing = prev.find((s) => s.id === updatedSession.id);
      // 合并既有条目：上游返回的对象可能缺少 pinned 等字段，避免覆盖丢失。
      const merged = existing ? { ...existing, ...updatedSession } : updatedSession;
      return sortSessionsByPin([merged, ...prev.filter((s) => s.id !== updatedSession.id)]);
    });
    setCurrentSession((prev) => (prev?.id === updatedSession.id ? { ...prev, ...updatedSession } : prev));
  };

  const handleNewChat = () => {
    loadSessionRequestRef.current += 1;
    clearPersistentValue(COPILOT_LAST_SESSION_KEY);
    setCurrentSession(null);
    setLoadError("");
  };

  const handleMoveSession = async (session: ChatSession, interestId: string) => {
    setContextMenu(null);
    try {
      const updated = await apiClient.chat.updateSessionContext(session.id, interestId || undefined);
      syncSession(updated);
      if (currentSession?.id === session.id) setSelectedInterestId(interestId);
    } catch (error) {
      setLoadError(formatErrorMessage(error));
    }
  };

  const loadSession = useCallback(async (session: ChatSession) => {
    const requestId = loadSessionRequestRef.current + 1;
    loadSessionRequestRef.current = requestId;
    try {
      setLoadError("");
      const sessionData = await apiClient.chat.getSession(session.id);
      if (loadSessionRequestRef.current !== requestId) {
        return null;
      }
      setCurrentSession(sessionData);
      writePersistentValue(COPILOT_LAST_SESSION_KEY, sessionData.id);
      setSelectedInterestId(
        sessionData.context_type === "interest" && sessionData.context_id ? sessionData.context_id : ""
      );
      return sessionData;
    } catch (error) {
      if (loadSessionRequestRef.current === requestId) {
        setLoadError(formatErrorMessage(error));
      }
      return null;
    }
  }, []);

  const handleSessionInterestChange = async (nextInterestId: string) => {
    const previousInterestId = selectedInterestId;
    setSelectedInterestId(nextInterestId);
    if (!currentSession) return;
    try {
      setUpdatingSessionContext(true);
      setLoadError("");
      const updatedSession = await apiClient.chat.updateSessionContext(currentSession.id, nextInterestId || undefined);
      syncSession(updatedSession);
    } catch (error) {
      setSelectedInterestId(previousInterestId);
      setLoadError(formatErrorMessage(error));
    } finally {
      setUpdatingSessionContext(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await apiClient.chat.deleteSession(sessionId);
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      if (currentSession?.id === sessionId) {
        handleNewChat();
      } else if (readPersistentValue(COPILOT_LAST_SESSION_KEY) === sessionId) {
        clearPersistentValue(COPILOT_LAST_SESSION_KEY);
      }
    } catch (error) {
      setLoadError(formatErrorMessage(error));
    }
  };

  // 置顶/取消置顶：乐观更新 UI，写库失败时回滚并提示。
  const handlePinSession = async (sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    const nextPinned = !target.pinned;
    const previous = sessions;
    setSessions(sortSessionsByPin(
      previous.map((s) => (s.id === sessionId ? { ...s, pinned: nextPinned } : s)),
    ));
    try {
      const updated = await apiClient.chat.setSessionPinned(sessionId, nextPinned);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      setCurrentSession((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
    } catch (error) {
      setSessions(previous);
      setLoadError(formatErrorMessage(error));
    }
  };

  const startRename = (session: ChatSession) => {
    setRenamingId(session.id);
    setRenameTitle(session.title || "");
    setMenuSessionId(null);
  };

  // 重命名：乐观更新 UI，写库失败时回滚。标题未变化时不发请求。
  const commitRename = async () => {
    const targetId = renamingId;
    const title = renameTitle.trim();
    setRenamingId(null);
    setRenameTitle("");
    if (!targetId || !title) return;
    const previous = sessions;
    if (previous.find((s) => s.id === targetId)?.title === title) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === targetId ? { ...s, title } : s)),
    );
    try {
      const updated = await apiClient.chat.renameSession(targetId, title);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      setCurrentSession((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
    } catch (error) {
      setSessions(previous);
      setLoadError(formatErrorMessage(error));
    }
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameTitle("");
  };

  const handleDeleteInterestGroup = async (interestId: string, deleteAll: boolean) => {
    try {
      setDeletingGroupId(interestId);
      if (deleteAll) {
        await apiClient.knowledge.deleteInterestBundle(interestId);
        setSessions((prev) =>
          prev.filter((s) => !(s.context_type === "interest" && s.context_id === interestId))
        );
        if (currentSession?.context_type === "interest" && currentSession.context_id === interestId) {
          handleNewChat();
        }
      } else {
        await apiClient.knowledge.deleteInterestOnly(interestId);
        setSessions((prev) =>
          prev.map((s) =>
            s.context_type === "interest" && s.context_id === interestId
              ? { ...s, context_type: "general", context_id: undefined }
              : s
          )
        );
        if (currentSession?.context_type === "interest" && currentSession.context_id === interestId) {
          setCurrentSession((prev) => prev ? { ...prev, context_type: "general", context_id: undefined } : prev);
          setSelectedInterestId("");
        }
      }
      setInterests((prev) => prev.filter((item) => item.id !== interestId));
      setConfirmDeleteGroupId(null);
    } catch (error) {
      setLoadError(formatErrorMessage(error));
    } finally {
      setDeletingGroupId(null);
    }
  };

  return {
    sessions,
    sessionsLoaded,
    interests,
    currentSession,
    setCurrentSession,
    loadError,
    setLoadError,
    selectedInterestId,
    setSelectedInterestId,
    updatingSessionContext,
    confirmDeleteGroupId,
    setConfirmDeleteGroupId,
    deletingGroupId,
    contextMenu,
    setContextMenu,
    menuSessionId,
    setMenuSessionId,
    renamingId,
    renameTitle,
    setRenameTitle,
    syncSession,
    handleNewChat,
    handleMoveSession,
    loadSession,
    handleSessionInterestChange,
    handleDeleteSession,
    handlePinSession,
    startRename,
    commitRename,
    cancelRename,
    handleDeleteInterestGroup,
  };
}
