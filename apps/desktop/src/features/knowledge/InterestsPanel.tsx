import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, GitBranch, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, Input } from "@research-copilot/ui";
import { CcfRatingBadge, VenueTypeBadge } from "../../components/CcfBadges";
import ExternalLink from "../../components/ExternalLink";
import { apiClient, formatErrorMessage } from "../../lib/client";
import { interestFolderName } from "../../lib/interestUtils";
import { replaceAgentWording, toCapabilityModelName, type LearningPath, type ResearchInterest } from "@research-copilot/types";
import InterestProfilePanel, { type InterestProfileHighlight } from "./InterestProfilePanel";
import PlannerComposer from "./PlannerComposer";
import ResearchWorkbench from "./ResearchWorkbench";
import TopicDiscoveryWizard from "./TopicDiscoveryWizard";
import IdeaFromMaterialsPanel from "./IdeaFromMaterialsPanel";
import type { HypothesisPlanningDraft } from "./hypothesisPlanning";
import HypothesisValidationPlan from "./HypothesisValidationPlan";
import {
  applyInterestPlanSnapshots,
  failInterestPlanRun,
  isInterestPlanBusyError,
  removeInterestPlanSnapshot,
  resumeInterestPlanRun,
  startInterestPlanRun,
  useInterestPlanSnapshots,
} from "./useInterestPlanRuns";

function StatusBadge({ status }: { status: string }) {
  if (status === "planned") return <Badge variant="success">已规划</Badge>;
  if (status === "planning") return <Badge variant="info">生成中</Badge>;
  return <Badge variant="default">待规划</Badge>;
}

