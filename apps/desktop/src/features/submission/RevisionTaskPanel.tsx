import { ClipboardCheck, Loader2 } from "lucide-react";
import { Card } from "@research-copilot/ui";
import {
  REVISION_TASK_PRIORITY_CFG,
  REVISION_TASK_STATUS_CFG,
  type PaperVersion,
  type RevisionTaskStatus,
  type SubmissionRevisionTask,
} from "./shared";

interface RevisionTaskPanelProps {
  tasks: SubmissionRevisionTask[];
  versions: PaperVersion[];
  loading: boolean;
  updatingTaskId: string | null;
  onUpdateTask: (
    taskId: string,
    patch: Partial<{ status: RevisionTaskStatus; paperVersionId: string }>,
  ) => void | Promise<void>;
}

const STATUS_OPTIONS: Array<{ value: RevisionTaskStatus; label: string }> = [
  { value: "todo", label: "待处理" },
  { value: "in_progress", label: "处理中" },
  { value: "done", label: "已完成" },
];

export default function RevisionTaskPanel({
  tasks,
  versions,
  loading,
  updatingTaskId,
  onUpdateTask,
}: RevisionTaskPanelProps) {
  return (
    <Card padding="md" variant="flat" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-ink-tertiary" />
            <p className="font-semibold text-ink-primary">修改任务与证据链</p>
          </div>
          <p className="mt-0.5 text-xs text-ink-tertiary">
            {tasks.length > 0 ? `${tasks.length} 个任务 · 可关联论文版本` : "诊断报告转出的任务会出现在这里"}
          </p>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" /> : null}
      </div>

      {tasks.length === 0 ? (
        <p
          className="rounded-2xl px-3 py-2 text-xs leading-5 text-ink-tertiary"
          style={{ background: "var(--rc-card-inset-bg)", border: "1px solid var(--rc-card-inset-outline)" }}
        >
          暂无修改任务。可从上方诊断报告转出任务，再为每个问题补充新版本。
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const statusStyle = REVISION_TASK_STATUS_CFG[task.status];
            const priorityStyle = REVISION_TASK_PRIORITY_CFG[task.priority];
            const updating = updatingTaskId === task.id;

            return (
              <div
                key={task.id}
                className="rounded-2xl px-3 py-2.5"
                style={{ background: "var(--rc-card-inset-bg)", border: "1px solid var(--rc-card-inset-outline)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg px-2 py-0.5 text-[11px] font-bold" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                        {statusStyle.label}
                      </span>
                      <span className="rounded-lg px-2 py-0.5 text-[11px] font-bold" style={{ background: priorityStyle.bg, color: priorityStyle.color }}>
                        {priorityStyle.label}风险
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold leading-6 text-ink-primary">{task.title}</p>
                    {task.detail ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-ink-tertiary">{task.detail}</p> : null}
                  </div>
                  {updating ? <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" /> : null}
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <select
                    value={task.status}
                    disabled={updating}
                    onChange={(event) => void onUpdateTask(task.id, { status: event.target.value as RevisionTaskStatus })}
                    className="rounded-xl px-2 py-1.5 text-xs text-ink-secondary outline-none"
                    style={{ background: "var(--rc-elevated)", border: "1px solid var(--rc-border)" }}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>

                  <select
                    value={task.paperVersionId ?? ""}
                    disabled={updating}
                    onChange={(event) => void onUpdateTask(task.id, { paperVersionId: event.target.value })}
                    className="rounded-xl px-2 py-1.5 text-xs text-ink-secondary outline-none"
                    style={{ background: "var(--rc-elevated)", border: "1px solid var(--rc-border)" }}
                  >
                    <option value="">关联论文版本</option>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.tag || "版本"} · {version.label || version.stage}
                      </option>
                    ))}
                  </select>

                </div>

                {(task.paperVersionLabel || task.experimentTitle) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {task.paperVersionLabel ? (
                      <span className="rounded-lg px-2 py-1 text-[11px] text-ink-secondary" style={{ background: "var(--rc-chip-bg)" }}>
                        版本：{task.paperVersionTag ? `${task.paperVersionTag} · ` : ""}{task.paperVersionLabel}
                      </span>
                    ) : null}
                    {task.experimentTitle ? (
                      <span className="rounded-lg px-2 py-1 text-[11px] text-ink-secondary" style={{ background: "var(--rc-chip-bg)" }}>
                        实验：{task.experimentTitle}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
