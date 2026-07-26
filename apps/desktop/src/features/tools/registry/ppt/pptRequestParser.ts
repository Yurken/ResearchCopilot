import { apiClient, formatErrorMessage } from "../../../../lib/client";
import { extractJsonObject } from "../../ppt";
import type { PptMode } from "../../pptShared";
import type { ToolAttachment } from "../types";

export interface ParsedPptRequest {
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

const MODES: PptMode[] = ["topic", "outline", "document"];
const LANGUAGES = ["auto", "zh", "en"];

function isPptMode(value: unknown): value is PptMode {
  return typeof value === "string" && MODES.includes(value as PptMode);
}

function clampPageCount(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.max(4, Math.min(40, Math.round(value)));
}

function normalizeLanguage(value: unknown): string {
  if (typeof value === "string" && LANGUAGES.includes(value)) return value;
  return "auto";
}

function normalizeStyle(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

export function buildPptParsePrompt(userMessage: string, attachments: ToolAttachment[]): string {
  const attachmentContext = attachments
    .filter((a): a is ToolAttachment & { content: string } => Boolean(a.content))
    .map((a, i) => `[附件 ${i + 1}] ${a.name}\n类型：${a.mediaTypeLabel}\n内容摘要：\n${a.content.slice(0, 3000)}`)
    .join("\n\n---\n\n");

  return `你是小妍的 PPT 技能参数解析器。请从用户输入中提取生成演示文稿所需的结构化参数。

用户输入：
${userMessage}

${attachmentContext ? `用户上传了以下附件：\n${attachmentContext}\n\n` : ""}请只输出一个 JSON 对象，不要 markdown 代码块，不要解释。JSON 字段如下：
{
  "mode": "topic" | "outline" | "document",
  "topic": "演示主题（mode=topic 时必填）",
  "outline": "演示大纲文本（mode=outline 时必填）",
  "style": "风格描述，如：学术汇报、蓝色科技风、项目路演等；未知用 auto",
  "language": "auto | zh | en",
  "pageCount": 4-40 之间的整数，未知可省略,
  "audience": "目标受众，如：导师、投资人、组会同学等；未知可省略",
  "scenario": "使用场景，如：学术汇报、项目路演、答辩等；未知可省略"
}

规则：
- mode 判定：用户明确列出大纲或 bullet 时用 outline；用户要求基于某文档/论文/PDF 生成时用 document；否则用 topic。
- 如果附件是 PDF/TXT/MD 且内容较长，mode 优先为 document，documentContent 由调用方提供，你无需在输出中填写。
- 页数必须在 4 到 40 之间。
- 风格、语言、受众、场景缺失时用 auto 或省略。
- 不要编造用户没有提到的主题或内容。`;
}

export async function parsePptRequest(
  userMessage: string,
  attachments: ToolAttachment[],
  signal?: AbortSignal,
): Promise<ParsedPptRequest> {
  if (signal?.aborted) {
    throw new DOMException("已取消", "AbortError");
  }

  const textAttachments = attachments.filter((a) => a.kind !== "image" && a.content);
  const hasDocumentAttachment = textAttachments.some((a) =>
    [".pdf", ".txt", ".md"].some((ext) => a.name.toLowerCase().endsWith(ext)),
  );

  let raw = "";
  for await (const chunk of apiClient.chat.stream({
    message: buildPptParsePrompt(userMessage, textAttachments),
    chat_mode: "direct",
    tag: "1",
  })) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    if (chunk.type === "delta") raw += chunk.value;
    if (chunk.type === "error") throw new Error(chunk.value as string);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`解析 PPT 参数失败：${formatErrorMessage(err)}`);
  }

  const mode = isPptMode(parsed.mode) ? parsed.mode : hasDocumentAttachment ? "document" : "topic";

  const result: ParsedPptRequest = {
    mode,
    style: normalizeStyle(parsed.style),
    language: normalizeLanguage(parsed.language),
    pageCount: clampPageCount(parsed.pageCount),
    audience: typeof parsed.audience === "string" ? parsed.audience.trim() || undefined : undefined,
    scenario: typeof parsed.scenario === "string" ? parsed.scenario.trim() || undefined : undefined,
  };

  if (mode === "topic") {
    result.topic = typeof parsed.topic === "string" ? parsed.topic.trim() || userMessage.trim() : userMessage.trim();
  } else if (mode === "outline") {
    result.outline = typeof parsed.outline === "string" ? parsed.outline.trim() || userMessage.trim() : userMessage.trim();
  } else if (mode === "document") {
    const docAttachment = textAttachments[0];
    if (docAttachment) {
      result.documentName = docAttachment.name;
      result.documentContent = docAttachment.content;
    } else {
      result.documentContent = userMessage.trim();
    }
  }

  return result;
}
