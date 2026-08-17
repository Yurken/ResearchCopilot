import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Compass, FileText, Lightbulb, Loader2, Sparkles, Upload, Wand2, X } from "lucide-react";
import { Badge, Button, Card, Input, Textarea } from "@research-copilot/ui";
import { apiClient, formatErrorMessage } from "../../lib/client";
import type {
  ResearchInterest,
  ResearchInterestHintRequest,
  ResearchInterestHintResponse,
  ResearchInterestProfile,
} from "@research-copilot/types";
import {
  appendTag,
  buildPlannerSuggestions,
  FIELD_LABELS,
  isDraftField,
  mergePlannerSuggestions,
  parseTagInput,
  type PlannerSuggestionState,
} from "./plannerSuggestions";
import type { HypothesisPlanningDraft } from "./hypothesisPlanning";
import HypothesisPlanningCard from "./HypothesisPlanningCard";

interface PlannerComposerProps {
  onCancel?: () => void;
  onCreated: (
    interest: ResearchInterest,
    meta?: { uploadedReferences: number; failedUploads: string[] }
  ) => void;
  initialTopic?: string;
  initialDraft?: HypothesisPlanningDraft;
}

interface PlannerFormState {
  topic: string;
  keywordsRaw: string;
  goal: string;
  background: string;
  timeBudget: string;
  constraintsRaw: string;
  knownContext: string;
  preferredOutput: string;
}

const INITIAL_STATE: PlannerFormState = {
  topic: "",
  keywordsRaw: "",
  goal: "",
  background: "",
  timeBudget: "",
  constraintsRaw: "",
  knownContext: "",
  preferredOutput: "",
};

const AI_DEBOUNCE_MS = 700;

interface PendingReference {
  path: string;
  name: string;
}

function fieldTone(active: boolean) {
  if (!active) return "border-nm-dark/10 bg-white/30";
  return "border-apple-blue/30 bg-apple-blue/5";
}

function completedCount(state: PlannerFormState) {
  return [
    state.topic,
    state.keywordsRaw,
    state.goal,
    state.background,
    state.timeBudget,
    state.constraintsRaw,
    state.knownContext,
    state.preferredOutput,
  ].filter((value) => value.trim().length > 0).length;
}

function isAiConfigError(message: string) {
  return /not configured|api key/i.test(message);
}

function referenceNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
}

function normalizeSelectedPaths(selected: unknown): string[] {
  if (!selected) return [];
  if (typeof selected === "string") return [selected];
  if (Array.isArray(selected)) return selected.flatMap((item) => normalizeSelectedPaths(item));
  if (typeof selected === "object" && selected !== null && "path" in selected) {
    return [String((selected as { path: unknown }).path)];
  }
  return [];
}

function mapAiSuggestion(response: ResearchInterestHintResponse): PlannerSuggestionState {
  const nextField = isDraftField(response.next_field) ? response.next_field : "keywords";

  return {
    matchedDomains: response.matched_domains,
    nextField,
    nextFieldLabel: FIELD_LABELS[nextField],
    summary: response.summary,
    keywordSuggestions: response.keyword_suggestions,
    goalSuggestions: response.goal_suggestions,
    backgroundPrompts: response.background_prompts,
    timeBudgetSuggestions: response.time_budget_suggestions,
    constraintSuggestions: response.constraint_suggestions,
    knownContextSuggestions: response.known_context_suggestions,
    outputSuggestions: response.output_suggestions,
  };
}

