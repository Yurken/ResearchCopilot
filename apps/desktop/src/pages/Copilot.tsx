import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import CopilotComposer from "../features/copilot/CopilotComposer";
import CopilotOverviewSidebar from "../features/copilot/CopilotOverviewSidebar";
import { CopilotChatArea } from "../features/copilot/CopilotChatArea";
import { CopilotSessionSidebar } from "../features/copilot/CopilotSessionSidebar";
import SkillVariableFillModal from "../features/copilot/SkillVariableFillModal";
import { COPILOT_LAST_SESSION_KEY, useCopilotSessions } from "../features/copilot/useCopilotSessions";
import { useCopilotChat } from "../features/copilot/useCopilotChat";
import { useCopilotAttachments } from "../features/copilot/useCopilotAttachments";
import { useCopilotChatMode } from "../features/copilot/useCopilotChatMode";
import { useCopilotDropZone } from "../features/copilot/useCopilotDropZone";
import { parseCopilotMessageContent } from "../features/copilot/shared";
import { clearPersistentValue, readPersistentValue, usePersistentStringState, writePersistentValue } from "../hooks/usePersistentStringState";
import { apiClient, formatErrorMessage } from "../lib/client";
import { openLink } from "../lib/links";
import type { AgentRun, ChatSession, Skill } from "@research-copilot/types";
import { interestFolderName } from "../lib/interestUtils";
import CopilotContextBar from "../features/copilot/CopilotContextBar";
import {
  consumeCopilotPaperHandoff,
  removeCopilotHandoffDetail,
  type CopilotHandoffDetail,
} from "../features/copilot/copilotHandoff";
import { useCopilotPaperContext } from "../features/copilot/useCopilotPaperContext";
import CopilotCheckpointContextBar from "../features/copilot/CopilotCheckpointContextBar";
import {
  useApplyCopilotCheckpointHandoff,
  useCopilotCheckpointHandoffState,
} from "../features/copilot/useCopilotCheckpointHandoff";

