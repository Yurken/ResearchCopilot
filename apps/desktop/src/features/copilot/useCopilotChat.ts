import { useCallback, useEffect, useRef, useState } from "react";
import {
  applySkillVariables,
  buildCopilotMessageContent,
  buildSkillInjectedText,
  createCopilotMessageId,
  extractSkillVariables,
  upsertAgentRun,
} from "./shared";
import {
  clearCopilotSessionSnapshot,
  type CopilotSessionSnapshot,
  hasCopilotSessionSnapshotContent,
  resolveCopilotSessionState,
  writeCopilotSessionSnapshot,
} from "./copilotSessionState";
import { apiClient, formatErrorMessage } from "../../lib/client";
import { executeToolSkill, ToolSkillNotImplementedError } from "../tools/registry/executeToolSkill";
import type { ToolAttachment, ToolProgress } from "../tools/registry/types";
import type { AgentPlanStep, AgentRun, ChatMessage, ChatMode, ChatSession, RoutingDecision, Skill } from "@research-copilot/types";

const DEFAULT_ATTACHMENT_PROMPT = "请先阅读我上传的文件，并给我一个简洁的重点概览。";

export interface PendingSkillFill {
  skill: Skill;
  rawText: string;
  variables: string[];
}

export interface UseCopilotChatOptions {
  currentSession: ChatSession | null;
  selectedInterestId: string;
  contextType?: string;
  contextId?: string;
  chatMode: ChatMode;
  skills: Skill[];
  selectedSkillId: string | null;
  attachments: ReturnType<typeof import("./useCopilotAttachments").useCopilotAttachments>["attachments"];
  clearAttachments: () => void;
  onSessionCreated: (sessionId: string) => void;
  /** 一次技能注入发送后回调；用于默认 one-shot 时清除选中技能（锁定时由调用方跳过清除）。 */
  onSkillConsumed?: () => void;
}

