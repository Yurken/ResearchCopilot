import { AlertCircle, FileCheck2 } from "lucide-react";
import { Card, Select } from "@research-copilot/ui";
import { DocumentComparisonReportPanel } from "./DocumentComparisonReportPanel";
import { DocumentPairPanel } from "./DocumentPairPanel";
import { useDocumentChecker } from "./useDocumentChecker";

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm text-apple-red"
      style={{
        background: "color-mix(in srgb, var(--rc-card-inset-bg) 88%, var(--rc-danger, #FF3B30) 12%)",
        borderColor: "color-mix(in srgb, var(--rc-danger, #FF3B30) 24%, var(--rc-border))",
        boxShadow: "var(--rc-card-inset-shadow)",
      }}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function DocumentCheckerWorkspace() {
  const checker = useDocumentChecker();

  return (
    <div className="space-y-5">
      <Card padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink-primary">规范文档与成稿比对</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-tertiary">
                从规范文档提取页面、页边距、字体、字号和页数要求，再检查成稿中的格式差异、编号、引用与修订残留。
              </p>
            </div>
          </div>
          <div className="w-full sm:w-72">
            <Select
              label="规范文件角色"
              value={checker.referenceMode}
              onChange={(value) => checker.setReferenceMode(value as typeof checker.referenceMode)}
              options={[
                { value: "explicit_rules", label: "投稿指南（只采信明确规则）" },
                { value: "template", label: "官方模板（采信文档版式）" },
              ]}
            />
            <p className="mt-1.5 text-[11px] leading-4 text-ink-tertiary">
              投稿指南未明确写出的项目会标为待确认，不再自动套用指南自身版式。
            </p>
          </div>
        </div>
      </Card>

      <DocumentPairPanel
        referenceFile={checker.referenceFile}
        candidateFile={checker.candidateFile}
        loading={checker.loading}
        canCompare={checker.canCompare}
        onChoose={checker.chooseFile}
        onClear={checker.clearFile}
        onCompare={checker.runComparison}
      />

      <ErrorNotice message={checker.error} />
      {checker.report ? <DocumentComparisonReportPanel report={checker.report} /> : null}
    </div>
  );
}
