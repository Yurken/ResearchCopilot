import { useEffect, useRef } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Pencil,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { MarkdownRenderer } from "@research-copilot/ui";
import { MAIN_ASSISTANT_WELCOME_DESCRIPTION, MAIN_ASSISTANT_WELCOME_DESCRIPTION_DIRECT, MAIN_ASSISTANT_WELCOME_TITLE } from "@research-copilot/types";
import ThinkingProcessPanel from "./ThinkingProcessPanel";
import { ToolActionCard } from "./ToolActionCard";
import { ArtifactCard } from "../artifacts/ArtifactCard";
import appLogo from "../../assets/xiaoyanv.svg";
import { parseCopilotMessageContent } from "./shared";
import { openLink } from "../../lib/links";
import type { AgentPlanStep, AgentRun, ChatMessage, ChatMode, RoutingDecision } from "@research-copilot/types";

const DEFAULT_ATTACHMENT_PROMPT = "请先阅读我上传的文件，并给我一个简洁的重点概览。";

function splitThoughtFromContent(content: string) {
  const thinkTagPattern = /<think>([\s\S]*?)<\/think>/gi;
  const thoughts: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = thinkTagPattern.exec(content)) !== null) {
    const text = (match[1] || "").trim();
    if (text) thoughts.push(text);
  }
  let answer = content.replace(thinkTagPattern, "");
  // 流式过程中 <think> 可能尚未闭合：把从未闭合标签到结尾的内容都归入思考，避免原始推理泄漏进回答气泡。
  const openIndex = answer.search(/<think>/i);
  if (openIndex !== -1) {
    const pending = answer.slice(openIndex).replace(/<think>/i, "").trim();
    if (pending) thoughts.push(pending);
    answer = answer.slice(0, openIndex);
  }
  return {
    thought: thoughts.join("\n\n"),
    answer: answer.trim(),
  };
}

interface CopilotChatAreaProps {
  messages: ChatMessage[];
  chatMode: ChatMode;
  agentRuns: AgentRun[];
  plan: AgentPlanStep[];
  routingDecision: RoutingDecision | null;
  activeAssistantId: string | null;
  sending: boolean;
  searchingQuery: string | null;
  loadError: string;
  editingMessageId: string | null;
  editText: string;
  copiedId: string | null;
  onClearError: () => void;
  onCopy: (text: string, id: string) => void;
  onRetry: (assistantMsgId: string) => void;
  onStartEdit: (msg: ChatMessage) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditTextChange: (text: string) => void;
}

