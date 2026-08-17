import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FileText, FlaskConical, Loader2, MessageSquare, Send, Upload } from "lucide-react";
import { Badge, Button, Input, MarkdownRenderer, Select } from "@research-copilot/ui";
import { CcfRatingBadge, VenueTypeBadge } from "../../components/CcfBadges";
import ExternalLink from "../../components/ExternalLink";
import AgentStateGraphPanel from "../copilot/AgentStateGraphPanel";
import PaperTaskProgressPanel from "../papers/PaperTaskProgressPanel";
import { usePaperTaskProgress } from "../papers/usePaperTaskProgress";
import { upsertAgentRun } from "../copilot/shared";
import { apiClient, formatErrorMessage } from "../../lib/client";
import { openLink } from "../../lib/links";
import type { AgentPlanStep, AgentRun, ChatMessage, ChatSession, KnowledgeNote, Paper, ResearchInterest } from "@research-copilot/types";
import Tools from "../../pages/Tools";
import Writing from "../../pages/Writing";
import Code from "../../pages/Code";
import Submission from "../../pages/Submission";
import Knowledge from "../../pages/Knowledge";
import { LearningPathView } from "./InterestsPanel";
import ResearchOverviewPanel from "./ResearchOverviewPanel";

export type InterestTab = "overview" | "planner" | "papers" | "writing" | "chat" | "xiaoyan" | "knowledge" | "notes" | "tools" | "experiment" | "submission";

interface ResearchWorkbenchProps {
  interest: ResearchInterest;
  activeTab?: InterestTab;
  onStats?: (papers: number, sessions: number, notes: number) => void;
}

function paperStatusBadge(status: string) {
  if (status === "analyzed") return <Badge variant="success">已分析</Badge>;
  if (status === "reproduced") return <Badge variant="success">已复现</Badge>;
  if (status === "analyzing") return <Badge variant="info">处理中</Badge>;
  if (status === "parsing") return <Badge variant="info">解析中</Badge>;
  if (status === "failed" || status === "error") return <Badge variant="danger">失败</Badge>;
  if (status === "parsed") return <Badge variant="info">已解析</Badge>;
  return <Badge variant="default">已上传</Badge>;
}

function canRunPaperTask(status: string) {
  return !["uploaded", "parsing", "analyzing"].includes(status);
}

