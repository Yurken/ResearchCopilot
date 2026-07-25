import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlaskConical,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button, Card, ConfirmDialog, Input, Select, Textarea } from "@research-copilot/ui";
import type { ExperimentRecord } from "@research-copilot/types";
import { experimentApi, submissionApi, formatErrorMessage } from "../../lib/client";
import { useDomainEventRefresh } from "../../hooks/useDomainEventRefresh";
import { ExperimentAttachmentPanel } from "./ExperimentAttachmentPanel";
import { mapExperimentRecord } from "./shared";

interface SubmissionItem {
  id: string;
  title: string;
}

interface ExperimentRecordPanelProps {
  onError?: (message: string) => void;
  activeExperimentId?: string | null;
  onActiveExperimentChange?: (experiment: ExperimentRecord | null) => void;
}

export function ExperimentRecordPanel({
  onError,
  activeExperimentId,
  onActiveExperimentChange,
}: ExperimentRecordPanelProps) {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("");
  const [editConfig, setEditConfig] = useState("{}");
  const [editResult, setEditResult] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editLinked, setEditLinked] = useState("");
  const [configError, setConfigError] = useState("");

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const selectedId = activeExperimentId === undefined ? internalSelectedId : activeExperimentId;
  const selected = experiments.find((e) => e.id === selectedId) ?? null;

  function selectExperiment(experiment: ExperimentRecord | null) {
    setInternalSelectedId(experiment?.id ?? null);
    onActiveExperimentChange?.(experiment);
  }

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }, []);

  const loadExperiments = useCallback(async () => {
    try {
      const [expResult, subResult] = await Promise.all([
        experimentApi.list(),
        submissionApi.list(),
      ]);
      const expRaw = (expResult as { experiments: unknown[] }).experiments ?? [];
      setExperiments(expRaw.map(mapExperimentRecord));
      const subRaw = ((subResult as { submissions?: unknown[] }).submissions ?? []) as Record<string, unknown>[];
      setSubmissions(subRaw.map((s) => ({ id: String(s.id ?? ""), title: String(s.title ?? "") })));
    } catch (error) {
      const message = `加载实验记录失败：${formatErrorMessage(error)}`;
      if (onError) onError(message);
      else showToast(message);
    }
  }, [onError, showToast]);

  useEffect(() => {
    setLoading(true);
    loadExperiments().finally(() => setLoading(false));
  }, [loadExperiments]);

  useDomainEventRefresh("experiment:created", () => { loadExperiments(); });

  useEffect(() => {
    if (!selected) {
      setEditTitle(""); setEditConfig("{}"); setEditResult(""); setEditNotes(""); setEditLinked(""); setConfigError("");
      return;
    }
    setEditTitle(selected.title);
    setEditConfig(JSON.stringify(selected.config, null, 2));
    setEditResult(selected.result);
    setEditNotes(selected.notes);
    setEditLinked(selected.linkedSubmissionId ?? "");
    setConfigError("");
  }, [selected]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await experimentApi.create({ title: "新实验记录" });
      const newExp: ExperimentRecord = {
        id: res.id, title: "新实验记录", config: {}, result: "", notes: "",
        linkedSubmissionId: null, defaultWorkingDir: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      setExperiments((prev) => [newExp, ...prev]);
      selectExperiment(newExp);
      setNewlyCreatedId(res.id);
      setTimeout(() => titleInputRef.current?.select(), 50);
    } catch (err) {
      showToast(formatErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    if (!selectedId || !selected) return;
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = JSON.parse(editConfig);
      setConfigError("");
    } catch {
      setConfigError("JSON 格式错误，请检查配置内容");
      return;
    }
    setSaving(true);
    try {
      await experimentApi.update(selectedId, {
        title: editTitle, config: parsedConfig, result: editResult,
        notes: editNotes, linkedSubmissionId: editLinked,
      });
      const updated: ExperimentRecord = {
        ...selected,
        title: editTitle,
        config: parsedConfig,
        result: editResult,
        notes: editNotes,
        linkedSubmissionId: editLinked || null,
        updatedAt: new Date().toISOString(),
      };
      setExperiments((prev) => prev.map((experiment) => experiment.id === selectedId ? updated : experiment));
      onActiveExperimentChange?.(updated);
      setNewlyCreatedId(null);
      showToast("已保存");
    } catch (err) {
      showToast(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(id: string) {
    setPendingDeleteId(id);
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    try {
      setDeleting(true);
      await experimentApi.delete(pendingDeleteId);
      const remaining = experiments.filter((experiment) => experiment.id !== pendingDeleteId);
      setExperiments(remaining);
      if (selectedId === pendingDeleteId) selectExperiment(remaining[0] ?? null);
      if (newlyCreatedId === pendingDeleteId) setNewlyCreatedId(null);
      setPendingDeleteId(null);
    } catch (err) {
      showToast(formatErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--rc-surface)" }}>
      <div className="flex flex-col h-full">
        <div className="flex flex-1 min-h-0 overflow-hidden max-lg:flex-col">
          {/* Left: list */}
          <div className="w-60 flex-shrink-0 flex flex-col overflow-hidden border-r border-nm-dark/20 max-lg:h-52 max-lg:w-full max-lg:border-r-0 max-lg:border-b">
            {/* New button */}
            <div className="p-3 flex-shrink-0 border-b border-nm-dark/10">
              <Button
                variant="secondary"
                onClick={handleCreate}
                disabled={creating}
                className="w-full"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                新建记录
              </Button>
            </div>
            {/* List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 max-lg:grid max-lg:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] max-lg:gap-2 max-lg:space-y-0">
              {loading ? (
                <div className="flex justify-center pt-10"><Loader2 className="w-5 h-5 animate-spin text-ink-tertiary" /></div>
              ) : experiments.length === 0 ? (
                <p className="text-xs text-ink-tertiary text-center pt-10 px-2">暂无记录，点击上方「新建」开始。</p>
              ) : (
                experiments.map((exp) => (
                  <div
                    key={exp.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectExperiment(exp)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectExperiment(exp); } }}
                    className="w-full text-left rounded-2xl px-3 py-2.5 transition-all duration-150 group cursor-pointer"
                    style={
                      selectedId === exp.id
                        ? { background: "var(--rc-card-inset-bg)", boxShadow: "var(--rc-inset-shadow)", borderLeft: "3px solid #007AFF" }
                        : { background: "var(--rc-surface)", boxShadow: "var(--rc-chip-shadow)" }
                    }
                    onMouseEnter={(e) => {
                      if (exp.id !== selectedId) {
                        e.currentTarget.style.boxShadow = "var(--rc-inset-shadow)";
                        e.currentTarget.style.background = "var(--rc-card-inset-bg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (exp.id !== selectedId) {
                        e.currentTarget.style.boxShadow = "var(--rc-chip-shadow)";
                        e.currentTarget.style.background = "var(--rc-surface)";
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-semibold text-ink-primary truncate leading-5">{exp.title}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); requestDelete(exp.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-tertiary hover:text-apple-red flex-shrink-0 mt-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[11px] text-ink-secondary mt-0.5">
                      {new Date(exp.updatedAt).toLocaleDateString("zh-CN")}
                    </p>
                    {exp.linkedSubmissionId && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "rgba(0,122,255,0.1)", color: "#007AFF" }}>
                        <Link2 className="w-2.5 h-2.5" />
                        已关联投稿
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 max-lg:p-4">
            {!selected ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto" style={{ background: "var(--rc-card-inset-bg)", boxShadow: "var(--rc-inset-shadow)" }}>
                    <FlaskConical className="w-7 h-7 text-ink-tertiary/50" />
                  </div>
                  <p className="text-sm text-ink-tertiary">从左侧选择记录，或新建一条</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-2xl mx-auto pb-6">
                {/* Actions */}
                <div className="flex justify-end gap-2">
                  {newlyCreatedId === selected.id && (
                    <Button
                      variant="secondary"
                      onClick={() => requestDelete(selected.id)}
                    >
                      <X className="w-4 h-4" />
                      取消
                    </Button>
                  )}
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存
                  </Button>
                </div>

                {/* Title */}
                <Input
                  label="标题"
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="实验名称"
                />

                {/* Linked submission */}
                <Select
                  label="关联投稿（可选）"
                  value={editLinked}
                  onChange={setEditLinked}
                  options={[
                    { value: "", label: "— 不关联 —" },
                    ...submissions.map((submission) => ({ value: submission.id, label: submission.title })),
                  ]}
                />

                {/* Config JSON */}
                <Card variant="inset" padding="sm" className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink-primary">实验配置</p>
                    <p className="text-[10px] text-ink-tertiary">JSON 格式，保存超参数、路径等信息</p>
                  </div>
                  <Textarea
                    value={editConfig}
                    onChange={(e) => { setEditConfig(e.target.value); setConfigError(""); }}
                    rows={7}
                    error={configError}
                    placeholder={'{\n  "lr": 0.001,\n  "epochs": 100,\n  "batch_size": 32\n}'}
                    style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: "12px" }}
                  />
                </Card>

                {/* Result */}
                <Card variant="inset" padding="sm" className="space-y-2">
                  <p className="text-xs font-semibold text-ink-primary">实验结果</p>
                  <Textarea
                    value={editResult}
                    onChange={(e) => setEditResult(e.target.value)}
                    rows={5}
                    placeholder="记录实验指标、对比分析、图表说明…"
                  />
                </Card>

                {/* Screenshots */}
                <Card variant="inset" padding="sm">
                  <ExperimentAttachmentPanel experimentId={selected.id} onError={onError ?? showToast} />
                </Card>

                {/* Notes */}
                <Card variant="inset" padding="sm" className="space-y-2">
                  <p className="text-xs font-semibold text-ink-primary">备注与分析</p>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder="分析实验现象、后续改进计划、与其他实验的对比…"
                  />
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-2xl text-sm font-medium text-white pointer-events-none z-50"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
        >
          {toast}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="删除实验记录"
        description={`确认删除「${experiments.find((item) => item.id === pendingDeleteId)?.title ?? "该实验记录"}」？此操作无法撤销。`}
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={deleting}
        onClose={() => {
          if (!deleting) setPendingDeleteId(null);
        }}
        onConfirm={() => {
          void confirmDelete();
        }}
      />
    </div>
  );
}
