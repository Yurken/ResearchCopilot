export interface CopilotPaperHandoff {
  contextType: "paper";
  contextId: string;
  contextLabel: string;
  prompt: string;
  page?: number;
  selection?: string;
  createdAt: string;
}

const HANDOFF_STORAGE_KEY = "xiaoyan:copilot:paper-handoff";

export function queueCopilotPaperHandoff(
  handoff: Omit<CopilotPaperHandoff, "contextType" | "createdAt">,
) {
  const value: CopilotPaperHandoff = {
    ...handoff,
    contextType: "paper",
    createdAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 会话存储不可用时由当前页面导航兜底；不阻断阅读操作。
  }
}

export function consumeCopilotPaperHandoff(): CopilotPaperHandoff | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CopilotPaperHandoff>;
    if (
      value.contextType !== "paper" ||
      typeof value.contextId !== "string" ||
      typeof value.contextLabel !== "string" ||
      typeof value.prompt !== "string"
    ) {
      return null;
    }
    return value as CopilotPaperHandoff;
  } catch {
    return null;
  }
}

export type CopilotHandoffDetail = "page" | "selection";

export function removeCopilotHandoffDetail(
  handoff: CopilotPaperHandoff,
  detail: CopilotHandoffDetail,
): CopilotPaperHandoff {
  const page = detail === "page" ? undefined : handoff.page;
  const selection = detail === "selection" ? undefined : handoff.selection;
  const location = page ? `第 ${page} 页` : "全文";
  const prompt = selection
    ? `请总结并解释论文《${handoff.contextLabel}》${location}的以下选中文字，并区分原文事实与推断：\n\n${selection}`
    : `请基于论文《${handoff.contextLabel}》${location}帮助我继续研究，概括最相关的内容并说明证据来源。`;
  return { ...handoff, page, selection, prompt };
}