export default function ResearchWorkbench({ interest, activeTab = "overview", onStats }: ResearchWorkbenchProps) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<AgentPlanStep[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingSession, setRefreshingSession] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmReanalyzePaperId, setConfirmReanalyzePaperId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const onStatsRef = useRef(onStats);
  const { taskProgressByPaperId, markPaperTaskStarted, markPaperTaskFailed } = usePaperTaskProgress({
    setPapers,
    setError,
  });

  useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);

  const activeRequestId = useMemo(() => {
    return [...agentRuns]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]?.request_id;
  }, [agentRuns]);

  const displayedRuns = useMemo(() => {
    return [...agentRuns]
      .filter((run) => !activeRequestId || run.request_id === activeRequestId)
      .sort((a, b) => a.order_index - b.order_index);
  }, [agentRuns, activeRequestId]);

  const refreshSessions = async () => {
    const all = await apiClient.chat.listSessions();
    const related = all.filter((s) => s.context_type === "interest" && s.context_id === interest.id);
    setSessions(related);
    return related;
  };

  const refreshWorkspace = async () => {
    const [relatedPapers, allNotes, relatedSessions] = await Promise.all([
      apiClient.papers.list(0, 50, interest.id),
      apiClient.knowledge.listNotes(),
      refreshSessions(),
    ]);
    setPapers(relatedPapers);
    const relatedNotes = allNotes.filter((note) => note.research_interest_id === interest.id);
    setNotes(relatedNotes);
    if (selectedSessionId && !relatedSessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(relatedSessions[0]?.id ?? null);
    } else if (!selectedSessionId && relatedSessions.length > 0) {
      setSelectedSessionId(relatedSessions[0].id);
    }
    onStatsRef.current?.(relatedPapers.length, relatedSessions.length, relatedNotes.length);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessages([]);
    setPlan([]);
    setAgentRuns([]);
    setSelectedSessionId(null);

    Promise.all([
      apiClient.papers.list(0, 50, interest.id),
      apiClient.knowledge.listNotes(),
      apiClient.chat.listSessions(),
    ])
      .then(([relatedPapers, allNotes, allSessions]) => {
        if (cancelled) return;
        const relatedSessions = allSessions.filter((s) => s.context_type === "interest" && s.context_id === interest.id);
        const relatedNotes = allNotes.filter((note) => note.research_interest_id === interest.id);
        setPapers(relatedPapers);
        setNotes(relatedNotes);
        setSessions(relatedSessions);
        setSelectedSessionId(relatedSessions[0]?.id ?? null);
        setLoading(false);
        onStatsRef.current?.(relatedPapers.length, relatedSessions.length, relatedNotes.length);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(formatErrorMessage(nextError));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [interest.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (sending) return;
    if (!selectedSessionId) {
      setMessages([]);
      setPlan([]);
      setAgentRuns([]);
      return;
    }
    let cancelled = false;
    setRefreshingSession(true);

    Promise.all([
      apiClient.chat.getSession(selectedSessionId),
      apiClient.chat.listAgentRuns(selectedSessionId),
    ])
      .then(([session, runs]) => {
        if (cancelled) return;
        setMessages(session.messages ?? []);
        setPlan([]);
        setAgentRuns(runs);
        setError("");
      })
      .catch((nextError) => { if (!cancelled) setError(formatErrorMessage(nextError)); })
      .finally(() => { if (!cancelled) setRefreshingSession(false); });

    return () => { cancelled = true; };
  }, [selectedSessionId, sending]);

  const handleUpload = async () => {
    try {
      setError("");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!selected) return;
      const selectedPath =
        typeof selected === "string" ? selected
        : typeof selected === "object" && selected !== null && "path" in selected
          ? String((selected as { path: unknown }).path) : "";
      if (!selectedPath) throw new Error("未识别的文件路径，请重新选择 PDF 文件");
      setUploading(true);
      await apiClient.papers.upload(selectedPath, interest.id);
      await refreshWorkspace();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async (paperId: string) => {
    try {
      setConfirmReanalyzePaperId(null);
      setError("");
      setPapers((prev) => prev.map((p) => p.id === paperId ? { ...p, status: "analyzing" } : p));
      markPaperTaskStarted(paperId, "analysis");
      await apiClient.papers.analyze(paperId);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
      markPaperTaskFailed(paperId);
      try {
        const latest = await apiClient.papers.get(paperId);
        setPapers((prev) => prev.map((p) => p.id === paperId ? latest : p));
      } catch {
        // 保持原有状态，不覆盖为 failed
      }
    }
  };

  const handleReproduce = async (paperId: string) => {
    try {
      setError("");
      setPapers((prev) => prev.map((p) => p.id === paperId ? { ...p, status: "analyzing" } : p));
      markPaperTaskStarted(paperId, "reproduction");
      await apiClient.papers.reproduce(paperId);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
      markPaperTaskFailed(paperId);
      try {
        const latest = await apiClient.papers.get(paperId);
        setPapers((prev) => prev.map((p) => p.id === paperId ? latest : p));
      } catch {
        // 保持原有状态，不覆盖为 failed
      }
    }
  };

  const requiresReanalyzeConfirm = (paper: Paper) => paper.status === "analyzed" || paper.status === "reproduced";

  const handleNewSession = () => {
    setSelectedSessionId(null);
    setMessages([]);
    setPlan([]);
    setAgentRuns([]);
    setError("");
  };

  const handleSend = async () => {
    if (!chatInput.trim() || sending) return;
    const text = chatInput.trim();
    const assistantId = `${Date.now()}_assistant`;
    setChatInput("");
    setSending(true);
    setError("");
    setPlan([]);
    setAgentRuns([]);

    const userMsg: ChatMessage = { id: `${Date.now()}_user`, role: "user", content: text, created_at: new Date().toISOString() };
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      let nextSessionId = selectedSessionId ?? undefined;

      for await (const chunk of apiClient.chat.stream({
        session_id: selectedSessionId ?? undefined,
        message: text,
        context_type: "interest",
        context_id: interest.id,
      })) {
        if (chunk.type === "session_id") { nextSessionId = chunk.value; setSelectedSessionId(chunk.value); }
        if (chunk.type === "plan") setPlan(chunk.value);
        if (chunk.type === "agent_start" || chunk.type === "agent_complete" || chunk.type === "agent_error") {
          setAgentRuns((prev) => upsertAgentRun(prev, chunk.value));
        }
        if (chunk.type === "delta") {
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk.value } : m));
        }
        if (chunk.type === "sources") {
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, sources: chunk.value } : m));
        }
        if (chunk.type === "error") {
          const nextError = chunk.value || "请求未完成，请稍后重试。";
          setError(nextError);
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: nextError } : m));
        }
      }

      await refreshSessions();
      if (nextSessionId) {
        const [session, runs] = await Promise.all([
          apiClient.chat.getSession(nextSessionId),
          apiClient.chat.listAgentRuns(nextSessionId),
        ]);
        setMessages(session.messages ?? []);
        setAgentRuns(runs);
      }
    } catch (nextError) {
      const message = `请求未完成：${formatErrorMessage(nextError)}`;
      setError(message);
      setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: message } : m));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-tertiary">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">正在加载工作台…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="flex-shrink-0 flex items-start gap-2 px-5 py-2 text-sm text-apple-red border-b border-apple-red/10 bg-[#F7ECEA]">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {activeTab === "overview" && (
        <ResearchOverviewPanel
          interest={interest}
          papers={papers}
          notes={notes}
          sessions={sessions}
        />
      )}

      {/* ── 规划路线 ── */}
      {activeTab === "planner" && (
        <div className="flex-1 overflow-y-auto p-5">
          {interest.learning_path ? (
            <LearningPathView path={interest.learning_path} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center py-16">
              <p className="text-sm font-medium text-ink-primary">暂无规划路线</p>
              <p className="mt-2 text-xs leading-6 text-ink-tertiary">
                路线生成后会在这里展示学习阶段、经典论文和研究主题。
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 论文 ── */}
      {activeTab === "papers" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-apple-blue" />
              <p className="text-sm font-semibold text-ink-primary">关联论文</p>
              <p className="text-xs text-ink-tertiary">上传到当前路线，后续分析与复现都留在这里。</p>
            </div>
            <Button size="sm" onClick={() => void handleUpload()} loading={uploading}>
              <Upload className="h-4 w-4" />
              上传 PDF
            </Button>
          </div>

          {papers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-nm-dark/10 px-4 py-10 text-center text-xs text-ink-tertiary" style={{ background: "var(--rc-card-inset-bg)", boxShadow: "var(--rc-inset-shadow)" }}>
              暂无关联论文。建议先导入一篇与你当前研究路线最相关的 PDF。
            </div>
          ) : (
            <div className="space-y-3">
              {papers.map((paper) => (
                <div key={paper.id} className="rounded-2xl border border-nm-dark/10 p-3" style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-card-flat-shadow)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <ExternalLink href={paper.paper_url} className="truncate text-sm font-semibold text-ink-primary hover:text-apple-blue hover:underline">
                          {paper.title}
                        </ExternalLink>
                        <CcfRatingBadge rating={paper.ccf_rating} />
                        <VenueTypeBadge type={paper.ccf_type} />
                      </div>
                      <p className="mt-1 text-[11px] text-ink-tertiary">
                        {new Date(paper.updated_at || paper.created_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                      </p>
                      {(paper.venue || paper.ccf_area) && (
                        <p className="mt-1 text-[11px] leading-5 text-ink-secondary">
                          {paper.venue ? (
                            <ExternalLink href={paper.venue_url} className="text-[11px] text-ink-secondary hover:text-apple-blue hover:underline">
                              {paper.venue}
                            </ExternalLink>
                          ) : "未识别来源"}
                          {paper.ccf_area ? ` · ${paper.ccf_area}` : ""}
                        </p>
                      )}
                    </div>
                    {paperStatusBadge(paper.status)}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (requiresReanalyzeConfirm(paper)) {
                          setConfirmReanalyzePaperId((prev) => (prev === paper.id ? null : paper.id));
                          return;
                        }
                        void handleAnalyze(paper.id);
                      }}
                      disabled={!canRunPaperTask(paper.status)}
                    >
                      {paper.status === "analyzing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {paper.status === "parsing" ? "解析中" : paper.status === "uploaded" ? "待解析" : "分析"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleReproduce(paper.id)}
                      disabled={!canRunPaperTask(paper.status)}
                      style={paper.status === "reproduced" || paper.reproduction_guide
                        ? { color: "#34C759" }
                        : undefined}
                      title={paper.status === "reproduced" || paper.reproduction_guide ? "已生成复现/验证指南" : "生成复现/验证指南"}
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      {paper.status === "reproduced" || paper.reproduction_guide ? "已复现" : "复现"}
                    </Button>
                  </div>
                  {paper.status === "analyzing" && taskProgressByPaperId[paper.id] ? (
                    <PaperTaskProgressPanel progress={taskProgressByPaperId[paper.id]} />
                  ) : null}
                  {confirmReanalyzePaperId === paper.id && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[rgba(0,122,255,0.08)] px-3 py-2">
                      <span className="text-xs text-[#0A62D0]">该论文已有分析结果，确认要重新分析并覆盖现有结果吗？</span>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setConfirmReanalyzePaperId(null)}>
                          取消
                        </Button>
                        <button
                          type="button"
                          onClick={() => void handleAnalyze(paper.id)}
                          className="inline-flex items-center gap-1 rounded-xl bg-[#007AFF] px-3 py-1.5 text-xs font-medium text-white transition-colors"
                        >
                          确认重跑
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 写作 ── */}
      {activeTab === "writing" && (
        <div className="flex-1 min-h-0 overflow-hidden pt-2">
          <Writing defaultResearchInterestId={interest.id} />
        </div>
      )}

      {/* ── 对话 ── */}
      {(activeTab === "chat" || activeTab === "xiaoyan") && (
        <div className="flex flex-col flex-1 min-h-0 p-5 gap-3">
          <div className="flex items-center justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#34C759]" />
              <p className="text-xs text-ink-tertiary">可继续围绕当前研究路线提问，例如下一步安排、论文优先级或实验推进建议。</p>
            </div>
            <div className="flex items-center gap-2">
              {sessions.length > 0 && (
                <Select
                  value={selectedSessionId ?? ""}
                  onChange={(value) => setSelectedSessionId(value || null)}
                  className="w-[200px]"
                  options={[
                    { value: "", label: "新建会话" },
                    ...sessions.map((session) => ({
                      value: session.id,
                      label: session.title || "新建会话",
                    })),
                  ]}
                />
              )}
              <Button size="sm" variant="secondary" onClick={handleNewSession}>新建会话</Button>
            </div>
          </div>

          {(plan.length > 0 || displayedRuns.length > 0) && (
            <div className="flex-shrink-0 rounded-2xl border border-nm-dark/10 p-3" style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-card-flat-shadow)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">当前状态图执行</p>
              <div className="mt-3">
                <AgentStateGraphPanel
                  plan={plan}
                  runs={displayedRuns}
                  sending={sending}
                  compact
                  emptyText="当前路线暂无执行节点。"
                />
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 rounded-2xl border border-nm-dark/10 p-3 overflow-y-auto" style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-inset-shadow)" }}>
            {refreshingSession ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-apple-blue" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-ink-primary">从当前路线继续推进</p>
                <p className="mt-2 max-w-md text-xs leading-6 text-ink-tertiary">
                  例如：下一阶段应优先阅读哪些论文？导入这篇 PDF 后如何安排复现？结合当前基础，研究路线应如何收敛？
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[85%]" : "max-w-[90%]"}>
                    <div className={`rounded-2xl px-4 py-3 text-sm ${message.role === "user" ? "bg-apple-blue text-white" : "text-ink-primary"}`} style={message.role === "assistant" ? { background: "var(--rc-card-bg)", boxShadow: "var(--rc-chip-shadow)" } : undefined}>
                      {message.role === "assistant" ? (
                        <MarkdownRenderer content={message.content || "…"} className="text-sm leading-7" onLinkClick={openLink} />
                      ) : (
                        <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                      )}
                    </div>
                    {message.role === "assistant" && message.sources && message.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.sources.map((source, index) => (
                          <ExternalLink key={`${source.source}-${index}`} href={source.url} title={source.content} className="rounded-full px-2.5 py-1 text-[11px] text-ink-tertiary">
                            <span style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }} className="inline-flex rounded-full px-2.5 py-1 hover:text-apple-blue">
                              {source.source || `来源 ${index + 1}`}
                            </span>
                          </ExternalLink>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="flex-shrink-0 flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder="请输入问题，继续围绕当前研究路线推进"
            />
            <Button onClick={() => void handleSend()} loading={sending}>
              <Send className="h-4 w-4" />
              发送
            </Button>
          </div>
        </div>
      )}

      {/* ── 工具 ── */}
      {activeTab === "tools" && (
        <div className="flex-1 min-h-0 overflow-hidden pt-2">
          <Tools />
        </div>
      )}

      {/* ── 知识 ── */}
      {(activeTab === "knowledge" || activeTab === "notes") && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Knowledge hideFolders researchInterestId={interest.id} />
        </div>
      )}

      {/* ── 官方 DeepSeek Harness 代码工作区 ── */}
      {activeTab === "experiment" && (
        <div className="flex-1 min-h-0 overflow-hidden pt-2">
          <Code />
        </div>
      )}

      {/* ── 投稿 ── */}
      {activeTab === "submission" && (
        <div className="flex-1 min-h-0 overflow-hidden pt-2">
          <Submission />
        </div>
      )}
    </div>
  );
}
