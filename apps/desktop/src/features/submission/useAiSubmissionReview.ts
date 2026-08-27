import { useCallback, useEffect, useRef, useState } from "react";
import { papersApi, submissionApi } from "../../lib/client";
import { safeListen } from "../../lib/tauriEvent";
import { countVerdicts, getDominantVerdict, rowToRound, type MockReviewInput, type MockReviewerResult, type ReviewFeedbackStatus, type ReviewVerdict } from "./shared";

interface UseAiSubmissionReviewOptions {
  onError: (error: unknown) => void;
  onDiagnosisSaved: (submissionId: string) => void;
}

export interface AiReviewEvent {
  submissionId: string;
  runId?: string;
  index: number;
  reviewer: string;
  focus: string;
  raw: string;
}

function extractReviewJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("invalid review json");
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  }
}

export function toReviewerResult(event: AiReviewEvent): MockReviewerResult {
  try {
    const parsed = extractReviewJson(event.raw);
    const list = (field: string) => Array.isArray(parsed[field])
      ? (parsed[field] as string[]).map((item) => `- ${item}`).join("\n")
      : "";
    const content = [
      typeof parsed.summary === "string" ? `**摘要：** ${parsed.summary}` : "",
      list("strengths") ? `**优点：**\n${list("strengths")}` : "",
      list("evidence_locations") ? `**证据定位：**\n${list("evidence_locations")}` : "",
      list("weaknesses") ? `**风险与不足：**\n${list("weaknesses")}` : "",
      list("questions") ? `**待澄清问题：**\n${list("questions")}` : "",
      list("suggestions") ? `**投稿前建议：**\n${list("suggestions")}` : "",
    ].filter(Boolean).join("\n\n");
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((item): item is string => typeof item === "string")
      : [];
    const verdict = parsed.verdict === "accept" ? "accept" : parsed.verdict === "weak_accept" ? "minor_revision"
      : parsed.verdict === "weak_reject" ? "major_revision" : "reject";
    return { id: `${event.submissionId}:${event.index}`, reviewer: event.reviewer, content, suggestions, tags: [event.focus], verdict: verdict as ReviewVerdict };
  } catch {
    return { id: `${event.submissionId}:${event.index}`, reviewer: event.reviewer, content: event.raw, suggestions: [], tags: [event.focus], verdict: "major_revision" };
  }
}

