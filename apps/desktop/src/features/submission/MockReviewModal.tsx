import type { Dispatch, SetStateAction } from "react";
import { Bot, Check, CheckCircle2, ClipboardList, Loader2, Sparkles, Upload, X } from "lucide-react";
import { MarkdownRenderer } from "@research-copilot/ui";
import {
  VERDICT_CFG,
  countVerdicts,
  getDominantVerdict,
  type MockReviewInput,
  type MockReviewerResult,
  type ReviewFeedbackStatus,
  type ReviewVerdict,
} from "./shared";
import { openLink } from "../../lib/links";
import ReviewSuggestionFeedbackPanel from "./ReviewSuggestionFeedbackPanel";

interface MockReviewModalProps {
  open: boolean;
  mockReviewInput: MockReviewInput;
  mockReviewResult: MockReviewerResult[] | null;
  mockReviewLoading: boolean;
  mockFileExtracting: boolean;
  mockFileName: string | null;
  onClose: () => void;
  onSetInput: Dispatch<SetStateAction<MockReviewInput>>;
  onPickPdf: () => void | Promise<void>;
  onReset: () => void;
  onImport: () => void | Promise<void>;
  onGenerate: () => void;
  onDiagnose?: () => void | Promise<void>;
  diagnosisLoading?: boolean;
  feedback: Record<string, { status: ReviewFeedbackStatus; reason: string }>;
  feedbackSavingKey: string | null;
  feedbackSummary: Record<ReviewFeedbackStatus, number>;
  onFeedback: (result: MockReviewerResult, suggestionIndex: number, status: Exclude<ReviewFeedbackStatus, "pending">, reason?: string) => void | Promise<unknown>;
}

