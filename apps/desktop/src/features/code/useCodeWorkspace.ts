import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "../../hooks/usePersistentStringState";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  codeApi,
  experimentApi,
  formatErrorMessage,
  type CodeSession,
  type CodeMessage,
  type CodePermissionRequest,
  type CodeToolCall,
  type CodeToolResult,
} from "../../lib/client";
import { useCodeFileSystem } from "./useCodeFileSystem";
import { useCodeAttachments } from "./useCodeAttachments";
import { useCodeContextPack } from "./useCodeContextPack";
import { useCodeModelOptions } from "./useCodeModelOptions";
import type { CodeAgentMode, OpenFile } from "./shared";
import { buildCodePromptContent } from "./codeMessageContent";

function generateMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface StreamEvent {
  session_id: string;
  request_id: string;
  chunk: string;
}

interface DoneEvent {
  session_id: string;
  request_id: string;
  message_id: string;
  full_content: string;
  duration_ms: number;
  model?: string | null;
}

interface ErrorEvent {
  session_id: string;
  request_id: string;
  error: string;
}

interface ToolCallEvent {
  session_id: string;
  request_id: string;
  message_id: string;
  tool_call: CodeToolCall;
}

interface ToolResultEvent {
  session_id: string;
  request_id: string;
  message_id: string;
  result: CodeToolResult;
}

type PermissionRequestEvent = CodePermissionRequest;

interface UseCodeWorkspaceOptions {
  workingDir?: string | null;
  onWorkingDirChange?: (dir: string | null) => void;
}

