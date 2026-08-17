import { CheckCircle2, Circle } from "lucide-react";
import { Button, Card } from "@research-copilot/ui";
import DiagnosisReportPanel from "./DiagnosisReportPanel";
import RevisionTaskPanel from "./RevisionTaskPanel";
import SubmissionPaperSidebar from "./SubmissionPaperSidebar";
import {
  STATUS_CFG,
  type ChecklistItem,
  type PaperVersion,
  type RevisionTaskStatus,
  type Submission,
  type SubmissionDiagnosisReport,
  type SubmissionRevisionTask,
} from "./shared";

interface ChecklistWorkspaceProps {
  submissions: Submission[];
  checklistSubId: string;
  checklist: ChecklistItem[];
  checklistCat: string;
  categories: string[];
  visibleCategories: string[];
  filteredChecklist: ChecklistItem[];
  diagnosisReports: SubmissionDiagnosisReport[];
  diagnosisLoading: boolean;
  importingDiagnosisReportId: string | null;
  revisionTasks: SubmissionRevisionTask[];
  revisionVersions: PaperVersion[];
  revisionLoading: boolean;
  importingRevisionTaskReportId: string | null;
  updatingRevisionTaskId: string | null;
  checkedCount: number;
  progress: number;
  onSelectSubmission: (submissionId: string) => void;
  onReset: () => void;
  onSelectCategory: (category: string) => void;
  onToggleCheck: (id: string) => void;
  onImportDiagnosisReport: (reportId: string) => void | Promise<void>;
  onImportDiagnosisTasks: (reportId: string) => void | Promise<void>;
  onUpdateRevisionTask: (
    taskId: string,
    patch: Partial<{ status: RevisionTaskStatus; paperVersionId: string }>,
  ) => void | Promise<void>;
}

export default function ChecklistWorkspace({
  submissions,
  checklistSubId,
  checklist,
  checklistCat,
  categories,
  visibleCategories,
  filteredChecklist,
  diagnosisReports,
  diagnosisLoading,
  importingDiagnosisReportId,
  revisionTasks,
  revisionVersions,
  revisionLoading,
  importingRevisionTaskReportId,
  updatingRevisionTaskId,
  checkedCount,
  progress,
  onSelectSubmission,
  onReset,
  onSelectCategory,
  onToggleCheck,
  onImportDiagnosisReport,
  onImportDiagnosisTasks,
  onUpdateRevisionTask,
}: ChecklistWorkspaceProps) {
  const currentSubmission = submissions.find((submission) => submission.id === checklistSubId);

  if (submissions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 opacity-50">
        <CheckCircle2 className="w-10 h-10 text-ink-tertiary" />
        <p className="text-sm text-ink-tertiary">先在投稿看板中新建投稿，再整理提交前检查清单</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 xl:flex-row">
      <SubmissionPaperSidebar
        submissions={submissions}
        selectedSubmissionId={checklistSubId}
        onSelectSubmission={onSelectSubmission}
        renderMeta={(submission, active) => {
          const statusStyle = STATUS_CFG[submission.status];
          return (
            <span
              className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={
                active
                  ? { background: "rgba(255,255,255,0.22)", color: "#fff" }
                  : { background: statusStyle.bg, color: statusStyle.color }
              }
            >
              {statusStyle.label}
            </span>
          );
        }}
      />

      <div className="flex-1 min-w-0 space-y-5 overflow-y-auto">
        <Card padding="md" variant="flat" className="flex items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-semibold text-ink-primary">提交前检查</p>
                <p className="text-xs text-ink-tertiary mt-0.5 line-clamp-1">{currentSubmission?.title}</p>
              </div>
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: progress === 100 ? "#34C759" : "#007AFF" }}
              >
                {checkedCount} / {checklist.length}
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "var(--rc-card-inset-bg)", boxShadow: "var(--rc-card-inset-shadow)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: progress === 100 ? "#34C759" : "linear-gradient(90deg, #007AFF, #5856D6)",
                }}
              />
            </div>
          </div>
          {progress === 100 ? (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(52,199,89,0.10)" }}
            >
              <CheckCircle2 className="w-4 h-4" style={{ color: "#34C759" }} />
              <span className="text-xs font-medium" style={{ color: "#34C759" }}>可以投稿了</span>
            </div>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            重置
          </Button>
        </Card>

        <DiagnosisReportPanel
          reports={diagnosisReports}
          loading={diagnosisLoading}
          importingReportId={importingDiagnosisReportId}
          importingTaskReportId={importingRevisionTaskReportId}
          onImportReport={onImportDiagnosisReport}
          onImportTasks={onImportDiagnosisTasks}
        />

        <RevisionTaskPanel
          tasks={revisionTasks}
          versions={revisionVersions}
          loading={revisionLoading}
          updatingTaskId={updatingRevisionTaskId}
          onUpdateTask={onUpdateRevisionTask}
        />

        <div
          className="inline-flex flex-wrap items-center gap-1 rounded-2xl p-1"
          style={{ background: "var(--rc-card-inset-bg)", boxShadow: "var(--rc-card-inset-shadow)" }}
        >
          {categories.map((category) => {
            const categoryCount = checklist.filter((item) => item.category === category).length;
            const categoryChecked = checklist.filter((item) => item.category === category && item.checked).length;
            return (
              <button
                key={category}
                type="button"
                onClick={() => onSelectCategory(category)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150"
                style={checklistCat === category
                  ? { background: "var(--rc-elevated)", boxShadow: "var(--rc-raised-shadow)", color: "var(--rc-text)" }
                  : { color: "var(--rc-text-muted)" }}
              >
                {category === "all" ? "全部" : category}
                {category !== "all" ? (
                  <span className={checklistCat === category ? "opacity-70" : "opacity-50"}>
                    {categoryChecked}/{categoryCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 2xl:grid-cols-2">
          {visibleCategories.map((category) => (
            <div key={category} className="space-y-2">
              <p className="text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider px-1">
                {category}
              </p>
              <Card padding="sm" className="space-y-1">
                {filteredChecklist
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onToggleCheck(item.id)}
                      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left transition-all duration-150 hover:bg-black/[0.03]"
                    >
                      {item.checked
                        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#34C759" }} />
                        : <Circle className="w-4 h-4 flex-shrink-0 text-ink-tertiary" />
                      }
                      <span
                        className="text-[13px] leading-snug transition-all duration-150"
                        style={{
                          color: item.checked ? "#34C759" : "var(--rc-text-primary)" as string,
                          textDecoration: item.checked ? "line-through" : "none",
                          opacity: item.checked ? 0.6 : 1,
                        }}
                      >
                        {item.label}
                      </span>
                    </button>
                  ))}
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
