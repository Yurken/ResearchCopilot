import type { CodeFileAttachment } from "./shared";

interface BuildCodePromptContentOptions {
  displayContent: string;
  skillPrompt?: string;
  attachments?: CodeFileAttachment[];
}

/**
 * 构造仅供本轮模型使用的完整提示。displayContent 由调用方单独持久化，
 * 技能内部提示和附件全文不进入可见聊天历史。
 */
export function buildCodePromptContent({
  displayContent,
  skillPrompt,
  attachments = [],
}: BuildCodePromptContentOptions) {
  let promptContent = skillPrompt
    ? `${skillPrompt}\n\n---\n\n${displayContent}`
    : displayContent;

  if (attachments.length === 0) return promptContent;

  const fileContext = attachments
    .map((attachment, index) => {
      const truncatedHint = attachment.truncated ? "\n[内容已截断]" : "";
      return `[文件 ${index + 1}] ${attachment.name}\n路径：${attachment.path}\n\`\`\`\n${attachment.content}${truncatedHint}\n\`\`\``;
    })
    .join("\n\n---\n\n");

  promptContent += `\n\n<file-context>\n以下是用户附加的文件内容，请结合这些内容回答问题：\n\n${fileContext}\n</file-context>`;
  return promptContent;
}