export default function MockReviewModal({
  open,
  mockReviewInput,
  mockReviewResult,
  mockReviewLoading,
  mockFileExtracting,
  mockFileName,
  onClose,
  onSetInput,
  onPickPdf,
  onReset,
  onImport,
  onGenerate,
  onDiagnose,
  diagnosisLoading,
  feedback,
  feedbackSavingKey,
  feedbackSummary,
  onFeedback,
}: MockReviewModalProps) {
  if (!open) {
    return null;
  }

  const hasResults = (mockReviewResult?.length ?? 0) > 0;
  const verdictCounts = hasResults ? countVerdicts(mockReviewResult ?? []) : null;
  const dominantVerdict = verdictCounts ? getDominantVerdict(verdictCounts) : null;
  const dominantStyle = dominantVerdict ? VERDICT_CFG[dominantVerdict] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--rc-modal-backdrop)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-3xl overflow-hidden flex flex-col"
        style={{ background: "var(--rc-modal-bg)", boxShadow: "var(--rc-modal-shadow)", maxHeight: "88vh" }}
      >
        <div className="px-6 py-5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid var(--rc-border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(175,82,222,0.12)" }}>
              <Bot className="w-4 h-4" style={{ color: "#AF52DE" }} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink-primary">AI 多视角预审</h2>
              <p className="text-xs text-ink-tertiary mt-0.5">由不同职责的 AI 审稿人独立诊断，辅助投稿前自查</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--rc-list-item-hover-bg)] transition-colors">
            <X className="w-5 h-5 text-ink-tertiary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!hasResults ? (
            <div className="p-6 space-y-4">
              {mockFileExtracting ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#AF52DE" }} />
                  <p className="text-sm font-medium text-ink-secondary">正在读取 PDF 文件内容…</p>
                  <p className="text-xs text-ink-tertiary">完成后可在下方编辑并调整审稿参数</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {mockFileName ? (
                      <div
                        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg"
                        style={{ background: "rgba(52,199,89,0.10)", color: "#34C759" }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        已读取：{mockFileName}
                      </div>
                    ) : (
                      <span className="text-[11px] text-ink-tertiary">未选择文件，可手动输入内容或：</span>
                    )}
                    <button
                      onClick={() => void onPickPdf()}
                      className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                      style={{
                        background: "var(--rc-card-inset-bg)",
                        color: "var(--rc-text-secondary)" as string,
                        border: "1px solid var(--rc-border)",
                      }}
                    >
                      <Upload className="w-3 h-3" />
                      {mockFileName ? "换一个 PDF" : "选择 PDF 文件"}
                    </button>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-ink-secondary mb-1.5">
                      论文内容
                      <span className="ml-1 text-ink-tertiary font-normal">（PDF 提取全文 · 可编辑）</span>
                    </p>
                    <textarea
                      rows={8}
                      placeholder="PDF 提取全文或手动粘贴摘要/核心方法描述…"
                      value={mockReviewInput.abstract}
                      onChange={(event) =>
                        onSetInput((currentInput) => ({ ...currentInput, abstract: event.target.value }))
                      }
                      className="w-full px-3 py-2.5 rounded-xl text-sm resize-none leading-relaxed"
                      style={{
                        background: "var(--rc-card-inset-bg)",
                        boxShadow: "inset 2px 2px 5px rgba(0,0,0,0.08)",
                        color: "var(--rc-text-primary)" as string,
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-ink-secondary mb-1.5">审稿人数量</p>
                      <div className="flex gap-2">
                        {([2, 3, 4] as const).map((count) => (
                          <button
                            key={count}
                            onClick={() =>
                              onSetInput((currentInput) => ({ ...currentInput, reviewerCount: count }))
                            }
                            className="flex-1 py-1.5 rounded-xl text-sm font-medium transition-all duration-150"
                            style={
                              mockReviewInput.reviewerCount === count
                                ? { background: "#AF52DE", color: "#fff" }
                                : { background: "var(--rc-card-inset-bg)", color: "var(--rc-text-secondary)" as string }
                            }
                          >
                            {count === 2 ? "方法+实验" : count === 3 ? "三视角" : "三审稿人+AC"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-ink-secondary mb-1.5">审稿严格程度</p>
                      <div className="flex gap-2">
                        {([
                          { key: "lenient", label: "宽松" },
                          { key: "balanced", label: "平衡" },
                          { key: "strict", label: "严格" },
                        ] as const).map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() =>
                              onSetInput((currentInput) => ({ ...currentInput, strictness: key }))
                            }
                            className="flex-1 py-1.5 rounded-xl text-sm font-medium transition-all duration-150"
                            style={
                              mockReviewInput.strictness === key
                                ? {
                                    background: key === "lenient" ? "#34C759" : key === "strict" ? "#FF3B30" : "var(--rc-button-primary-bg)",
                                    color: "#fff",
                                  }
                                : { background: "var(--rc-card-inset-bg)", color: "var(--rc-text-secondary)" as string }
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {mockReviewLoading ? (
                    <div className="flex items-center gap-2 text-sm text-ink-tertiary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在等待多视角审稿结果…
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div className="p-6 space-y-3">
              {dominantStyle && verdictCounts ? (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl mb-1" style={{ background: dominantStyle.bg }}>
                  <span className="text-sm font-bold" style={{ color: dominantStyle.color }}>
                    综合倾向：{dominantStyle.label}
                  </span>
                  <span className="text-xs text-ink-secondary">
                    {mockReviewResult?.length} 位审稿人 · 共{" "}
                    {Object.entries(verdictCounts)
                      .filter(([, count]) => count > 0)
                      .map(([verdict, count]) => `${VERDICT_CFG[verdict as ReviewVerdict].label} ×${count}`)
                      .join("、")}
                  </span>
                </div>
              ) : null}
              {(feedbackSummary.adopted + feedbackSummary.ignored + feedbackSummary.done) > 0 ? (
                <div className="flex flex-wrap gap-2 rounded-2xl px-3 py-2 text-xs text-ink-secondary" style={{ background: "var(--rc-card-inset-bg)" }}>
                  <span>累计反馈</span>
                  <span className="text-apple-blue">采纳 {feedbackSummary.adopted}</span>
                  <span className="text-[#34C759]">完成 {feedbackSummary.done}</span>
                  <span className="text-apple-red">忽略 {feedbackSummary.ignored}</span>
                </div>
              ) : null}

              {mockReviewResult?.map((result, index) => {
                const verdictStyle = VERDICT_CFG[result.verdict];
                return (
                  <div
                    key={`${result.reviewer}-${index}`}
                    className="rounded-2xl overflow-hidden"
                    style={{
                      border: "1px solid var(--rc-border)",
                      background: "var(--rc-card-bg)",
                      boxShadow: "2px 2px 8px rgba(0,0,0,0.06)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{ background: "var(--rc-card-inset-bg)", borderBottom: "1px solid var(--rc-border)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink-primary">{result.reviewer}</span>
                        {result.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                            style={{ background: "rgba(0,122,255,0.10)", color: "#007AFF" }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-lg" style={{ background: verdictStyle.bg, color: verdictStyle.color }}>
                        {verdictStyle.label}
                      </span>
                    </div>
                    <div className="px-4 py-3">
                      <MarkdownRenderer
                        content={result.content}
                        className="text-sm leading-7 text-ink-secondary"
                        onLinkClick={openLink}
                      />
                      {result.suggestions.length > 0 ? (
                        <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--rc-border)" }}>
                          <p className="text-xs font-semibold text-ink-secondary">建议价值反馈</p>
                          {result.suggestions.map((suggestion, suggestionIndex) => {
                            const key = `${result.id}:${suggestionIndex}`;
                            const current = feedback[key];
                            return (
                              <ReviewSuggestionFeedbackPanel
                                key={key}
                                suggestion={suggestion}
                                current={current}
                                saving={feedbackSavingKey === key}
                                onFeedback={(status, reason) => onFeedback(result, suggestionIndex, status, reason)}
                              />
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 flex-shrink-0 flex items-center justify-between" style={{ borderTop: "1px solid var(--rc-border)" }}>
          {hasResults ? (
            <>
              <button
                onClick={onReset}
                className="text-sm font-medium px-4 py-2 rounded-xl hover:bg-[var(--rc-list-item-hover-bg)] transition-colors"
                style={{ color: "var(--rc-text-secondary)" as string }}
              >
                重新生成
              </button>
              <button
                onClick={() => void onImport()}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium"
                style={{ background: "#AF52DE", color: "#fff", boxShadow: "2px 4px 10px rgba(175,82,222,0.3)" }}
              >
                <Check className="w-4 h-4" />
                导入审稿归档
              </button>
              {onDiagnose ? (
                <button
                  onClick={() => void onDiagnose()}
                  disabled={diagnosisLoading}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                  style={{ background: "#FF9500", color: "#fff", boxShadow: "2px 4px 10px rgba(255,149,0,0.3)" }}
                >
                  {diagnosisLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />诊断中…</>
                  ) : (
                    <><ClipboardList className="w-4 h-4" />一键诊断并生成清单</>
                  )}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-xs text-ink-tertiary">结果供投稿前自查，不替代编辑或真实同行评审</p>
              <button
                disabled={!mockReviewInput.abstract.trim() || mockReviewLoading || mockFileExtracting}
                onClick={onGenerate}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium transition-all duration-150 disabled:opacity-40"
                style={{ background: "#AF52DE", color: "#fff", boxShadow: "2px 4px 10px rgba(175,82,222,0.3)" }}
              >
                {mockReviewLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />开始多视角预审
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