export function LearningPathView({ path }: { path: LearningPath }) {
  return (
    <div className="space-y-5 text-xs text-ink-secondary">
      {path.overview && (
        <p className="text-sm leading-relaxed text-ink-primary">{path.overview}</p>
      )}

      {path.prerequisites && path.prerequisites.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">前置知识</p>
          <div className="grid gap-2 md:grid-cols-2">
            {path.prerequisites.map((item) => (
              <div key={item.name} className="rounded-2xl border border-nm-dark/10 bg-white/40 p-3">
                <p className="text-sm font-semibold text-ink-primary">{item.name}</p>
                <p className="mt-1 leading-5">{item.description}</p>
                {item.resources.length > 0 && (
                  <p className="mt-2 text-[11px] text-ink-tertiary">推荐资源：{item.resources.join(" · ")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {path.learning_stages && path.learning_stages.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">学习阶段</p>
          <div className="space-y-3">
            {path.learning_stages.map((stage) => (
              <div key={`${stage.stage}-${stage.title}`} className="rounded-2xl border border-nm-dark/10 bg-white/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-primary">
                      {stage.stage}. {stage.title}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-tertiary">
                      预计时长 · {stage.duration}
                    </p>
                  </div>
                  {stage.topics.length > 0 && (
                    <Badge variant="info" className="max-w-[15rem] truncate">
                      {stage.topics.slice(0, 2).join(" · ")}
                      {stage.topics.length > 2 ? ` +${stage.topics.length - 2}` : ""}
                    </Badge>
                  )}
                </div>
                {stage.goals.length > 0 && (
                  <ul className="mt-3 space-y-1.5 pl-4 text-xs leading-5 text-ink-secondary">
                    {stage.goals.map((goal, index) => (
                      <li key={`${stage.stage}-goal-${index}`} className="list-disc">
                        {goal}
                      </li>
                    ))}
                  </ul>
                )}
                {stage.topics.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">涵盖主题</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {stage.topics.map((topic, index) => (
                        <span
                          key={`${stage.stage}-topic-${index}`}
                          className="rc-accent-chip rounded-full px-2 py-1 text-[11px]"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {stage.resources.length > 0 && (
                  <p className="mt-3 text-[11px] text-ink-tertiary">资源：{stage.resources.join(" · ")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {path.classic_papers && path.classic_papers.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">经典论文</p>
          <div className="space-y-2">
            {path.classic_papers.map((paper, index) => (
              <div key={`${paper.title}-${index}`} className="rounded-2xl border border-nm-dark/10 bg-white/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ExternalLink
                    href={paper.paper_url}
                    className="text-sm font-semibold text-ink-primary hover:text-apple-blue hover:underline"
                  >
                    {paper.title} <span className="font-normal text-ink-tertiary">({paper.year})</span>
                  </ExternalLink>
                  <CcfRatingBadge rating={paper.ccf_rating} />
                  <VenueTypeBadge type={paper.ccf_type} />
                </div>
                <p className="mt-1 text-xs text-ink-tertiary">{paper.authors}</p>
                {(paper.venue || paper.ccf_area) && (
                  <p className="mt-1 text-xs leading-5 text-ink-secondary">
                    {paper.venue ? (
                      <ExternalLink
                        href={paper.venue_url}
                        className="text-xs text-ink-secondary hover:text-apple-blue hover:underline"
                      >
                        {paper.venue}
                      </ExternalLink>
                    ) : "未提供来源"}
                    {paper.ccf_area ? ` · ${paper.ccf_area}` : ""}
                  </p>
                )}
                <p className="mt-2 leading-5 text-ink-secondary">{paper.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {path.research_directions && path.research_directions.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">研究主题</p>
          <div className="grid gap-2 md:grid-cols-2">
            {path.research_directions.map((direction, index) => (
              <div key={`${direction.direction}-${index}`} className="rounded-2xl border border-nm-dark/10 bg-white/40 p-3">
                <p className="text-sm font-semibold text-ink-primary">{direction.direction}</p>
                <p className="mt-1 leading-5 text-ink-secondary">{direction.description}</p>
                {direction.open_problems.length > 0 && (
                  <p className="mt-2 text-[11px] text-ink-tertiary">
                    开放问题：{direction.open_problems.join("、")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {path.hypothesis_validation ? <HypothesisValidationPlan plan={path.hypothesis_validation} /> : null}

      {(path.tools_and_frameworks?.length || path.communities?.length) ? (
        <div className="grid gap-3 md:grid-cols-2">
          {path.tools_and_frameworks && path.tools_and_frameworks.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">工具与框架</p>
              <div className="flex flex-wrap gap-2">
                {path.tools_and_frameworks.map((tool) => (
                  <span key={tool} className="rc-accent-chip rounded-full px-2 py-1 text-[11px]">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {path.communities && path.communities.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">社区与会议</p>
              <div className="flex flex-wrap gap-2">
                {path.communities.map((community) => (
                  <span key={community} className="rounded-full bg-white/50 px-2 py-1 text-[11px] text-ink-secondary">
                    {community}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function summarizeProfile(interest: ResearchInterest): InterestProfileHighlight[] {
  const highlights: InterestProfileHighlight[] = [];

  if (interest.profile?.goal) {
    highlights.push({ label: "目标", value: interest.profile.goal });
  }
  if (interest.profile?.time_budget) {
    highlights.push({ label: "时间", value: interest.profile.time_budget });
  }
  if (interest.profile?.preferred_output) {
    highlights.push({ label: "输出", value: interest.profile.preferred_output });
  }

  return highlights;
}

export default function InterestsPanel() {
  const [interests, setInterests] = useState<ResearchInterest[]>([]);
  const planSnapshots = useInterestPlanSnapshots();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMode, setDiscoverMode] = useState<"questions" | "materials">("questions");
  const [wizardTopic, setWizardTopic] = useState("");
  const [hypothesisDraft, setHypothesisDraft] = useState<HypothesisPlanningDraft | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [savingFolderId, setSavingFolderId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingInterestId, setDeletingInterestId] = useState<string | null>(null);
  const visibleInterests = useMemo(
    () => applyInterestPlanSnapshots(interests, planSnapshots),
    [interests, planSnapshots]
  );

  useEffect(() => {
    let cancelled = false;

    apiClient.knowledge.listInterests()
      .then((data) => {
        if (!cancelled) {
          setInterests(data);
          setLoading(false);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(formatErrorMessage(nextError));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGeneratePlan = async (interest: ResearchInterest, startStep?: number) => {
    if (typeof startStep === "number") {
      resumeInterestPlanRun(interest.id, startStep);
    } else {
      startInterestPlanRun(interest.id, interest.learning_path);
    }

    try {
      await apiClient.knowledge.generatePlan(interest.id, startStep);
      setError("");
      setNotice("");
    } catch (nextError) {
      const message = formatErrorMessage(nextError);
      if (isInterestPlanBusyError(message)) {
        // 后端已有规划任务在跑：保留 planning 展示，仅提示用户等待。
        setError(message);
        return;
      }
      failInterestPlanRun(interest.id, message);
      setError(message);
    }
  };

  const handleStartEditFolder = (interest: ResearchInterest) => {
    setEditingFolderId(interest.id);
    setFolderDraft(interestFolderName(interest));
  };

  const handleSaveFolder = async (interestId: string) => {
    const trimmed = folderDraft.trim();
    if (!trimmed) {
      setError("文件夹名称不能为空");
      return;
    }

    try {
      setSavingFolderId(interestId);
      const updated = await apiClient.knowledge.updateInterestFolder(interestId, trimmed);
      setInterests((prev) => prev.map((item) => (item.id === interestId ? updated : item)));
      setEditingFolderId(null);
      setFolderDraft("");
      setError("");
      setNotice("");
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSavingFolderId(null);
    }
  };

  const handleDeleteInterest = async (id: string) => {
    try {
      setDeletingInterestId(id);
      await apiClient.knowledge.deleteInterestOnly(id);
      setInterests((prev) => prev.filter((item) => item.id !== id));
      removeInterestPlanSnapshot(id);
      setExpanded((prev) => (prev === id ? null : prev));
      setEditingFolderId((prev) => (prev === id ? null : prev));
      setFolderDraft("");
      setConfirmDeleteId(null);
      setError("");
      setNotice("");
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setDeletingInterestId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-apple-blue" />
        <p className="text-sm text-ink-tertiary">加载中…</p>
      </div>
    );
  }

  if (error && visibleInterests.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertCircle className="h-8 w-8 text-apple-red" />
        <p className="break-all text-sm text-apple-red">{error}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card padding="sm" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink-primary">研究路线设计器</p>
            <p className="mt-1 text-xs leading-5 text-ink-tertiary">
              把研究主题转成阶段化学习路线、经典论文和潜在切入方向。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDiscovering((prev) => !prev);
                setCreating(false);
              }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-ink-secondary transition-all duration-150 hover:text-apple-blue"
              style={{
                background: "var(--rc-chip-bg)",
                boxShadow: discovering
                  ? "var(--rc-inset-shadow)"
                  : "var(--rc-chip-shadow)",
                color: discovering ? "#007AFF" : undefined,
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              没想好要做什么？
            </button>
            <Button size="sm" onClick={() => { setCreating((prev) => !prev); setDiscovering(false); }}>
              <Plus className="h-4 w-4" />
              {creating ? "收起表单" : "添加研究主题"}
            </Button>
          </div>
        </div>

        {discovering && (
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {([
                { key: "questions", label: "回答几个问题" },
                { key: "materials", label: "给小妍资料" },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDiscoverMode(opt.key)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150"
                  style={{
                    background: discoverMode === opt.key ? "#007AFF" : "var(--rc-surface)",
                    color: discoverMode === opt.key ? "#fff" : "var(--rc-text-soft)",
                    boxShadow: discoverMode === opt.key
                      ? "inset 1px 1px 3px rgba(0,0,0,0.2)"
                      : "var(--rc-chip-shadow)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {discoverMode === "questions" ? (
              <TopicDiscoveryWizard
                onSelect={(topic) => {
                  setWizardTopic(topic);
                  setDiscovering(false);
                  setCreating(true);
                }}
                onClose={() => setDiscovering(false)}
              />
            ) : (
              <IdeaFromMaterialsPanel
                onSelect={(draft) => {
                  setWizardTopic(draft.topic);
                  setHypothesisDraft(draft);
                  setDiscovering(false);
                  setCreating(true);
                }}
                onClose={() => setDiscovering(false)}
              />
            )}
          </div>
        )}

        {creating && (
          <PlannerComposer
            initialTopic={wizardTopic}
            initialDraft={hypothesisDraft ?? undefined}
            onCancel={() => { setCreating(false); setWizardTopic(""); setHypothesisDraft(null); }}
            onCreated={(nextInterest, meta) => {
              setInterests((prev) => [nextInterest, ...prev]);
              setCreating(false);
              setWizardTopic("");
              setHypothesisDraft(null);
              if (meta?.failedUploads.length) {
                const uploadedSummary = meta.uploadedReferences > 0 ? `已导入 ${meta.uploadedReferences} 篇，` : "";
                setError(`研究主题已创建，${uploadedSummary}${meta.failedUploads.length} 篇参考文献导入失败：${meta.failedUploads.join("；")}`);
                setNotice("");
                return;
              }

              setError("");
              setNotice(
                meta?.uploadedReferences
                  ? `研究主题已创建，并导入 ${meta.uploadedReferences} 篇参考文献。后续修改主题文件夹名不会影响论文归属。`
                  : ""
              );
            }}
          />
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-2xl border border-apple-blue/15 bg-[#EEF6FF] px-3 py-2 text-sm text-[#0A5BD6]">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="break-all">{notice}</span>
          </div>
        )}

        {error && visibleInterests.length > 0 && (
          <div className="flex items-start gap-2 rounded-2xl border border-apple-red/10 bg-[#F7ECEA] px-3 py-2 text-sm text-apple-red">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </Card>

      {visibleInterests.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-inset-shadow)" }}
          >
            <Sparkles className="h-7 w-7 text-ink-tertiary" />
          </div>
          <div>
            <p className="font-medium text-ink-secondary">暂无研究主题</p>
            <p className="mt-1 text-sm text-ink-tertiary">添加研究主题，小妍会为你生成系统化路线。</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleInterests.map((interest) => {
            const profileHighlights = summarizeProfile(interest);
            const planSnapshot = planSnapshots[interest.id];
            const agents = planSnapshot?.agents || [];
            const planError = planSnapshot?.error;
            const hasRunningAgent = agents.some((agent) => agent.status === "running");
            const folderName = interestFolderName(interest);
            const folderEdited = folderName !== interest.topic;

            return (
              <Card key={interest.id} padding="sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink-primary">{folderName}</p>
                      <StatusBadge status={interest.status} />
                    </div>
                    {folderEdited && (
                      <p className="mt-1 text-xs text-ink-tertiary">
                        研究主题：{interest.topic}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button size="sm" variant="secondary" onClick={() => handleStartEditFolder(interest)}>
                      <Pencil className="h-3.5 w-3.5" />
                      文件夹名
                    </Button>
                    {interest.status !== "planning" ? (
                      <Button size="sm" variant="secondary" onClick={() => void handleGeneratePlan(interest)}>
                        <Sparkles className="h-3.5 w-3.5" />
                        {interest.status === "planned" ? "重新规划" : "生成路线"}
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-apple-blue">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        生成中…
                      </span>
                    )}

                    {interest.learning_path && (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => (prev === interest.id ? null : interest.id))}
                        className="rounded-xl p-1.5 text-ink-tertiary transition-colors hover:text-ink-primary"
                        style={{ background: "var(--rc-chip-bg)", boxShadow: "var(--rc-chip-shadow)" }}
                      >
                        {expanded === interest.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    )}
                    {confirmDeleteId === interest.id ? (
                      <div className="flex items-center gap-2 rounded-2xl border border-apple-red/20 bg-[#FEF0EE] px-3 py-1.5">
                        <span className="text-xs text-apple-red">确认删除研究主题？论文和笔记将置为未归档。</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleDeleteInterest(interest.id)}
                          loading={deletingInterestId === interest.id}
                          disabled={interest.status === "planning"}
                          title={interest.status === "planning" ? "规划生成中，完成后才能删除该主题" : undefined}
                        >
                          确认
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setConfirmDeleteId(interest.id)}
                        disabled={interest.status === "planning"}
                        title={interest.status === "planning" ? "规划生成中，完成后才能删除该主题" : undefined}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-8 space-y-6">
                  <InterestProfilePanel
                    highlights={profileHighlights}
                    constraints={interest.profile?.constraints}
                    keywords={interest.keywords}
                  />

                  {editingFolderId === interest.id && (
                    <div className="rounded-2xl border border-nm-dark/10 bg-white/35 p-3">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),auto,auto]">
                        <Input
                          label="主题文件夹名称"
                          value={folderDraft}
                          onChange={(event) => setFolderDraft(event.target.value)}
                          placeholder="请输入文件夹名称"
                        />
                        <Button size="sm" onClick={() => void handleSaveFolder(interest.id)} loading={savingFolderId === interest.id}>
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingFolderId(null);
                            setFolderDraft("");
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  )}

                  {planError && (
                    <div className="flex items-start gap-2 rounded-2xl border border-apple-red/10 bg-[#F7ECEA] px-3 py-2 text-sm text-apple-red">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span className="break-all">{planError}</span>
                    </div>
                  )}

                  {agents.length > 0 && (
                    <div className="border-t border-nm-dark/10 pt-6">
                      <div className="agent-flow-shell">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <GitBranch className="h-3.5 w-3.5 text-apple-blue" />
                            <p className="text-xs font-semibold text-ink-primary">小妍工作流</p>
                          </div>
                          <p className="mt-1 text-[11px] leading-5 text-ink-tertiary">
                            实时展示主题分析、参考文献筛选与学习路径规划的协作状态。
                          </p>
                        </div>
                        <span className="text-[11px] text-ink-tertiary">
                          {hasRunningAgent ? "小妍规划中" : "阶段结果已同步"}
                        </span>
                      </div>

                      <div className="agent-flow-track" aria-hidden="true">
                        <span className="agent-flow-track__line" />
                        <span className={`agent-flow-track__signal${hasRunningAgent ? "" : " is-idle"}`} />
                      </div>

                      <div className="agent-flow-grid">
                        {agents.map((agent, index) => (
                          <div key={agent.id} className={`agent-flow-card agent-flow-card--${agent.status}`}>
                            <span
                              className="agent-flow-card__beam"
                              aria-hidden="true"
                              style={{ animationDelay: `${index * 140}ms` }}
                            />
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="agent-flow-card__meta">
                                  <span className="agent-flow-step">{String(index + 1).padStart(2, "0")}</span>
                                  <span className={`agent-flow-dot agent-flow-dot--${agent.status}`} aria-hidden="true" />
                                </div>
                                <p className="mt-3 truncate text-sm font-semibold text-ink-primary">{toCapabilityModelName(agent.name)}</p>
                                <p className="mt-1 truncate text-[11px] text-ink-tertiary">{replaceAgentWording(agent.role)}</p>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <Badge variant={agent.status === "done" ? "success" : agent.status === "failed" ? "danger" : "info"}>
                                  {agent.status === "done" ? "已完成" : agent.status === "failed" ? "失败" : "处理中"}
                                </Badge>
                                {agent.status === "failed" && (
                                  <button
                                    onClick={() => void handleGeneratePlan(interest, index)}
                                    className="text-[10px] text-apple-blue hover:underline font-medium"
                                  >
                                    重试该步骤
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className={`mt-3 text-[11px] leading-5 ${agent.error ? "text-apple-red" : "text-ink-secondary"}`}>
                              {agent.error || agent.summary || "等待小妍步骤输出阶段性结果。"}
                            </p>

                            <div className="agent-flow-progress" aria-hidden="true">
                              <span
                                className="agent-flow-progress__bar"
                                style={{ animationDelay: `${index * 140}ms` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {expanded === interest.id && interest.learning_path && (
                  <div className="border-t border-nm-dark/10 pt-6">
                    <div className="space-y-5">
                      <LearningPathView path={interest.learning_path} />
                      <ResearchWorkbench interest={interest} />
                    </div>
                  </div>
                )}
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