export default function PlannerComposer({ onCancel, onCreated, initialTopic, initialDraft }: PlannerComposerProps) {
  const [form, setForm] = useState(() => initialDraft ? {
    ...INITIAL_STATE,
    topic: initialDraft.topic,
    keywordsRaw: initialDraft.keywords.join(", "),
    goal: initialDraft.goal,
    knownContext: initialDraft.knownContext,
    preferredOutput: initialDraft.preferredOutput,
  } : initialTopic ? { ...INITIAL_STATE, topic: initialTopic } : INITIAL_STATE);
  const [hypothesisCard, setHypothesisCard] = useState(initialDraft?.hypothesisCard ?? null);
  const [saving, setSaving] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "creating" | "uploading">("idle");
  const [error, setError] = useState("");
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<PlannerSuggestionState | null>(null);
  const [hintStatus, setHintStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const [hintMessage, setHintMessage] = useState("");
  const requestIdRef = useRef(0);
  const hintCacheRef = useRef(new Map<string, PlannerSuggestionState>());
  const aiDisabledRef = useRef(false);

  const keywords = useMemo(() => parseTagInput(form.keywordsRaw), [form.keywordsRaw]);
  const constraints = useMemo(() => parseTagInput(form.constraintsRaw), [form.constraintsRaw]);
  const fallbackSuggestions = useMemo(
    () =>
      buildPlannerSuggestions({
        topic: form.topic,
        keywords,
        goal: form.goal,
        background: form.background,
        time_budget: form.timeBudget,
        constraints,
        known_context: form.knownContext,
        preferred_output: form.preferredOutput,
      }),
    [constraints, form.background, form.goal, form.knownContext, form.preferredOutput, form.timeBudget, form.topic, keywords]
  );
  const hintPayload = useMemo<ResearchInterestHintRequest>(
    () => ({
      topic: form.topic.trim(),
      keywords,
      goal: form.goal.trim() || undefined,
      background: form.background.trim() || undefined,
      time_budget: form.timeBudget.trim() || undefined,
      constraints,
      known_context: form.knownContext.trim() || undefined,
      preferred_output: form.preferredOutput.trim() || undefined,
    }),
    [constraints, form.background, form.goal, form.knownContext, form.preferredOutput, form.timeBudget, form.topic, keywords]
  );
  const deferredHintPayload = useDeferredValue(hintPayload);
  const suggestions = useMemo(
    () => mergePlannerSuggestions(fallbackSuggestions, aiSuggestions),
    [aiSuggestions, fallbackSuggestions]
  );

  const set = <K extends keyof PlannerFormState>(key: K, value: PlannerFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const profile: ResearchInterestProfile = {
    goal: form.goal.trim() || undefined,
    background: form.background.trim() || undefined,
    time_budget: form.timeBudget.trim() || undefined,
    constraints: constraints.length > 0 ? constraints : undefined,
    known_context: form.knownContext.trim() || undefined,
    preferred_output: form.preferredOutput.trim() || undefined,
  };

  const hasProfile = Object.values(profile).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  );

  useEffect(() => {
    if (!deferredHintPayload.topic.trim()) {
      startTransition(() => {
        setAiSuggestions(null);
        setHintStatus("idle");
        setHintMessage("");
      });
      return;
    }

    if (aiDisabledRef.current) {
      startTransition(() => {
        setAiSuggestions(null);
        setHintStatus("fallback");
      });
      return;
    }

    const signature = JSON.stringify(deferredHintPayload);
    const cached = hintCacheRef.current.get(signature);
    if (cached) {
      startTransition(() => {
        setAiSuggestions(cached);
        setHintStatus("ready");
        setHintMessage("");
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    startTransition(() => {
      setHintStatus("loading");
      setHintMessage("");
    });

    const timeoutId = window.setTimeout(() => {
      void apiClient.knowledge.generateInterestHints(deferredHintPayload)
        .then((response) => {
          const nextSuggestions = mapAiSuggestion(response);
          hintCacheRef.current.set(signature, nextSuggestions);

          if (requestIdRef.current !== requestId) return;

          startTransition(() => {
            setAiSuggestions(nextSuggestions);
            setHintStatus("ready");
            setHintMessage("");
          });
        })
        .catch((nextError) => {
          if (requestIdRef.current !== requestId) return;

          const message = formatErrorMessage(nextError);
          if (isAiConfigError(message)) {
            aiDisabledRef.current = true;
          }

          startTransition(() => {
            setAiSuggestions(null);
            setHintStatus("fallback");
            setHintMessage(message);
          });
        });
    }, AI_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [deferredHintPayload]);

  const handleCreate = async () => {
    if (!form.topic.trim()) {
      setError("请先填写研究主题。");
      return;
    }
    if (hypothesisCard?.decision === "discarded") {
      setError("该候选假设已标记为放弃。请改为采用或修正后再创建研究规划。");
      return;
    }
    if (hypothesisCard?.decision === "draft") {
      setError("请先明确采用、修改或放弃该候选假设，再创建研究规划。");
      return;
    }

    setSaving(true);
    setSubmitPhase("creating");
    setError("");

    try {
      const interest = await apiClient.knowledge.createInterest(
        form.topic.trim(),
        keywords,
        hasProfile ? profile : undefined,
        hypothesisCard ?? undefined,
      );
      const failedUploads: string[] = [];
      let uploadedReferences = 0;

      if (pendingReferences.length > 0) {
        setSubmitPhase("uploading");

        for (const reference of pendingReferences) {
          try {
            await apiClient.papers.upload(reference.path, interest.id);
            uploadedReferences += 1;
          } catch (uploadError) {
            failedUploads.push(`${reference.name}：${formatErrorMessage(uploadError)}`);
          }
        }
      }

      setForm(INITIAL_STATE);
      setPendingReferences([]);
      setAiSuggestions(null);
      setHintStatus("idle");
      setHintMessage("");
      setSaving(false);
      setSubmitPhase("idle");
      void apiClient.memory.add({
        type: "auto",
        action: "interest.create",
        summary: `创建了研究主题：「${interest.folder_name?.trim() || interest.topic}」`,
        detail: JSON.stringify({ interest_id: interest.id }),
      });
      onCreated(interest, { uploadedReferences, failedUploads });
      return;
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
      setSaving(false);
      setSubmitPhase("idle");
    }
  };

  const handlePickReferences = async () => {
    if (saving) return;

    try {
      setError("");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      const nextPaths = normalizeSelectedPaths(selected);
      if (nextPaths.length === 0) return;

      setPendingReferences((prev) => {
        const seen = new Set(prev.map((item) => item.path));
        const merged = [...prev];
        for (const path of nextPaths) {
          if (seen.has(path)) continue;
          merged.push({ path, name: referenceNameFromPath(path) });
          seen.add(path);
        }
        return merged;
      });
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };

  const removePendingReference = (path: string) => {
    setPendingReferences((prev) => prev.filter((item) => item.path !== path));
  };

  const progress = completedCount(form);
  const createButtonLabel = submitPhase === "uploading"
    ? "正在导入参考文献…"
    : pendingReferences.length > 0
      ? "创建研究主题并导入参考文献"
      : "创建研究主题";

  return (
    <Card padding="md" className="space-y-4">
      {hypothesisCard ? (
        <HypothesisPlanningCard card={hypothesisCard} onChange={setHypothesisCard} />
      ) : null}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink-primary">研究画像输入</p>
          <p className="mt-1 text-xs leading-5 text-ink-tertiary">
            输入信息越完整，小妍生成的学习路线、资源推荐和候选研究切口就越准确。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">已补充 {progress}/8</Badge>
          <Badge variant={pendingReferences.length > 0 ? "success" : "default"}>
            参考文献 {pendingReferences.length} 篇
          </Badge>
          {onCancel && (
            <Button size="sm" variant="secondary" onClick={onCancel}>
              收起
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
        <div className="space-y-4">
          <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "topic")}`}>
            <div className="mb-3 flex items-center gap-2">
              <Compass className="h-4 w-4 text-apple-blue" />
              <p className="text-sm font-semibold text-ink-primary">1. 研究主题</p>
            </div>
            <Input
              value={form.topic}
              onChange={(event) => set("topic", event.target.value)}
              placeholder="例如：大模型对齐、时序基础模型、图学习用于药物发现"
            />

            {suggestions.matchedDomains.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.matchedDomains.map((item) => (
                  <span key={item} className="rc-accent-chip rounded-full px-2 py-1 text-[11px]">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>

          {form.topic.trim() && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "keywords")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#9A6A00]" />
                  <p className="text-sm font-semibold text-ink-primary">2. 关键词</p>
                </div>
                <Input
                  value={form.keywordsRaw}
                  onChange={(event) => set("keywordsRaw", event.target.value)}
                  placeholder="例如：LLM, Deep Learning, Alignment"
                />
                {suggestions.keywordSuggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestions.keywordSuggestions.slice(0, 8).map((keyword) => (
                      <button
                        key={keyword}
                        type="button"
                        onClick={() => set("keywordsRaw", appendTag(form.keywordsRaw, keyword))}
                        className="rounded-full bg-white/60 px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-apple-blue"
                      >
                        + {keyword}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "goal")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-[#34C759]" />
                  <p className="text-sm font-semibold text-ink-primary">3. 研究目标</p>
                </div>
                <Textarea
                  value={form.goal}
                  onChange={(event) => set("goal", event.target.value)}
                  rows={4}
                  placeholder="例如：先系统入门大模型对齐，再收敛到一个可复现的小课题"
                />
                {suggestions.goalSuggestions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {suggestions.goalSuggestions.slice(0, 3).map((goal) => (
                      <button
                        key={goal}
                        type="button"
                        onClick={() => set("goal", goal)}
                        className="w-full rounded-2xl bg-white/55 px-3 py-2 text-left text-xs leading-5 text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-ink-primary"
                      >
                        {goal}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {form.topic.trim() && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "background")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-[#AF52DE]" />
                  <p className="text-sm font-semibold text-ink-primary">4. 当前基础</p>
                </div>
                <Textarea
                  value={form.background}
                  onChange={(event) => set("background", event.target.value)}
                  rows={4}
                  placeholder="例如：学过深度学习和 NLP，读过 Transformer 与 InstructGPT，但没做过完整复现"
                />
                {suggestions.backgroundPrompts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] leading-5 text-ink-tertiary">建议补充以下基础信息：</p>
                    {suggestions.backgroundPrompts.slice(0, 2).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => set("background", form.background ? `${form.background}\n${prompt}` : prompt)}
                        className="w-full rounded-2xl bg-white/55 px-3 py-2 text-left text-xs leading-5 text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-ink-primary"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "time_budget")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-[#FF9500]" />
                  <p className="text-sm font-semibold text-ink-primary">5. 时间预算</p>
                </div>
                <Input
                  value={form.timeBudget}
                  onChange={(event) => set("timeBudget", event.target.value)}
                  placeholder="例如：8-12 周完成综述与单篇复现"
                />
                {suggestions.timeBudgetSuggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestions.timeBudgetSuggestions.slice(0, 5).map((budget) => (
                      <button
                        key={budget}
                        type="button"
                        onClick={() => set("timeBudget", budget)}
                        className="rounded-full bg-white/60 px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-apple-blue"
                      >
                        {budget}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {form.topic.trim() && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "constraints")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-[#5AC8FA]" />
                  <p className="text-sm font-semibold text-ink-primary">6. 约束条件</p>
                </div>
                <Input
                  value={form.constraintsRaw}
                  onChange={(event) => set("constraintsRaw", event.target.value)}
                  placeholder="例如：单卡 24G，公开数据集，中文资源优先"
                />
                <p className="mt-2 text-[11px] leading-5 text-ink-tertiary">
                  支持用英文逗号、中文逗号、分号或换行分隔。这里填写的是研究过程中的限制条件，
                  例如算力/显存、时间周期、数据是否公开、论文来源、复现要求、语言偏好等。
                </p>
                {suggestions.constraintSuggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestions.constraintSuggestions.slice(0, 6).map((constraint) => (
                      <button
                        key={constraint}
                        type="button"
                        onClick={() => set("constraintsRaw", appendTag(form.constraintsRaw, constraint))}
                        className="rounded-full bg-white/60 px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-apple-blue"
                      >
                        + {constraint}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "known_context")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#34C759]" />
                  <p className="text-sm font-semibold text-ink-primary">7. 已知论文/方法</p>
                </div>
                <Textarea
                  value={form.knownContext}
                  onChange={(event) => set("knownContext", event.target.value)}
                  rows={4}
                  placeholder="例如：了解 Transformer、GPT、Llama，想进一步比较 RLHF 与 DPO"
                />
                {suggestions.knownContextSuggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestions.knownContextSuggestions.slice(0, 6).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => set("knownContext", form.knownContext ? `${form.knownContext}，${item}` : item)}
                        className="rounded-full bg-white/60 px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-apple-blue"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {form.topic.trim() && (
            <div className={`rounded-3xl border p-4 ${fieldTone(suggestions.nextField === "preferred_output")}`}>
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-apple-blue" />
                <p className="text-sm font-semibold text-ink-primary">8. 期望输出</p>
              </div>
              <Input
                value={form.preferredOutput}
                onChange={(event) => set("preferredOutput", event.target.value)}
                placeholder="例如：学习路线 + 论文清单 + 可复现实验路线"
              />
              {suggestions.outputSuggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.outputSuggestions.slice(0, 6).map((output) => (
                    <button
                      key={output}
                      type="button"
                      onClick={() => set("preferredOutput", output)}
                      className="rounded-full bg-white/60 px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-apple-blue/10 hover:text-apple-blue"
                    >
                      {output}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {form.topic.trim() && (
            <div className="rounded-3xl border border-nm-dark/10 bg-white/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-[#0A84C1]" />
                  <p className="text-sm font-semibold text-ink-primary">9. 参考文献（可选）</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => void handlePickReferences()}>
                  <Upload className="h-3.5 w-3.5" />
                  选择 PDF
                </Button>
              </div>

              <p className="text-xs leading-5 text-ink-tertiary">
                当前选中的 PDF 会在创建研究主题后自动导入对应主题文件夹，并绑定到稳定的研究主题 ID。
                后续修改主题文件夹名，不会影响这些参考文献的归属。
              </p>

              {pendingReferences.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {pendingReferences.map((reference) => (
                    <div
                      key={reference.path}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-nm-dark/10 bg-white/55 px-3 py-2"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <FileText className="h-4 w-4 flex-shrink-0 text-apple-blue" />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink-primary">{reference.name}</p>
                          <p className="truncate text-[11px] text-ink-tertiary">{reference.path}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePendingReference(reference.path)}
                        className="rounded-full p-1 text-ink-tertiary transition-colors hover:bg-white/60 hover:text-ink-primary"
                        aria-label={`移除 ${reference.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-nm-dark/10 bg-white/25 px-4 py-5 text-center text-xs text-ink-tertiary">
                  当前也可先跳过，后续仍可在研究路线工作台中继续上传论文。
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card padding="sm" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-apple-blue" />
                <p className="text-sm font-semibold text-ink-primary">智能提示</p>
              </div>
              <Badge variant={hintStatus === "fallback" ? "default" : "info"}>
                {hintStatus === "loading" ? "小妍处理中" : hintStatus === "ready" ? "小妍实时建议" : hintStatus === "fallback" ? "本地兜底" : "待输入"}
              </Badge>
            </div>

            <div className="rounded-2xl bg-white/45 p-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">系统理解</p>
              <div className="mt-2 flex items-start gap-2">
                {hintStatus === "loading" && <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-apple-blue" />}
                <p className="text-sm leading-6 text-ink-secondary">
                  {hintStatus === "loading"
                    ? "小妍正在根据你刚刚输入的内容更新建议，当前先显示最近一次结果。"
                    : suggestions.summary}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/45 p-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">建议下一步</p>
              <p className="mt-2 text-base font-semibold text-ink-primary">{suggestions.nextFieldLabel}</p>
              <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                当前信息已足以触发这一项的更精准建议；继续补充后，整体规划会明显更聚焦。
              </p>
            </div>

            {hintStatus === "fallback" && hintMessage && (
              <div className="rounded-2xl border border-[#E7D7AA] bg-[#FBF6E7] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[#9A6A00]">AI 建议暂不可用</p>
                <p className="mt-2 text-xs leading-5 text-[#7D5A00]">
                  当前显示本地兜底建议。原因：{hintMessage}
                </p>
              </div>
            )}

            <div className="rounded-2xl bg-white/45 p-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">已识别方向</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.matchedDomains.length > 0 ? suggestions.matchedDomains.map((item) => (
                  <Badge key={item} variant="info">{item}</Badge>
                )) : <span className="text-xs text-ink-tertiary">请先填写研究主题</span>}
              </div>
            </div>

            <div className="rounded-2xl bg-white/45 p-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">为什么要补这些</p>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-ink-secondary">
                <li className="list-disc">主题 + 关键词用于识别具体方向与检索语义。</li>
                <li className="list-disc">目标 + 基础决定学习路线深度，不然规划容易空泛。</li>
                <li className="list-disc">时间预算 + 约束决定推荐资源和任务粒度。</li>
                <li className="list-disc">已知论文/方法 + 期望输出决定最后生成物更像综述还是实验路线。</li>
                <li className="list-disc">参考文献会在建好主题后自动归档进去，后续规划会优先参考当前主题下的论文。</li>
              </ul>
            </div>
          </Card>

          {error && (
            <div className="rounded-2xl border border-apple-red/10 bg-[#F7ECEA] px-3 py-2 text-sm text-apple-red">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button variant="secondary" onClick={onCancel}>
                取消
              </Button>
            )}
            <Button loading={saving} onClick={() => void handleCreate()}>
              {createButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