export default function Copilot({ hideFolders = false }: { hideFolders?: boolean }) {
  const location = useLocation();
  const sessionListStorageKey = hideFolders
    ? "rc:copilot:session-list-mode:focus"
    : "rc:copilot:session-list-mode";
  const [sessionListMode, setSessionListMode] = usePersistentStringState<"open" | "collapsed">(
    sessionListStorageKey,
    "open",
    ["open", "collapsed"] as const,
  );
  const sessionListCollapsed = sessionListMode === "collapsed";

  const sessions = useCopilotSessions();
  const [paperHandoff, setPaperHandoff] = useState(() => consumeCopilotPaperHandoff());
  const {
    handoff: checkpointHandoff,
    setHandoff: setCheckpointHandoff,
    activeHandoffRef: activeCheckpointHandoffRef,
    clearHandoff: clearCheckpointHandoff,
  } = useCopilotCheckpointHandoffState(location.state);
  const { chatMode, setChatMode } = useCopilotChatMode();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  // 技能锁定：关闭时（默认）发完一条即清除选中（one-shot）；开启时连续生效。
  const [skillLocked, setSkillLocked] = useState(false);
  const [memoryInput, setMemoryInput] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const memorySavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSessionRequestRef = useRef(0);
  const restoredLastSessionRef = useRef(false);

  const {
    attachments,
    uploading: uploadingAttachments,
    pickFromDrop,
    addImageFiles,
    removeAttachment,
    clearAttachments,
  } = useCopilotAttachments((err) => sessions.setLoadError(err));

  // 拖拽文件到对话列即添加为附件（图片/文档由附件管线区分处理）。
  const chatDropZone = useCopilotDropZone(pickFromDrop);

  const activeContextType = sessions.currentSession?.context_type
    || checkpointHandoff?.contextType
    || paperHandoff?.contextType;
  const activeContextId = sessions.currentSession?.context_id
    || checkpointHandoff?.contextId
    || paperHandoff?.contextId;
  const persistedPaperTitle = useCopilotPaperContext(activeContextType, activeContextId);
  const chat = useCopilotChat({
    currentSession: sessions.currentSession,
    selectedInterestId: sessions.selectedInterestId,
    contextType: activeContextType,
    contextId: activeContextId,
    chatMode,
    skills,
    selectedSkillId,
    attachments,
    clearAttachments,
    onSkillConsumed: () => {
      if (!skillLocked) setSelectedSkillId(null);
    },
    onSessionCreated: async (sessionId: string) => {
      writePersistentValue(COPILOT_LAST_SESSION_KEY, sessionId);
      try {
        const updated = await apiClient.chat.listSessions();
        const nextSession = updated.find((s) => s.id === sessionId) ?? null;
        if (nextSession) {
          // 加入/置顶会话列表，并把新建会话设为当前会话。
          sessions.syncSession(nextSession);
          sessions.setCurrentSession(nextSession);
          return;
        }
      } catch (err) {
        console.warn("Failed to refresh sessions after creation:", err);
      }
      // 兜底：即便列表刷新失败，也要把当前会话锁定到新建的 id，否则下一条消息仍以
      // session_id=null 发送，后端会再建一个新会话，导致同一段对话被拆成多条记录。
      sessions.setCurrentSession((prev) => prev ?? ({ id: sessionId } as ChatSession));
    },
  });

  const appliedPaperHandoffRef = useRef(false);
  useEffect(() => {
    if (!paperHandoff || checkpointHandoff || appliedPaperHandoffRef.current) return;
    appliedPaperHandoffRef.current = true;
    sessions.handleNewChat();
    chat.resetChat();
    chat.setInput(paperHandoff.prompt);
    restoredLastSessionRef.current = true;
  }, [chat, checkpointHandoff, paperHandoff, sessions]);

  const handleLoadSession = useCallback(async (session: ChatSession) => {
    const requestId = loadSessionRequestRef.current + 1;
    loadSessionRequestRef.current = requestId;
    chat.cancelActiveStream();
    const sessionData = await sessions.loadSession(session);
    if (!sessionData || loadSessionRequestRef.current !== requestId) return;
    let runData: AgentRun[] = [];
    try {
      runData = await apiClient.chat.listAgentRuns(session.id);
    } catch (err) {
      console.warn("Failed to load agent runs:", err);
    }
    if (loadSessionRequestRef.current === requestId) {
      chat.restoreLoadedSession(sessionData, runData);
    }
    return sessionData;
  }, [sessions, chat]);

  const markLastSessionRestored = useCallback(() => {
    restoredLastSessionRef.current = true;
  }, []);
  const handleDismissCheckpointHandoff = useApplyCopilotCheckpointHandoff({
    handoff: checkpointHandoff,
    setHandoff: setCheckpointHandoff,
    activeHandoffRef: activeCheckpointHandoffRef,
    sessionsLoaded: sessions.sessionsLoaded,
    sessions: sessions.sessions,
    loadSession: handleLoadSession,
    startNewSession: sessions.handleNewChat,
    selectInterest: sessions.setSelectedInterestId,
    syncSession: sessions.syncSession,
    resetChat: chat.resetChat,
    setInput: chat.setInput,
    markLastSessionRestored,
  });
  const handleReviewCheckpoint = useCallback(async (status: "confirmed" | "corrected" | "withdrawn", note?: string) => {
    if (!checkpointHandoff) return;
    try {
      await apiClient.memory.reviewCheckpoint(checkpointHandoff.id, status, note);
      if (status === "withdrawn") {
        handleDismissCheckpointHandoff();
        return;
      }
      setCheckpointHandoff((current) => current ? { ...current, reviewStatus: status, reviewNote: note ?? current.reviewNote } : current);
    } catch (error) {
      sessions.setLoadError(formatErrorMessage(error));
    }
  }, [checkpointHandoff, handleDismissCheckpointHandoff, sessions, setCheckpointHandoff]);

  // Sync chat reset with session changes
  const handleNewChat = useCallback(() => {
    loadSessionRequestRef.current += 1;
    clearCheckpointHandoff();
    sessions.handleNewChat();
    chat.resetChat();
    setPaperHandoff(null);
  }, [chat, clearCheckpointHandoff, sessions]);

  useEffect(() => {
    if (restoredLastSessionRef.current) return;
    if (checkpointHandoff) return;
    if (paperHandoff) return;
    if (!sessions.sessionsLoaded || sessions.currentSession) return;
    restoredLastSessionRef.current = true;
    const lastSessionId = readPersistentValue(COPILOT_LAST_SESSION_KEY);
    if (!lastSessionId) return;
    const lastSession = sessions.sessions.find((session) => session.id === lastSessionId);
    if (!lastSession) {
      clearPersistentValue(COPILOT_LAST_SESSION_KEY);
      return;
    }
    void handleLoadSession(lastSession);
  }, [checkpointHandoff, handleLoadSession, paperHandoff, sessions.currentSession, sessions.sessions, sessions.sessionsLoaded]);

  const paperContextTitle = activeContextType === "paper"
    ? paperHandoff?.contextLabel || persistedPaperTitle || "当前论文"
    : "";

  const handleRemoveHandoffDetail = useCallback((detail: CopilotHandoffDetail) => {
    setPaperHandoff((current) => {
      if (!current) return current;
      const next = removeCopilotHandoffDetail(current, detail);
      chat.setInput((input) => input === current.prompt ? next.prompt : input);
      return next;
    });
  }, [chat]);

  // Skills
  useEffect(() => {
    apiClient.skills.list().then((data) => {
      // 对话技能选择器展示所有已启用技能；工具技能（如 PPT 生成）走 Tool Registry 执行真实工具。
      setSkills(data.filter((s) => s.is_enabled));
    }).catch((err) => { console.warn("Failed to load skills:", err); });
  }, []);

  // Cleanup：仅在卸载时取消进行中的流。
  // 注意 deps 必须是稳定的 cancelActiveStream，不能用整个 chat 对象——
  // useCopilotChat 每次渲染都返回新对象，若依赖 [chat] 会在每次重渲染时执行上一次的清理，
  // 把刚发起的请求 abort 掉（表现为只发 chat_cancel、不发 chat_stream）。
  const cancelActiveStream = chat.cancelActiveStream;
  useEffect(() => {
    return () => {
      cancelActiveStream();
      if (memorySavedTimerRef.current) clearTimeout(memorySavedTimerRef.current);
    };
  }, [cancelActiveStream]);

  // Copy handler
  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) { console.warn("Clipboard write failed:", err); }
  };

  // Edit handlers：编辑时只暴露可读正文（去掉附件编码），保存即截断其后消息并以新正文重发。
  const handleStartEdit = (message: { id: string; content: string }) => {
    setEditingMessageId(message.id);
    setEditText(parseCopilotMessageContent(message.content).text);
  };
  const handleSaveEdit = () => {
    const id = editingMessageId;
    const text = editText;
    setEditingMessageId(null);
    setEditText("");
    if (id && text.trim()) chat.editAndResend(id, text);
  };
  const handleCancelEdit = () => { setEditingMessageId(null); setEditText(""); };

  // Save memory
  const handleSaveMemory = async () => {
    if (!memoryInput.trim() || savingMemory) return;
    setSavingMemory(true);
    try {
      await apiClient.memory.add({ type: "manual", summary: memoryInput.trim() });
      setMemoryInput("");
      setMemorySaved(true);
      if (memorySavedTimerRef.current) clearTimeout(memorySavedTimerRef.current);
      memorySavedTimerRef.current = setTimeout(() => setMemorySaved(false), 3000);
    } catch (error) {
      sessions.setLoadError(formatErrorMessage(error));
    } finally {
      setSavingMemory(false);
    }
  };

  // Session groups for sidebar
  const sessionGroups = useMemo(() => {
    return sessions.interests.map((interest) => ({
      key: interest.id,
      title: interestFolderName(interest),
      subtitle: interestFolderName(interest) !== interest.topic ? `研究主题：${interest.topic}` : undefined,
      sessions: sessions.sessions.filter(
        (s) => s.context_type === "interest" && s.context_id === interest.id
      ),
    }));
  }, [sessions.interests, sessions.sessions]);

  const ungroupedSessions = useMemo(
    () => sessions.sessions.filter((s) => s.context_type !== "interest" || !s.context_id),
    [sessions.sessions]
  );

  // Displayed runs for artifacts
  const displayedRuns = useMemo(() => {
    return [...chat.agentRuns].sort((a, b) => a.order_index - b.order_index);
  }, [chat.agentRuns]);

  const artifacts = useMemo(() => {
    return displayedRuns.flatMap((run) => run.artifacts ?? []);
  }, [displayedRuns]);
  const contextMenu = sessions.contextMenu;

  return (
    <>
      <div className="relative flex h-full overflow-hidden" style={{ background: "var(--rc-surface)" }}>
        <CopilotSessionSidebar
          sessions={sessions.sessions}
          interests={sessions.interests}
          currentSession={sessions.currentSession}
          selectedInterestId={sessions.selectedInterestId}
          sessionListCollapsed={sessionListCollapsed}
          sessionGroups={sessionGroups}
          ungroupedSessions={ungroupedSessions}
          hideFolders={hideFolders}
          renamingId={sessions.renamingId}
          renameTitle={sessions.renameTitle}
          menuSessionId={sessions.menuSessionId}
          onNewChat={handleNewChat}
          onSelectInterest={sessions.setSelectedInterestId}
          onToggleCollapse={() => setSessionListMode("collapsed")}
          onLoadSession={handleLoadSession}
          onContextMenu={(e, session) => {
            e.preventDefault();
            sessions.setContextMenu({ x: e.clientX, y: e.clientY, session });
          }}
          onMenuToggle={sessions.setMenuSessionId}
          onPinSession={sessions.handlePinSession}
          onStartRename={sessions.startRename}
          onDeleteSession={sessions.handleDeleteSession}
          onRenameTitleChange={sessions.setRenameTitle}
          onCommitRename={sessions.commitRename}
          onCancelRename={sessions.cancelRename}
        />

        <div className="flex-1 min-w-0 flex overflow-hidden">
          <div ref={chatDropZone.zoneRef} className="flex-1 flex flex-col min-w-0 bg-nm-bg relative">
            {chatDropZone.isOver && (
              <div
                className="absolute inset-3 z-40 flex items-center justify-center rounded-3xl"
                style={{ background: "rgba(0,122,255,0.08)", border: "2px dashed #007AFF", pointerEvents: "none" }}
              >
                <span className="text-lg font-semibold" style={{ color: "#007AFF" }}>释放文件，添加到对话</span>
              </div>
            )}
            {sessionListCollapsed && (
              <button
                type="button"
                aria-label="展开会话列表"
                onClick={() => setSessionListMode("open")}
                className="absolute top-3 left-3 z-10 flex h-9 w-9 items-center justify-center rounded-2xl text-ink-tertiary transition-colors hover:text-ink-primary"
                style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-chip-shadow)" }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {activeContextType === "paper" && activeContextId ? (
              <CopilotContextBar
                paperTitle={paperContextTitle}
                handoff={paperHandoff}
                onRemovePage={() => handleRemoveHandoffDetail("page")}
                onRemoveSelection={() => handleRemoveHandoffDetail("selection")}
              />
            ) : null}

            {checkpointHandoff ? (
              <CopilotCheckpointContextBar
                handoff={checkpointHandoff}
                onDismiss={handleDismissCheckpointHandoff}
                onReview={(status, note) => void handleReviewCheckpoint(status, note)}
              />
            ) : null}

            <CopilotChatArea
              messages={chat.messages}
              chatMode={chatMode}
              agentRuns={chat.agentRuns}
              plan={chat.plan}
              routingDecision={chat.routingDecision}
              activeAssistantId={chat.activeAssistantId}
              sending={chat.sending}
              searchingQuery={chat.searchingQuery}
              loadError={sessions.loadError || chat.loadError}
              editingMessageId={editingMessageId}
              editText={editText}
              copiedId={copiedId}
              sessionId={sessions.currentSession?.id}
              onClearError={() => { sessions.setLoadError(""); chat.setLoadError(""); }}
              onCopy={handleCopy}
              onRetry={chat.retry}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onEditTextChange={setEditText}
            />

            <CopilotComposer
              chatMode={chatMode}
              onChatModeChange={(mode) => {
                setChatMode(mode);
                if (mode === "task" && chat.messages.length > 0) {
                  chat.setSidebarCollapsed(false);
                }
              }}
              input={chat.input}
              onInputChange={chat.setInput}
              onSubmit={chat.handleSend}
              onCancel={chat.stopGenerating}
              sending={chat.sending}
              uploadingAttachments={uploadingAttachments}
              attachments={attachments}
              onPasteImages={addImageFiles}
              removeAttachment={removeAttachment}
              skills={skills}
              selectedSkillId={selectedSkillId}
              onSelectedSkillChange={setSelectedSkillId}
              skillLocked={skillLocked}
              onSkillLockedChange={setSkillLocked}
            />
          </div>
        </div>

        <CopilotOverviewSidebar
          plan={chat.plan}
          runs={displayedRuns}
          sending={chat.sending}
          updatingSessionContext={sessions.updatingSessionContext}
          artifacts={artifacts}
          memoryInput={memoryInput}
          memorySaved={memorySaved}
          savingMemory={savingMemory}
          onMemoryInputChange={(value) => { setMemoryInput(value); setMemorySaved(false); }}
          onSaveMemory={handleSaveMemory}
          onArtifactLinkClick={openLink}
          collapsed={chat.sidebarCollapsed}
          onCollapsedChange={chat.setSidebarCollapsed}
        />
      </div>

      {chat.pendingSkillFill && (
        <SkillVariableFillModal
          pending={chat.pendingSkillFill}
          onConfirm={(values) => void chat.confirmSkillFill(values)}
          onCancel={chat.cancelSkillFill}
        />
      )}

      {/* 会话右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-2xl py-1.5 text-xs"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: "var(--rc-elevated)",
            boxShadow: "var(--rc-chip-shadow)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">
            移动到主页
          </div>
          <button
            className="w-full px-3 py-1.5 text-left text-ink-secondary transition-colors hover:bg-nm-dark/8 hover:text-ink-primary"
            onClick={() => void sessions.handleMoveSession(contextMenu.session, "")}
          >
            未归类
          </button>
          {sessions.interests.map((interest) => (
            <button
              key={interest.id}
              className="w-full px-3 py-1.5 text-left text-ink-secondary transition-colors hover:bg-nm-dark/8 hover:text-ink-primary"
              onClick={() => void sessions.handleMoveSession(contextMenu.session, interest.id)}
            >
              {interestFolderName(interest)}
            </button>
          ))}
          <div className="my-1 border-t border-nm-dark/10" />
          <button
            className="w-full px-3 py-1.5 text-left text-apple-red transition-colors hover:bg-apple-red/8"
            onClick={() => {
              void sessions.handleDeleteSession(contextMenu.session.id);
              sessions.setContextMenu(null);
            }}
          >
            删除对话
          </button>
        </div>
      )}
    </>
  );
}
