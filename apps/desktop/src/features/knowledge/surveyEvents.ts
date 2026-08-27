import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { safeListen } from "../../lib/tauriEvent";
import type { StructuredSurveyResult, SurveyAgentState } from "./shared";

interface SurveyEventOptions {
  requestIdRef: MutableRefObject<string | null>;
  contentRef: MutableRefObject<string>;
  setContent: Dispatch<SetStateAction<string>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setAgents: Dispatch<SetStateAction<SurveyAgentState[]>>;
  setStructured: Dispatch<SetStateAction<StructuredSurveyResult | null>>;
  cleanupSurveyListeners: () => void;
}

export function createSurveyRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `survey-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 监听「综述已生成并落库」事件（含聊天触发的生成），用于刷新历史列表等联动。 */
export function listenSurveyGenerated(onGenerated: () => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void safeListen("survey:generated", () => {
    if (!disposed) onGenerated();
  }).then((cleanup) => {
    if (disposed) {
      cleanup();
    } else {
      unlisten = cleanup;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export async function registerSurveyEventListeners({
  requestIdRef,
  contentRef,
  setContent,
  setGenerating,
  setError,
  setActionError,
  setAgents,
  setStructured,
  cleanupSurveyListeners,
}: SurveyEventOptions) {
  const acceptRequest = (requestId?: string) => !requestId || requestId === requestIdRef.current;
  const finishWithError = (message: string) => {
    setError(message);
    setGenerating(false);
    cleanupSurveyListeners();
  };

  return Promise.all([
    safeListen<{ request_id?: string; delta: string }>("survey:delta", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      contentRef.current += event.payload.delta;
      setContent(contentRef.current);
    }),
    safeListen<{ request_id?: string; saved?: boolean; save_error?: string }>("survey:done", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      if (event.payload.saved === false) {
        setActionError(
          `综述已生成，但保存到历史记录失败${event.payload.save_error ? `：${event.payload.save_error}` : "。"}当前内容未入库，可通过「存为笔记」留存。`,
        );
      }
      setGenerating(false);
      cleanupSurveyListeners();
    }),
    safeListen<{ request_id?: string; error: string }>("survey:error", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      finishWithError(event.payload.error);
    }),
    safeListen<{
      request_id?: string;
      query: string;
      report: StructuredSurveyResult["report"];
      papers: StructuredSurveyResult["papers"];
      formatted_citations?: string[];
      citation_format?: string;
      meta?: StructuredSurveyResult["meta"];
    }>("survey:structured", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      setStructured({
        query: event.payload.query,
        report: event.payload.report,
        papers: event.payload.papers,
        formatted_citations: event.payload.formatted_citations,
        citation_format: event.payload.citation_format,
        meta: event.payload.meta,
      });
    }),
    safeListen<{ request_id?: string; agent: SurveyAgentState }>("survey:agent_start", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      const nextAgent = event.payload.agent;
      setAgents((prev) => {
        const duplicateDoneStage = prev.some(
          (item) => item.name === nextAgent.name && item.status === "done" && item.id !== nextAgent.id,
        );
        if (duplicateDoneStage) return prev;
        const exists = prev.some((item) => item.id === nextAgent.id);
        if (exists) return prev.map((item) => (item.id === nextAgent.id ? { ...item, ...nextAgent } : item));
        return [...prev, nextAgent];
      });
    }),
    safeListen<{ request_id?: string; agent: SurveyAgentState }>("survey:agent_complete", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      const nextAgent = event.payload.agent;
      setAgents((prev) => {
        const duplicateDoneStage = prev.some(
          (item) => item.name === nextAgent.name && item.status === "done" && item.id !== nextAgent.id,
        );
        if (duplicateDoneStage) return prev;
        return prev.map((item) => (item.id === nextAgent.id ? { ...item, ...nextAgent, status: "done" } : item));
      });
    }),
    safeListen<{ request_id?: string; agent: SurveyAgentState }>("survey:agent_error", (event) => {
      if (!acceptRequest(event.payload.request_id)) return;
      // 阶段级失败是非致命的：后端会降级继续，只标记该阶段，整体失败由 survey:error 收口。
      const nextAgent = event.payload.agent;
      setAgents((prev) => prev.map((item) => (item.id === nextAgent.id ? { ...item, ...nextAgent, status: "failed" } : item)));
    }),
  ]);
}