export function useCodeWorkspace(experimentId: string, options?: UseCodeWorkspaceOptions) {
  // ── File system ──────────────────────────────────────────────
  const fs = useCodeFileSystem();
  const isControlled = options?.workingDir !== undefined;
  const [internalWorkingDir, setInternalWorkingDir] = usePersistentState<string | null>(
    `rc:experiment:${experimentId}:code:working-dir`,
    null,
  );
  const workingDir = isControlled ? options.workingDir : internalWorkingDir;
  const setWorkingDir = isControlled
    ? (dir: string | null) => options.onWorkingDirChange?.(dir)
    : setInternalWorkingDir;
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const workingDirRestoredRef = useRef<string | null>(null);
  const defaultDirAutoRestoredRef = useRef(false);

  // ── Chat ─────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<CodeSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [input, setInput] = useState("");
  const [toast, setToast] = useState("");
  const [agentMode, setAgentMode] = useState<CodeAgentMode>("build");
  const [permissionRequests, setPermissionRequests] = useState<CodePermissionRequest[]>([]);

  const streamingRef = useRef("");
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  // ── UI ───────────────────────────────────────────────────────
  const recentWorkingDirs = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    for (const s of sorted) {
      if (s.working_dir && !seen.has(s.working_dir)) {
        seen.add(s.working_dir);
        result.push(s.working_dir);
      }
    }
    return result;
  }, [sessions]);

  const [treeOpen, setTreeOpen] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const attachmentsController = useCodeAttachments({ onToast: showToast });
  const modelOptionsController = useCodeModelOptions({ onToast: showToast });
  const contextPack = useCodeContextPack({
    workingDir,
    currentFile: openFile?.path ?? null,
    onInputChange: setInput,
    onToast: showToast,
  });

  // 让事件回调始终读到最新 selectedId，避免重复注册监听。
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // ── Event listeners（仅注册一次）─────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function setup() {
      const unlistenStream = await listen<StreamEvent>("code:stream", (event) => {
        if (!mounted || event.payload.session_id !== selectedIdRef.current) return;
        if (!requestIdRef.current) {
          requestIdRef.current = event.payload.request_id;
          setRequestId(event.payload.request_id);
        }
        streamingRef.current += event.payload.chunk;
        setStreamingContent(streamingRef.current);
      });

      const unlistenDone = await listen<DoneEvent>("code:done", (event) => {
        if (!mounted || event.payload.session_id !== selectedIdRef.current) return;
        const { session_id, message_id, full_content, duration_ms, model } = event.payload;

        const assistantMsg: CodeMessage = {
          id: message_id,
          role: "assistant",
          content: full_content,
          tool_calls: undefined,
          tool_results: undefined,
          tool_call_id: null,
          tool_id: null,
          model: model ?? null,
          duration_ms,
          created_at: new Date().toISOString(),
        };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === session_id
              ? {
                  ...s,
                  model: model ?? s.model,
                  messages: [...s.messages, assistantMsg],
                  updated_at: new Date().toISOString(),
                }
              : s,
          ),
        );

        streamingRef.current = "";
        setStreamingContent("");
        setSending(false);
        setTaskStartedAt(null);
        setRequestId(null);
        requestIdRef.current = null;
      });

      const unlistenToolCall = await listen<ToolCallEvent>("code:tool_call", (event) => {
        if (!mounted || event.payload.session_id !== selectedIdRef.current) return;
        const { session_id, message_id, tool_call } = event.payload;

        streamingRef.current = "";
        setStreamingContent("");

        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== session_id) return s;
            const messages = [...s.messages];
            const existingIndex = messages.findIndex((msg) => msg.id === message_id);

            if (existingIndex >= 0) {
              const existing = messages[existingIndex];
              const toolCalls = existing.tool_calls ?? [];
              const alreadyPresent = toolCalls.some((item) => item.id === tool_call.id);
              messages[existingIndex] = {
                ...existing,
                tool_calls: alreadyPresent ? toolCalls : [...toolCalls, tool_call],
              };
            } else {
              messages.push({
                id: message_id,
                role: "assistant",
                content: "",
                tool_calls: [tool_call],
                tool_results: undefined,
                tool_call_id: null,
                tool_id: null,
                model: null,
                created_at: new Date().toISOString(),
              });
            }

            return { ...s, messages, updated_at: new Date().toISOString() };
          }),
        );
      });

      const unlistenToolResult = await listen<ToolResultEvent>("code:tool_result", (event) => {
        if (!mounted || event.payload.session_id !== selectedIdRef.current) return;
        const { session_id, message_id, result } = event.payload;

        const toolMsg: CodeMessage = {
          id: message_id,
          role: "tool",
          content: result.output,
          tool_calls: undefined,
          tool_results: [result],
          tool_call_id: result.tool_call_id,
          tool_id: null,
          model: null,
          created_at: new Date().toISOString(),
        };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === session_id
              ? {
                  ...s,
                  messages: [...s.messages, toolMsg],
                  updated_at: new Date().toISOString(),
                }
              : s,
          ),
        );
      });

      const unlistenError = await listen<ErrorEvent>("code:error", (event) => {
        if (!mounted || event.payload.session_id !== selectedIdRef.current) return;
        showToast(event.payload.error);
        streamingRef.current = "";
        setStreamingContent("");
        setSending(false);
        setTaskStartedAt(null);
        setRequestId(null);
        requestIdRef.current = null;
      });

      const unlistenPermission = await listen<PermissionRequestEvent>("code:permission_request", (event) => {
        if (!mounted || event.payload.session_id !== selectedIdRef.current) return;
        setPermissionRequests((prev) => {
          if (prev.some((item) => item.id === event.payload.id)) return prev;
          return [...prev, event.payload];
        });
      });

      const unlistenTitle = await listen<{ session_id: string }>("code:title_changed", (_event) => {
        if (!mounted) return;
        void codeApi
          .listSessions(experimentId)
          .then((result) => {
            if (mounted) setSessions(result.sessions ?? []);
          })
          .catch((err) => {
            console.warn("Failed to load code sessions:", err);
          });
      });

      unlistenersRef.current = [
        unlistenStream,
        unlistenDone,
        unlistenToolCall,
        unlistenToolResult,
        unlistenError,
        unlistenPermission,
        unlistenTitle,
      ];
    }

    setup();
    return () => {
      mounted = false;
      cancelActiveStream();
      unlistenersRef.current.forEach((fn) => fn());
      unlistenersRef.current = [];
    };
  }, [experimentId]);

  // 恢复/同步工作目录：当 workingDir 变化时重新加载文件树；
  // 非受控模式下只在初始化时从 experiment 的 defaultWorkingDir 自动恢复一次。
  useEffect(() => {
    if (workingDirRestoredRef.current === workingDir) return;

    async function restore() {
      if (workingDir) {
        workingDirRestoredRef.current = workingDir;
        await fs.listDir(workingDir);
        return;
      }

      // workingDir 被显式清空时，同步清空文件树。
      workingDirRestoredRef.current = null;
      fs.setEntries([]);

      if (isControlled || defaultDirAutoRestoredRef.current) return;

      try {
        const exp = await experimentApi.get(experimentId);
        if (exp.defaultWorkingDir) {
          setInternalWorkingDir(exp.defaultWorkingDir);
          await fs.listDir(exp.defaultWorkingDir);
        }
      } catch {
        // 离线或 experiment 不存在时忽略
      }
    }

    // 标记已做过初始化恢复判断，避免用户手动清空后被再次覆盖。
    defaultDirAutoRestoredRef.current = true;
    void restore();
  }, [isControlled, experimentId, workingDir, fs, setInternalWorkingDir]);

  // ── Load sessions ────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const result = await codeApi.listSessions(experimentId);
      setSessions(result.sessions ?? []);
    } catch (err) {
      console.warn("Failed to load code sessions:", err);
    }
  }, [experimentId]);

  useEffect(() => {
    setChatLoading(true);
    loadSessions().finally(() => setChatLoading(false));
  }, [loadSessions]);

  // ── Working directory ────────────────────────────────────────
  async function chooseWorkingDir() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true });
      if (picked && typeof picked === "string") {
        changeWorkingDir(picked);
      }
    } catch (err) {
      showToast(formatErrorMessage(err));
    }
  }

  function changeWorkingDir(dir: string | null) {
    setWorkingDir(dir);
    if (dir) {
      void fs.listDir(dir);
    }
  }

  // ── File operations ──────────────────────────────────────────
  async function openFileByPath(path: string, name: string) {
    const content = await fs.readFile(path);
    if (content !== null) {
      setOpenFile({ path, name, content, originalContent: content, dirty: false });
    }
  }

  function updateFileContent(value: string) {
    setOpenFile((prev) => (prev ? { ...prev, content: value, dirty: value !== prev.originalContent } : null));
  }

  async function saveOpenFile() {
    if (!openFile || !openFile.dirty) return;
    const ok = await fs.writeFile(openFile.path, openFile.content);
    if (ok) {
      setOpenFile((prev) => (prev ? { ...prev, originalContent: prev.content, dirty: false } : null));
      showToast("文件已保存");
    }
  }

  function closeOpenFile() {
    setOpenFile(null);
  }

  // ── Session operations ───────────────────────────────────────
  async function handleCreateSession() {
    if (creatingSession) return;
    // 当前已选中空会话时，避免重复创建。
    if (selected?.messages.length === 0) return;

    setCreatingSession(true);
    try {
      const session = await codeApi.createSession(experimentId, undefined, workingDir ?? undefined);
      setSessions((prev) => [session, ...prev]);
      setSelectedId(session.id);
    } catch (err) {
      showToast(formatErrorMessage(err));
    } finally {
      setCreatingSession(false);
    }
  }

  async function handleDeleteSession(id: string) {
    try {
      await codeApi.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      showToast(formatErrorMessage(err));
    }
  }

  function selectSession(session: CodeSession) {
    setSelectedId(session.id);
    if (session.working_dir) {
      // Only load the session's working directory without mutating the session's
      // working_dir or reordering the project list.
      changeWorkingDir(session.working_dir);
    }
  }

  // ── Cancel ────────────────────────────────────────────────────
  function cancelActiveStream() {
    const rid = requestIdRef.current;
    if (rid) {
      requestIdRef.current = null;
      setRequestId(null);
      void codeApi.cancelMessage(rid);
    }
    setSending(false);
    setTaskStartedAt(null);
    setPermissionRequests([]);
    streamingRef.current = "";
    setStreamingContent("");
  }

  async function resolvePermission(permissionId: string, approved: boolean, message?: string) {
    setPermissionRequests((prev) => prev.filter((item) => item.id !== permissionId));
    try {
      await codeApi.resolvePermission(permissionId, approved, message);
    } catch (err) {
      showToast(formatErrorMessage(err));
    }
  }