export function useAiSubmissionReview({ onError, onDiagnosisSaved }: UseAiSubmissionReviewOptions) {
  const [showModal, setShowModal] = useState(false);
  const [input, setInput] = useState<MockReviewInput>({ abstract: "", reviewerCount: 3, strictness: "balanced" });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MockReviewerResult[] | null>(null);
  const [fileExtracting, setFileExtracting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { status: ReviewFeedbackStatus; reason: string }>>({});
  const [feedbackSavingKey, setFeedbackSavingKey] = useState<string | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState({ pending: 0, adopted: 0, ignored: 0, done: 0 });
  const reviewRunIdRef = useRef("");
  const activeSubmissionRef = useRef("");
  const resultBufferRef = useRef<MockReviewerResult[]>([]);
  const onErrorRef = useRef(onError);
  const onDiagnosisSavedRef = useRef(onDiagnosisSaved);
  onErrorRef.current = onError;
  onDiagnosisSavedRef.current = onDiagnosisSaved;

  useEffect(() => {
    let unlistenReviewer: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let mounted = true;
    // 事件按 runId 过滤（后端随事件回传）：隔离同一投稿并发/连续的两次预审，
    // 避免两轮 reviewer 事件交叉混入同一结果缓冲。
    safeListen<AiReviewEvent>("submission:ai_review:reviewer", ({ payload }) => {
      if (payload.runId !== reviewRunIdRef.current) return;
      resultBufferRef.current = [...resultBufferRef.current, toReviewerResult(payload)];
      setResults([...resultBufferRef.current]);
    }).then((unlisten) => { if (!mounted) unlisten(); else unlistenReviewer = unlisten; });
    safeListen<{ submissionId: string; runId?: string }>("submission:ai_review:done", ({ payload }) => {
      if (payload.runId !== reviewRunIdRef.current) return;
      setLoading(false);
      onDiagnosisSavedRef.current(payload.submissionId);
    }).then((unlisten) => { if (!mounted) unlisten(); else unlistenDone = unlisten; });
    safeListen<{ submissionId: string; runId?: string; error: string }>("submission:ai_review:error", ({ payload }) => {
      if (payload.runId !== reviewRunIdRef.current) return;
      setLoading(false);
      onErrorRef.current(payload.error);
    }).then((unlisten) => { if (!mounted) unlisten(); else unlistenError = unlisten; });
    return () => {
      mounted = false;
      unlistenReviewer?.();
      unlistenDone?.();
      unlistenError?.();
    };
  }, []);

  const reset = useCallback(() => {
    resultBufferRef.current = [];
    setResults(null);
    setFeedback({});
  }, []);

  // filePath 存在时从 PDF 提取全文作为审稿输入（与按钮提示一致）；
  // 提取完成前若已切换到其他投稿，丢弃迟到的结果，避免覆盖新输入。
  const openForSubmission = useCallback((submissionId: string, content: string, filePath?: string) => {
    activeSubmissionRef.current = submissionId;
    setInput((current) => ({ ...current, abstract: content }));
    setFileName(null);
    reset();
    reviewRunIdRef.current = `${submissionId}:${Date.now()}`;
    setShowModal(true);
    void submissionApi.reviewFeedbackSummary(submissionId)
      .then((summary) => setFeedbackSummary(summary.counts))
      .catch(() => setFeedbackSummary({ pending: 0, adopted: 0, ignored: 0, done: 0 }));
    if (filePath) {
      setFileExtracting(true);
      papersApi.extractPdfText(filePath, 8000)
        .then((text) => {
          if (activeSubmissionRef.current !== submissionId) return;
          setInput((current) => ({ ...current, abstract: text.slice(0, 5000) }));
          setFileName(filePath.split("/").pop() ?? null);
        })
        .catch((error) => {
          if (activeSubmissionRef.current === submissionId) onErrorRef.current(error);
        })
        .finally(() => setFileExtracting(false));
    }
  }, [reset]);

  const close = useCallback(() => {
    setShowModal(false);
    reset();
    reviewRunIdRef.current = "";
  }, [reset]);

  const pickPdf = useCallback(async () => {
    setFileExtracting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (typeof selected !== "string") return;
      const text = await papersApi.extractPdfText(selected, 8000);
      setInput((current) => ({ ...current, abstract: text.slice(0, 5000) }));
      setFileName(selected.split("/").pop() ?? null);
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setFileExtracting(false);
    }
  }, []);

  const generate = useCallback(() => {
    const submissionId = activeSubmissionRef.current;
    if (!submissionId || !input.abstract.trim() || loading) return;
    reset();
    reviewRunIdRef.current = `${submissionId}:${Date.now()}`;
    setLoading(true);
    submissionApi.aiReview({
      submissionId,
      content: input.abstract,
      reviewerCount: input.reviewerCount,
      strictness: input.strictness,
      runId: reviewRunIdRef.current,
    }).catch((error) => {
      setLoading(false);
      onErrorRef.current(error);
    });
  }, [input, loading, reset]);

  const saveFeedback = useCallback(async (
    result: MockReviewerResult,
    suggestionIndex: number,
    status: Exclude<ReviewFeedbackStatus, "pending">,
    reason = "",
  ) => {
    const submissionId = activeSubmissionRef.current;
    const suggestion = result.suggestions[suggestionIndex];
    if (!submissionId || !suggestion) return false;
    const itemKey = `${result.id}:${suggestionIndex}`;
    setFeedbackSavingKey(itemKey);
    try {
      await submissionApi.upsertReviewFeedback({
        submissionId,
        reviewRunId: reviewRunIdRef.current || `${submissionId}:current`,
        reviewer: result.reviewer,
        itemKey,
        suggestion,
        status,
        reason,
      });
      setFeedback((current) => ({ ...current, [itemKey]: { status, reason } }));
      const summary = await submissionApi.reviewFeedbackSummary(submissionId);
      setFeedbackSummary(summary.counts);
      return true;
    } catch (error) {
      onErrorRef.current(error);
      return false;
    } finally {
      setFeedbackSavingKey(null);
    }
  }, []);

  // 导入时写入新轮次（既有最大轮次 + 1）：不再覆盖 reviews 页当前选中轮次的 verdict，
  // 重复导入也不会在同一轮产生重复评论。
  const importResults = useCallback(async () => {
    const submissionId = activeSubmissionRef.current;
    const currentResults = results ?? [];
    if (!submissionId || currentResults.length === 0) return null;
    try {
      const roundsResponse = await submissionApi.listRounds(submissionId);
      const nextRound =
        roundsResponse.rounds
          .map(rowToRound)
          .reduce((max, existing) => Math.max(max, existing.round), 0) + 1;
      await submissionApi.upsertRound({
        submissionId,
        round: nextRound,
        verdict: getDominantVerdict(countVerdicts(currentResults)),
      });
      await Promise.all(currentResults.map((result) => submissionApi.createComment({
        submissionId,
        round: nextRound,
        reviewer: result.reviewer,
        content: result.content,
        tags: result.tags,
      })));
      const summary = await submissionApi.reviewFeedbackSummary(submissionId);
      close();
      return { submissionId, round: nextRound, count: currentResults.length, feedbackSummary: summary.counts };
    } catch (error) {
      onErrorRef.current(error);
      return null;
    }
  }, [close, results]);

  return {
    showModal, input, setInput, loading, results, fileExtracting, fileName,
    feedback, feedbackSummary, feedbackSavingKey, saveFeedback,
    openForSubmission, close, pickPdf, reset, generate, importResults,
  };
}
