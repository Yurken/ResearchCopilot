import { buildPptx, extractJsonObject, normalizePptData, sanitizePptFileName } from "./ppt";
import { buildPptPrompt, buildPptRepairPrompt } from "./pptPrompt";
import { apiClient } from "../../lib/client";
import { parsePptPageCount, type PptData, type PptMode } from "./pptShared";

export interface PptGenerationRequest {
  mode: PptMode;
  topic?: string;
  outline?: string;
  documentName?: string;
  documentContent?: string;
  style?: string;
  language?: string;
  pageCount?: number;
  audience?: string;
  scenario?: string;
}

export interface PptGenerationProgress {
  stage: PptGenerationStage;
  message: string;
}

export type PptGenerationStage =
  | "parsing"
  | "planning"
  | "drafting"
  | "repairing"
  | "building"
  | "saving"
  | "completed";

export interface PptGenerationContext {
  sessionId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: PptGenerationProgress) => void;
}

export interface PptGenerationResult {
  data: PptData;
  buffer: ArrayBuffer;
  title: string;
  slideCount: number;
  fileBaseName: string;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("已取消生成", "AbortError");
  }
}

function reportProgress(
  onProgress: ((progress: PptGenerationProgress) => void) | undefined,
  stage: PptGenerationStage,
  message: string,
) {
  onProgress?.({ stage, message });
}

async function streamChatMessage(
  message: string,
  signal: AbortSignal | undefined,
  sessionId: string | undefined,
) {
  let raw = "";
  let nextSessionId = sessionId ?? "";

  for await (const chunk of apiClient.chat.stream({
    message,
    session_id: sessionId || undefined,
    chat_mode: "direct",
    tag: "1",
  })) {
    assertNotAborted(signal);
    if (chunk.type === "session_id") nextSessionId = chunk.value;
    else if (chunk.type === "delta") raw += chunk.value;
    else if (chunk.type === "error") throw new Error(chunk.value as string);
  }

  return { raw, sessionId: nextSessionId };
}

function parsePptResponse(raw: string) {
  return normalizePptData(JSON.parse(extractJsonObject(raw)));
}

function resolveEffectiveStyle(request: PptGenerationRequest) {
  const style = request.style?.trim();
  if (!style || style === "auto") return "auto";
  return style;
}

function resolveEffectiveLanguage(request: PptGenerationRequest) {
  const lang = request.language?.trim();
  if (!lang || lang === "auto") return "auto";
  if (lang === "zh" || lang === "en") return lang;
  return "auto";
}

function resolveEffectivePageCount(request: PptGenerationRequest): string {
  if (request.pageCount == null) return "auto";
  const count = Number(request.pageCount);
  if (Number.isNaN(count) || count < 4 || count > 40) return "auto";
  return String(count);
}

function buildPromptInputs(request: PptGenerationRequest) {
  const styleValue = resolveEffectiveStyle(request);
  const language = resolveEffectiveLanguage(request);
  const pageCount = resolveEffectivePageCount(request);

  return {
    mode: request.mode,
    topic: request.topic ?? "",
    outline: request.outline ?? "",
    documentContent: request.documentContent ?? null,
    documentName: request.documentName ?? null,
    styleValue,
    customStyle: styleValue === "custom" ? request.style ?? "" : "",
    language,
    pageCount,
    customPages: pageCount,
  };
}

export async function generatePptArtifact(
  request: PptGenerationRequest,
  context: PptGenerationContext = {},
): Promise<PptGenerationResult> {
  const { signal, onProgress } = context;
  assertNotAborted(signal);

  reportProgress(onProgress, "parsing", "正在解析演示需求…");
  const inputs = buildPromptInputs(request);
  assertNotAborted(signal);

  reportProgress(onProgress, "planning", "正在规划页面结构…");
  const prompt = buildPptPrompt(inputs);
  assertNotAborted(signal);

  reportProgress(onProgress, "drafting", "正在生成演示内容…");
  const firstPass = await streamChatMessage(prompt, signal, context.sessionId);
  assertNotAborted(signal);

  let data: PptData;
  try {
    data = parsePptResponse(firstPass.raw);
  } catch {
    assertNotAborted(signal);
    reportProgress(onProgress, "repairing", "正在修复结构化数据…");
    const repaired = await streamChatMessage(
      buildPptRepairPrompt(firstPass.raw),
      signal,
      firstPass.sessionId || context.sessionId,
    );
    assertNotAborted(signal);
    data = parsePptResponse(repaired.raw);
  }

  reportProgress(onProgress, "building", "正在构建 PPTX 文件…");
  const buffer = await buildPptx(data);
  assertNotAborted(signal);

  const fileBaseName = sanitizePptFileName(data.title);
  reportProgress(onProgress, "completed", `已生成 ${data.slides.length} 页演示文稿`);

  return {
    data,
    buffer,
    title: data.title,
    slideCount: data.slides.length,
    fileBaseName,
  };
}

export { parsePptPageCount };