export function useCopilotChat(options: UseCopilotChatOptions) {
  const {
    currentSession,
    selectedInterestId,
    contextType,
    contextId,
    chatMode,
    skills,
    selectedSkillId,
    attachments,
    clearAttachments,
    onSessionCreated,
    onSkillConsumed,
  } = options;
  const currentSessionId = currentSession?.id ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<AgentPlanStep[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [requestId, setRequestId] = useState<string>();
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [searchingQuery, setSearchingQuery] = useState<string | null>(null);
  const [routingDecision, setRoutingDecision] = useState<RoutingDecision | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [pendingSkillFill, setPendingSkillFill] = useState<PendingSkillFill | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef("");
  const rafRef = useRef(0);
  const skipNextPersistRef = useRef(true);
  const restoredSessionIdRef = useRef<string | null>(null);
  const promotedSessionIdRef = useRef<string | null>(null);
  const snapshotRef = useRef<CopilotSessionSnapshot>({
    messages: [],
    plan: [],
    agentRuns: [],
    requestId: null,
    activeAssistantId: null,
    input: "",
    routingDecision: null,
    sidebarCollapsed: true,
  });
  // 始终指向最新消息列表，供 retry/editAndResend 在点击时读取，避免闭包过期。
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  snapshotRef.current = {
    messages,
    plan,
    agentRuns,
    requestId: requestId ?? null,
    activeAssistantId,
    input,
    routingDecision,
    sidebarCollapsed,
  };

  const applyRestoredState = useCallback(
    (state: ReturnType<typeof resolveCopilotSessionState>) => {
      setMessages(state.messages);
      setPlan(state.plan);
      setAgentRuns(state.agentRuns);
      setRequestId(state.requestId);
      setActiveAssistantId(state.activeAssistantId);
      setInput(state.input);
      setSending(false);
      setLoadError("");
      setSearchingQuery(null);
      setRoutingDecision(state.routingDecision);
      setSidebarCollapsed(state.sidebarCollapsed);
      setPendingSkillFill(null);
    },
    []
  );

  const cancelActiveStream = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  // 用户主动终止时立即退出“生成中”状态；AbortController 仍会向后端发送 chat_cancel，
  // 已经收到的内容保留在当前回答中，避免用户丢失可用的部分结果。
  const stopGenerating = useCallback(() => {
    cancelActiveStream();
    setSending(false);
    setSearchingQuery(null);
    setActiveAssistantId(null);
  }, [cancelActiveStream]);

  const resetChat = useCallback(() => {
    cancelActiveStream();
    skipNextPersistRef.current = true;
    clearCopilotSessionSnapshot();
    setMessages([]);
    setPlan([]);
    setAgentRuns([]);
    setRequestId(undefined);
    setActiveAssistantId(null);
    setInput("");
    setSending(false);
    setLoadError("");
    setSearchingQuery(null);
    setRoutingDecision(null);
    setSidebarCollapsed(true);
    setPendingSkillFill(null);
  }, [cancelActiveStream]);

  const restoreLoadedSession = useCallback(
    (session: Pick<ChatSession, "id" | "messages">, loadedRuns: AgentRun[]) => {
      skipNextPersistRef.current = true;
      applyRestoredState(
        resolveCopilotSessionState({
          sessionId: session.id,
          sessionMessages: session.messages ?? [],
          agentRuns: loadedRuns,
        }),
      );
    },
    [applyRestoredState],
  );

  const promoteDraftSession = useCallback((sessionId: string) => {
    promotedSessionIdRef.current = sessionId;
    const snapshot = snapshotRef.current;
    if (hasCopilotSessionSnapshotContent(snapshot)) {
      writeCopilotSessionSnapshot(sessionId, snapshot);
    }
    clearCopilotSessionSnapshot();
  }, []);

  useEffect(() => {
    if (restoredSessionIdRef.current === currentSessionId) return;
    restoredSessionIdRef.current = currentSessionId;
    const promotedSessionId = promotedSessionIdRef.current;
    const isPromotedDraftSession =
      Boolean(currentSessionId) && promotedSessionId === currentSessionId;
    if (!isPromotedDraftSession) {
      skipNextPersistRef.current = true;
    }
    if (currentSessionId) {
      if (isPromotedDraftSession) {
        promotedSessionIdRef.current = null;
      }
      return;
    }
    promotedSessionIdRef.current = null;
    applyRestoredState(resolveCopilotSessionState());
  }, [applyRestoredState, currentSessionId]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    writeCopilotSessionSnapshot(currentSessionId, snapshotRef.current);
  }, [
    currentSessionId,
    messages,
    plan,
    agentRuns,
    requestId,
    activeAssistantId,
    input,
    routingDecision,
    sidebarCollapsed,
  ]);

  // 流式对话核心：接收已构建好的发送内容与「基础消息列表」（含用户消息、不含助手占位），
  // 追加助手占位后驱动流式响应。handleSend / retry / editAndResend 共用，避免重复流式逻辑。
  // userMessageId：基础列表中本轮用户消息的稳定 id，原样传给后端作为落库主键（保证前后端一致）。
  const runChatStream = useCallback(
    async (
      submittedText: string,
      buildBaseMessages: (prev: ChatMessage[]) => ChatMessage[],
      images: Array<{ data: string; mediaType: string }> = [],
      userMessageId?: string,
    ) => {
      const assistantId = `${Date.now()}_a`;

      // 带图时后端强制走直答（不发 plan/agent 事件），任务模式也不展开协同台，避免出现空的 agent 面板。
      if (chatMode === "task" && images.length === 0) setSidebarCollapsed(false);

      cancelActiveStream();
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      setSending(true);
      setLoadError("");
      setPlan([]);
      setAgentRuns([]);
      setRequestId(undefined);
      setRoutingDecision(null);
      setActiveAssistantId(assistantId);

      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...buildBaseMessages(prev), assistantMsg]);
      streamingContentRef.current = "";
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }

      try {
        let sessionId = currentSession?.id;
        // 本轮助手消息的最终状态：completed（正常）/ interrupted（用户终止）/ failed（模型或网络错误）。
        let streamStatus: ChatMessage["status"] = "completed";

        stream: for await (const chunk of apiClient.chat.stream(
          {
            session_id: currentSession?.id,
            message: submittedText,
            context_type: contextType || (selectedInterestId ? "interest" : "general"),
            context_id: contextId || selectedInterestId || undefined,
            chat_mode: chatMode,
            images: images.length ? images : undefined,
            user_message_id: userMessageId,
          },
          abortController.signal
        )) {
          if (streamAbortRef.current !== abortController || abortController.signal.aborted) {
            abortController.abort();
            break;
          }
          if (chunk.type === "session_id") sessionId = chunk.value;
          if (chunk.type === "request_id") setRequestId(chunk.value);
          if (chunk.type === "plan") setPlan(chunk.value);
          if (chunk.type === "agent_start" || chunk.type === "agent_complete" || chunk.type === "agent_error") {
            setAgentRuns((prev) => upsertAgentRun(prev, chunk.value));
          }
          if (chunk.type === "searching") setSearchingQuery(chunk.query);
          if (chunk.type === "routing_decision") setRoutingDecision(chunk.value);
          if (chunk.type === "tool_result") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, tool_results: [...(m.tool_results || []), { tool_name: chunk.tool_name, tool_id: chunk.tool_id, result: chunk.result, result_id: chunk.result_id }] }
                  : m
              )
            );
          }
          if (chunk.type === "delta") {
            setSearchingQuery((q) => (q ? null : q));
            streamingContentRef.current += chunk.value;

            if (!rafRef.current) {
              rafRef.current = requestAnimationFrame(() => {
                const content = streamingContentRef.current;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content } : m))
                );
                rafRef.current = 0;
              });
            }
          }
          if (chunk.type === "sources") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, sources: chunk.value } : m))
            );
          }
          if (chunk.type === "error") {
            streamStatus = "failed";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: chunk.value || "请求未完成，请稍后重试。", status: "failed" } : m
              )
            );
            // error 是终态事件，不再等待事件桥关闭，避免输入框一直显示“终止”。
            break stream;
          }
          if (chunk.type === "done") {
            // 完成事件已经代表后端回复结束。主动退出迭代，避免底层流清理延迟
            // 让发送状态滞留在 true，导致发送按钮长期显示为“终止”。
            break stream;
          }
        }

        // Flush any remaining buffered streaming content
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        // 用户终止（abort）时流桥静默结束：已收到的部分内容保留，并标记为 interrupted。
        if (abortController.signal.aborted && streamStatus === "completed") {
          streamStatus = "interrupted";
        }
        if (streamingContentRef.current) {
          const finalContent = streamingContentRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: finalContent } : m))
          );
          streamingContentRef.current = "";
        }
        if (streamStatus !== "completed") {
          const finalStatus = streamStatus;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, status: finalStatus } : m))
          );
        }

        if (sessionId && !currentSession && !abortController.signal.aborted) {
          promoteDraftSession(sessionId);
          onSessionCreated(sessionId);
        }
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
          // 取消：保留已累积的部分内容，标记 interrupted（后端 chat_cancel 会同步落库）。
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, status: "interrupted" } : item
            )
          );
        } else {
          const msg = `请求未完成：${formatErrorMessage(error)}`;
          setMessages((prev) =>
            prev.map((item) => (item.id === assistantId ? { ...item, content: msg, status: "failed" } : item))
          );
        }
      } finally {
        setSending(false);
        streamingContentRef.current = "";
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        if (streamAbortRef.current === abortController) streamAbortRef.current = null;
      }
    },
    [chatMode, currentSession, selectedInterestId, contextType, contextId, cancelActiveStream, onSessionCreated, promoteDraftSession]
  );

  // 实际发送：组装发送文本（含技能注入标记）、校验视觉模型、追加用户消息并驱动流式。
  const sendChat = useCallback(
    async (rawText: string, skill: Skill | null, finalPrompt: string | null) => {
      const textForLlm =
        skill && finalPrompt
          ? buildSkillInjectedText(rawText, skill, finalPrompt)
          : rawText;
      const submittedText = buildCopilotMessageContent(textForLlm, attachments);
      // 图片走多模态 images 通道：发送给后端用 {data,mediaType}，存进消息用带 name 的 ChatImageRef 供气泡缩略图展示。
      const imageAttachments = attachments.filter(
        (a): a is typeof a & { imageData: string; imageMediaType: string } =>
          a.kind === "image" && !!a.imageData && !!a.imageMediaType,
      );
      const images = imageAttachments.map((a) => ({ data: a.imageData, mediaType: a.imageMediaType }));

      // 发图前先确认已配置视觉模型；未配置则提示并保留输入/附件，不发送。
      if (images.length > 0) {
        try {
          const settings = await apiClient.settings.get();
          if (!settings.vision_model?.trim()) {
            setLoadError("发送图片前请先在「设置 → 模型角色 → 视界·视觉」中配置视觉模型。");
            return;
          }
        } catch {
          // 设置获取失败时不阻断，交由后端兜底校验。
        }
      }

      void apiClient.memory.add({
        type: "auto",
        action: "chat.query",
        summary: `向小妍提问：${rawText.slice(0, 60)}${rawText.length > 60 ? "..." : ""}`,
      });

      const userMsg: ChatMessage = {
        // 稳定 id：随请求传给后端作为落库主键，保证前端列表与 DB 一致，重试/编辑重发可精确截断。
        id: createCopilotMessageId(),
        role: "user",
        content: submittedText,
        images: imageAttachments.length
          ? imageAttachments.map((a) => ({ data: a.imageData, mediaType: a.imageMediaType, name: a.name }))
          : undefined,
        created_at: new Date().toISOString(),
      };

      setInput("");
      clearAttachments();
      // 技能默认 one-shot：发完即通知调用方清除选中（锁定时调用方自行跳过）。
      if (skill) onSkillConsumed?.();
      await runChatStream(submittedText, (prev) => [...prev, userMsg], images, userMsg.id);
    },
    [attachments, clearAttachments, runChatStream, onSkillConsumed],
  );

  // 工具技能执行：前端本地运行 Tool Registry，生成 Artifact 后持久化到会话。
  const runToolSkill = useCallback(
    async (rawText: string, skill: Skill) => {
      if (skill.kind !== "tool") return;

      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      setSending(true);
      setLoadError("");
      setPlan([]);
      setAgentRuns([]);
      setRequestId(undefined);
      setSearchingQuery(null);
      setRoutingDecision(null);

      const assistantId = `${Date.now()}_a`;
      const userMsg: ChatMessage = {
        id: createCopilotMessageId(),
        role: "user",
        content: rawText,
        created_at: new Date().toISOString(),
      };
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      };

      setInput("");
      clearAttachments();
      onSkillConsumed?.();
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const report = (progress: ToolProgress) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: progress.message } : m
          )
        );
      };

      try {
        const textAttachments: ToolAttachment[] = attachments.map((a) => ({
          name: a.name,
          extension: a.extension,
          mediaTypeLabel: a.mediaTypeLabel,
          content: a.kind !== "image" ? a.content : "",
          kind: a.kind === "image" ? "image" : "text",
          imageData: a.kind === "image" ? a.imageData : undefined,
          imageMediaType: a.kind === "image" ? a.imageMediaType : undefined,
        }));

        const result = await executeToolSkill(skill.name, {
          sessionId: currentSession?.id,
          userMessage: rawText,
          attachments: textAttachments,
          signal: abortController.signal,
          onProgress: report,
        });

        if (abortController.signal.aborted) {
          throw new DOMException("已取消生成", "AbortError");
        }

        const finalAssistant: ChatMessage = {
          ...assistantMsg,
          content: result.content,
          artifacts: result.artifacts,
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? finalAssistant : m))
        );

        // 持久化到会话；落库后用 DB 主键回写本地消息 id，保证后续重试/编辑重发能精确截断 DB。
        const session = await apiClient.chat.ensureSession({
          sessionId: currentSession?.id,
          title: rawText.slice(0, 40),
          contextType: selectedInterestId ? "interest" : "general",
          contextId: selectedInterestId || undefined,
        });

        const savedUser = await apiClient.chat.saveMessage({
          session_id: session.id,
          role: "user",
          content: rawText,
        });
        const savedAssistant = await apiClient.chat.saveMessage({
          session_id: session.id,
          role: "assistant",
          content: result.content,
          artifacts: result.artifacts,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id
              ? { ...m, id: savedUser.id }
              : m.id === assistantId
                ? { ...m, id: savedAssistant.id }
                : m
          )
        );

        if (!currentSession) {
          promoteDraftSession(session.id);
          onSessionCreated(session.id);
        }
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "生成已取消。" }
                : m
            )
          );
        } else if (error instanceof ToolSkillNotImplementedError) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `该工具技能尚未实现：${skill.title}` }
                : m
            )
          );
        } else {
          const msg = formatErrorMessage(error);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `执行失败：${msg}` }
                : m
            )
          );
        }
      } finally {
        setSending(false);
        if (streamAbortRef.current === abortController) {
          streamAbortRef.current = null;
        }
      }
    },
    [attachments, clearAttachments, currentSession, onSessionCreated, onSkillConsumed, promoteDraftSession, selectedInterestId],
  );

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attachments.length === 0) || sending) return;
    const rawText = input.trim() || DEFAULT_ATTACHMENT_PROMPT;
    const selSkill = skills.find((s) => s.id === selectedSkillId) ?? null;

    if (selSkill?.kind === "tool") {
      await runToolSkill(rawText, selSkill);
      return;
    }

    // 技能含 {{变量}} 时先弹出填写表单，填好再发送。
    if (selSkill) {
      const variables = extractSkillVariables(selSkill.prompt);
      if (variables.length > 0) {
        setPendingSkillFill({ skill: selSkill, rawText, variables });
        return;
      }
    }
    await sendChat(rawText, selSkill, selSkill ? selSkill.prompt : null);
  }, [input, attachments, sending, skills, selectedSkillId, runToolSkill, sendChat]);

  // 变量填写确认：用填写值替换占位符后发送。
  const confirmSkillFill = useCallback(
    async (values: Record<string, string>) => {
      const pending = pendingSkillFill;
      if (!pending) return;
      setPendingSkillFill(null);
      const finalPrompt = applySkillVariables(pending.skill.prompt, values);
      await sendChat(pending.rawText, pending.skill, finalPrompt);
    },
    [pendingSkillFill, sendChat],
  );

  const cancelSkillFill = useCallback(() => setPendingSkillFill(null), []);

  // 重试/编辑重发前先把 DB 会话从目标用户消息起截断（含该消息），
  // 后端重新落库后与前端列表保持一致。截断失败时中止重发并提示，避免再次分叉。
  // 草稿会话（尚无 session id，DB 中无记录）直接跳过截断。
  const truncateForResend = useCallback(
    async (fromMessageId: string) => {
      if (!currentSessionId) return true;
      try {
        await apiClient.chat.truncateSession(currentSessionId, fromMessageId);
        return true;
      } catch (error) {
        setLoadError(`重发前清理旧消息失败：${formatErrorMessage(error)}`);
        return false;
      }
    },
    [currentSessionId],
  );

  // 重新生成：复用目标助手消息之前那条用户消息（其 content 即原始发送内容，已含附件上下文）。
  const retry = useCallback(
    (assistantMsgId: string) => {
      if (sending) return;
      const list = messagesRef.current;
      const assistantIdx = list.findIndex((m) => m.id === assistantMsgId);
      if (assistantIdx < 0) return;
      let userIdx = assistantIdx - 1;
      while (userIdx >= 0 && list[userIdx].role !== "user") userIdx -= 1;
      if (userIdx < 0) return;
      const userMessage = list[userIdx];
      const base = list.slice(0, userIdx + 1);
      const images = (userMessage.images ?? []).map((im) => ({ data: im.data, mediaType: im.mediaType }));
      void truncateForResend(userMessage.id).then((ok) => {
        if (ok) void runChatStream(userMessage.content, () => base, images, userMessage.id);
      });
    },
    [sending, runChatStream, truncateForResend]
  );

  // 编辑并重发：用新文本替换该用户消息（保留其原有附件上下文块），截断其后所有消息后重发。
  const editAndResend = useCallback(
    (messageId: string, newText: string) => {
      if (sending) return;
      const trimmed = newText.trim();
      if (!trimmed) return;
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx < 0 || list[idx].role !== "user") return;
      const blockIdx = list[idx].content.indexOf("<copilot-attachments");
      const submittedText = blockIdx >= 0 ? `${trimmed}\n\n${list[idx].content.slice(blockIdx)}` : trimmed;
      const updatedUser: ChatMessage = { ...list[idx], content: submittedText };
      const base = [...list.slice(0, idx), updatedUser];
      const images = (list[idx].images ?? []).map((im) => ({ data: im.data, mediaType: im.mediaType }));
      void truncateForResend(messageId).then((ok) => {
        if (ok) void runChatStream(submittedText, () => base, images, messageId);
      });
    },
    [sending, runChatStream, truncateForResend]
  );

  return {
    messages,
    setMessages,
    plan,
    agentRuns,
    setAgentRuns,
    requestId,
    activeAssistantId,
    input,
    setInput,
    sending,
    loadError,
    setLoadError,
    searchingQuery,
    routingDecision,
    sidebarCollapsed,
    setSidebarCollapsed,
    resetChat,
    cancelActiveStream,
    stopGenerating,
    restoreLoadedSession,
    promoteDraftSession,
    handleSend,
    retry,
    editAndResend,
    pendingSkillFill,
    confirmSkillFill,
    cancelSkillFill,
  };
}