// ── Send ─────────────────────────────────────────────────────
  async function handleSend(skillPrompt?: string) {
    if (!input.trim() || sending) return;
    const rawContent = input.trim();
    setInput("");
    attachmentsController.clearAttachments();
    await sendUserContent(rawContent, { skillPrompt });
  }

  async function sendUserContent(
    rawContent: string,
    options?: { skillPrompt?: string; skipAttachments?: boolean },
  ) {
    if (!rawContent.trim() || sending) return;

    // 取消上一次请求（如果还在进行中）
    cancelActiveStream();

    // 没有会话时自动新建一个，保证「选目录 → 输入 → 发送」开箱即用。
    let targetId = selectedId;
    if (!targetId) {
      try {
        const session = await codeApi.createSession(experimentId, undefined, workingDir ?? undefined);
        setSessions((prev) => [session, ...prev]);
        setSelectedId(session.id);
        selectedIdRef.current = session.id; // 立即同步，避免流式事件被过滤掉
        targetId = session.id;
      } catch (err) {
        showToast(formatErrorMessage(err));
        return;
      }
    }

    const promptContent = buildCodePromptContent({
      displayContent: rawContent,
      skillPrompt: options?.skillPrompt,
      attachments: options?.skipAttachments ? [] : attachmentsController.attachments,
    });

    setSending(true);
    setTaskStartedAt(Date.now());
    setRequestId(null);
    requestIdRef.current = null;
    streamingRef.current = "";
    setStreamingContent("");

    const userMessageId = generateMessageId();
    const userMsg: CodeMessage = {
      id: userMessageId,
      role: "user",
      content: rawContent,
      created_at: new Date().toISOString(),
    };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === targetId
          ? { ...s, messages: [...s.messages, userMsg], updated_at: new Date().toISOString() }
          : s,
      ),
    );

    try {
      await codeApi.sendMessage(
        targetId,
        rawContent,
        promptContent,
        workingDir ?? undefined,
        openFile?.name ?? undefined,
        agentMode,
        userMessageId,
      );
    } catch (err) {
      showToast(formatErrorMessage(err));
      setSending(false);
      setTaskStartedAt(null);
    }
  }

  async function handleEditAndResend(messageId: string, newText: string) {
    if (sending) return;
    const trimmed = newText.trim();
    if (!trimmed) return;

    const session = selected;
    if (!session) return;
    const idx = session.messages.findIndex((m) => m.id === messageId && m.role === "user");
    if (idx < 0) return;

    // 乐观更新：截断本地消息到目标消息之前
    const truncated = session.messages.slice(0, idx);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === session.id
          ? { ...s, messages: truncated, updated_at: new Date().toISOString() }
          : s,
      ),
    );

    try {
      await codeApi.editMessage(session.id, messageId);
    } catch (err) {
      showToast(formatErrorMessage(err));
      // 失败时回滚：重新加载会话
      void codeApi.getSession(session.id).then((s) => {
        setSessions((prev) =>
          prev.map((item) => (item.id === s.id ? s : item)),
        );
      }).catch(() => {});
      return;
    }

    await sendUserContent(trimmed, { skipAttachments: true });
  }

  return {
    // File system
    workingDir,
    setWorkingDir: changeWorkingDir,
    chooseWorkingDir,
    openFile,
    openFileByPath,
    updateFileContent,
    saveOpenFile,
    closeOpenFile,
    fs,

    // Chat
    sessions,
    selected,
    selectedId,
    selectSession,
    chatLoading,
    sending,
    taskStartedAt,
    creatingSession,
    requestId,
    streamingContent,
    input,
    setInput,
    toast,
    permissionRequests,
    resolvePermission,
    handleCreateSession,
    handleDeleteSession,
    handleSend,
    handleEditAndResend,
    cancelActiveStream,
    agentMode,
    setAgentMode,
    attachments: attachmentsController.attachments,
    pickAttachments: attachmentsController.pickAttachments,
    pickFromDrop: attachmentsController.pickFromDrop,
    removeAttachment: attachmentsController.removeAttachment,
    contextPack,

    // Settings / model
    currentModel: modelOptionsController.currentModel,
    modelOptions: modelOptionsController.modelOptions,
    activeModelOptionId: modelOptionsController.activeModelOptionId,
    changeModelOption: modelOptionsController.changeModelOption,
    modelsLoading: modelOptionsController.modelsLoading,
    modelsError: modelOptionsController.modelsError,

    // Working dir
    recentWorkingDirs,
    changeWorkingDir,

    // UI
    treeOpen,
    setTreeOpen,
    chatCollapsed,
    setChatCollapsed,
  };
}