export function CopilotChatArea(props: CopilotChatAreaProps) {
  const {
    messages, chatMode, agentRuns, plan, routingDecision, activeAssistantId, sending, searchingQuery,
    loadError, editingMessageId, editText, copiedId,
    onClearError, onCopy, onRetry, onStartEdit, onSaveEdit, onCancelEdit,
    onEditTextChange,
  } = props;

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const displayedRuns = [...agentRuns].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 relative rc-copilot-chat-area">
      {loadError && (
        <div className="px-1 pt-2">
          <div
            className="flex items-start gap-3 rounded-2xl px-4 py-3 text-sm text-apple-red"
            style={{ background: "color-mix(in srgb, var(--rc-elevated) 82%, #FF3B30 10%)", boxShadow: "var(--rc-inset-shadow)" }}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="rc-selectable min-w-0 flex-1 break-all">{loadError}</span>
            <button type="button" aria-label="关闭错误提示" onClick={onClearError} className="rounded-lg p-0.5 text-apple-red/70 transition-colors hover:bg-apple-red/10 hover:text-apple-red">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-4 pb-12">
          <img src={appLogo} alt="小妍" draggable={false} className="w-20 h-20 object-contain"
            style={{ WebkitMaskImage: "radial-gradient(circle at center, #000 82%, transparent 100%)", maskImage: "radial-gradient(circle at center, #000 82%, transparent 100%)" }}
          />
          <div className="text-center max-w-md">
            <p className="font-semibold text-ink-primary">{MAIN_ASSISTANT_WELCOME_TITLE}</p>
            <p className="text-sm text-ink-tertiary mt-2 leading-6">{chatMode === "direct" ? MAIN_ASSISTANT_WELCOME_DESCRIPTION_DIRECT : MAIN_ASSISTANT_WELCOME_DESCRIPTION}</p>
          </div>
        </div>
      )}

      {messages.map((message) => (
        <div key={message.id} className="space-y-2">
          {message.role === "assistant" && (() => {
            const parsed = splitThoughtFromContent(message.content || "");
            const isActiveAssistant = message.id === activeAssistantId;
            const planForBubble = isActiveAssistant ? plan : [];
            const runsForBubble = isActiveAssistant ? displayedRuns : [];
            const routingForBubble = isActiveAssistant ? routingDecision : null;
            // 思考面板已渲染时（有推理/计划/运行/搜索/路由），它自带「思考中」指示，
            // 答案区不再重复显示「小妍思考中…」，仅在面板尚未出现时用作占位提示。
            const hasThinkingPanel =
              parsed.thought.trim().length > 0 ||
              planForBubble.length > 0 ||
              runsForBubble.length > 0 ||
              !!routingForBubble ||
              (isActiveAssistant && !!searchingQuery);
            const showThinkingPlaceholder =
              sending && isActiveAssistant && !hasThinkingPanel;

            return (
              <>
                <ThinkingProcessPanel
                  thought={parsed.thought}
                  plan={planForBubble}
                  runs={runsForBubble}
                  routingDecision={routingForBubble}
                  searchingQuery={isActiveAssistant ? searchingQuery : null}
                  isThinking={sending && isActiveAssistant}
                />
                <div
                  className="rc-assistant-answer rc-selectable"
                  style={{ color: "var(--rc-text)" }}
                >
                  {parsed.answer ? (
                    <MarkdownRenderer
                      content={parsed.answer}
                      className="rc-chat-markdown"
                      onLinkClick={openLink}
                    />
                  ) : showThinkingPlaceholder ? (
                    <div
                      className="rc-typing-indicator"
                      style={{ color: "var(--rc-text-tertiary)" }}
                      role="status"
                      aria-label="小妍思考中"
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : null}
                </div>
                {message.tool_results && message.tool_results.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {message.tool_results.map((tr) => (
                      <ToolActionCard key={tr.tool_id} tool={tr} />
                    ))}
                  </div>
                )}
                {message.artifacts && message.artifacts.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {message.artifacts.map((artifact) => (
                      <ArtifactCard key={artifact.id} artifact={artifact} />
                    ))}
                  </div>
                )}
                {parsed.answer && (
                  <div className="flex items-center gap-0.5 mt-1">
                    <button type="button" onClick={() => onCopy(parsed.answer, message.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-nm-dark/8"
                      style={{ color: "var(--rc-text-tertiary)" }}>
                      {copiedId === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <button type="button" onClick={() => onRetry(message.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-nm-dark/8"
                      style={{ color: "var(--rc-text-tertiary)" }}>
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </>
            );
          })()}

          {message.role === "user" && (() => {
            const parsedUserMessage = parseCopilotMessageContent(message.content);
            const isEditing = editingMessageId === message.id;

            return (
              <div className="flex justify-end">
                <div className="max-w-[85%]">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        rows={3} value={editText} onChange={(e) => onEditTextChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
                          if (e.key === "Escape") onCancelEdit();
                        }}
                        className="w-full rounded-2xl px-3 py-2 text-xs text-ink-primary outline-none resize-none"
                        style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-inset-shadow)" }}
                        autoFocus
                      />
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={onCancelEdit}
                          className="rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-nm-dark/8"
                          style={{ color: "var(--rc-text-tertiary)" }}>取消</button>
                        <button type="button" onClick={onSaveEdit} disabled={!editText.trim()}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40"
                          style={{ color: "#FFFFFF", background: "var(--rc-button-primary-bg)", boxShadow: "var(--rc-button-primary-shadow)" }}>保存并发送</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {parsedUserMessage.skill && (
                        <div className="mb-1.5 flex justify-end">
                          <span
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: "rgba(0,122,255,0.12)", color: "#007AFF" }}
                          >
                            <Zap className="w-3 h-3" />
                            {parsedUserMessage.skill.title}
                          </span>
                        </div>
                      )}
                      {parsedUserMessage.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5 justify-end">
                          {parsedUserMessage.attachments.map((att, i) => (
                            <span key={`${att.name}-${i}`}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium"
                              style={{ background: "rgba(0,122,255,0.1)", color: "#007AFF" }}>
                              {att.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {message.images && message.images.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5 justify-end">
                          {message.images.map((img, i) => (
                            <img
                              key={`${img.name ?? "img"}-${i}`}
                              src={`data:${img.mediaType};base64,${img.data}`}
                              alt={img.name ?? "图片"}
                              className="max-h-40 max-w-[12rem] rounded-xl object-cover"
                              style={{ boxShadow: "var(--rc-chip-shadow)" }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="rounded-2xl px-3 py-1.5 text-xs"
                        style={{ background: "var(--rc-button-primary-bg)", boxShadow: "var(--rc-button-primary-shadow)", color: "#FFFFFF" }}>
                        <p className="rc-selectable whitespace-pre-wrap leading-relaxed">
                          {parsedUserMessage.text || DEFAULT_ATTACHMENT_PROMPT}
                        </p>
                      </div>
                      <div className="flex justify-end gap-0.5 mt-1">
                        <button type="button" onClick={() => onCopy(parsedUserMessage.text || DEFAULT_ATTACHMENT_PROMPT, message.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-nm-dark/8"
                          style={{ color: "var(--rc-text-tertiary)" }}>
                          {copiedId === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button type="button" onClick={() => onStartEdit(message)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-nm-dark/8"
                          style={{ color: "var(--rc-text-tertiary)" }}>
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
