import { DESKTOP_PLATFORM, type DesktopPlatform } from "../../lib/desktopPlatform";

export type WritingExportTarget = "texstudio" | "overleaf";
export type WritingViewMode = "split" | "editor" | "preview";
export type WritingTemplateId = "journal" | "conference" | "thesis-note";
export type LatexDiagnosticSeverity = "error" | "warning" | "info";
export type WritingCompileStatus = "idle" | "compiling" | "ready" | "failed";
export type WritingAssistantActionId = "freeform" | "polish" | "continue" | "abstract" | "review";
export type WritingEditorSource = "main" | "bib" | `tex:${string}`;

export interface WritingResearchInterestSummary {
  id: string;
  topic: string;
  folder_name?: string;
}

export interface WritingDraft {
  id: string;
  projectName: string;
  researchInterestId?: string;
  templateId: WritingTemplateId;
  mainTex: string;
  bibtex: string;
  texFiles: WritingTexFile[];
  notes: string;
  imageAssets: WritingImageAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface WritingTexFile {
  path: string;
  content: string;
}

export interface WritingCreateDraftOptions {
  researchInterestId?: string;
  templateId?: WritingTemplateId;
}

export interface LatexTemplate {
  id: WritingTemplateId;
  title: string;
  description: string;
  mainTex: string;
  bibtex: string;
}

export interface LatexOutlineEntry {
  id: string;
  title: string;
  level: number;
  line: number;
  command: string;
}

export interface LatexDiagnostic {
  id: string;
  severity: LatexDiagnosticSeverity;
  title: string;
  detail: string;
  line?: number;
}

export interface LatexSnippet {
  id: string;
  title: string;
  description: string;
  before: string;
  after: string;
}

export interface LatexStats {
  lines: number;
  characters: number;
  words: number;
  equations: number;
  citations: number;
  labels: number;
}

export interface WritingAssistantAction {
  id: WritingAssistantActionId;
  title: string;
  description: string;
}

export interface WritingAssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  actionId?: WritingAssistantActionId;
}

export interface LatexPreviewBlock {
  id: string;
  kind: "meta" | "abstract" | "section" | "body";
  title: string;
  content: string;
  level: number;
}

export interface LatexProjectFile {
  path: string;
  content: string | Uint8Array;
}

export interface WritingImageAsset {
  id: string;
  fileName: string;
  projectPath: string;
  storedPath: string;
  createdAt: string;
}

export type WritingVersionSource = "auto" | "manual";

/** 版本列表条目：不含正文，只带元信息与各字段字符数。 */
export interface WritingVersionSummary {
  id: string;
  draftId: string;
  source: WritingVersionSource;
  createdAt: string;
  mainTexChars: number;
  bibtexChars: number;
  texFilesChars: number;
  notesChars: number;
}

/** 单个版本的完整快照，用于预览与恢复。 */
export interface WritingVersionSnapshot {
  id: string;
  draftId: string;
  source: WritingVersionSource;
  createdAt: string;
  mainTex: string;
  bibtex: string;
  texFiles: WritingTexFile[];
  notes: string;
}

export interface WritingVersionRecordResult {
  recorded: boolean;
  versionId: string | null;
  /** 跳过原因："unchanged"（内容未变）或 "throttled"（auto 最小间隔内）。 */
  reason: string | null;
}

/** 历史版本可恢复的内容字段。 */
export type WritingVersionContentPatch = Pick<
  WritingDraft,
  "mainTex" | "bibtex" | "texFiles" | "notes"
>;

/** 草稿内容更新补丁（不含 id 与时间戳）。 */
export type WritingDraftPatch = Partial<
  Pick<WritingDraft, "projectName" | "researchInterestId" | "templateId" | "mainTex" | "bibtex" | "texFiles" | "notes" | "imageAssets">
>;

export interface WritingProjectSnapshot {
  projectName: string;
  mainTex: string;
  bibtex: string;
  texFiles: WritingTexFile[];
  notes: string;
  imageAssets: WritingImageAsset[];
}

export interface WritingCompileSummary {
  success: boolean;
  pdfPath: string | null;
  workDir: string;
  engine: string;
  log: string;
}

export interface LatexInstallSupport {
  description: string;
  paths: string[];
  primaryActionLabel: string | null;
  secondaryActionLabel: string;
  missingCompilerMessage: string;
  installerOpenedMessage: string | null;
  installGuideOpenedMessage: string;
}

export const WRITING_STORAGE_KEY = "rc:writing:workspace:v1";
export const WRITING_LIBRARY_STORAGE_KEY = "rc:writing:library:v1";
export const WRITING_ACTIVE_DRAFT_KEY = "rc:writing:active-draft:v1";
export const DEFAULT_PROJECT_NAME = "xiaoyan-paper";
/** 历史版本自动记录：内容停止变化后防抖 2s，且距上次记录至少 60s（与后端节流一致）。 */
export const WRITING_VERSION_AUTO_DEBOUNCE_MS = 2000;
export const WRITING_VERSION_AUTO_MIN_INTERVAL_MS = 60_000;
export const MACOS_TEXBIN_PATH = "/Library/TeX/texbin";
export const LINUX_TEXLIVE_BIN_PATH = "/usr/local/texlive/YYYY/bin/*-linux";
export const LINUX_TINYTEX_BIN_PATH = "~/.TinyTeX/bin/*-linux";

export const EXPORT_TARGET_LABELS: Record<WritingExportTarget, string> = {
  texstudio: "TeXstudio",
  overleaf: "Overleaf",
};

export const WRITING_ASSISTANT_ACTIONS: WritingAssistantAction[] = [
  { id: "freeform", title: "问小妍", description: "围绕当前文稿自由提问或改写。" },
  { id: "polish", title: "润色", description: "基于 nature-polishing 规则，对选区进行 Nature 风格学术润色、中译英或结构调整。" },
  { id: "continue", title: "续写", description: "按当前上下文续写一段正文。" },
  { id: "abstract", title: "摘要", description: "根据全文生成或重写摘要。" },
  { id: "review", title: "检查", description: "从审稿视角指出结构和内容问题。" },
];

export function writingDraftTitle(draft: Pick<WritingDraft, "projectName">): string {
  return draft.projectName.trim() || DEFAULT_PROJECT_NAME;
}

/** 版本内容的本地签名，用于在 invoke 前快速判断内容是否变化（与后端 hash 去重互补）。 */
export function writingVersionContentSignature(content: WritingVersionContentPatch): string {
  return JSON.stringify([content.mainTex, content.bibtex, content.texFiles, content.notes]);
}

export function formatWritingVersionTime(createdAt: string): string {
  const date = new Date(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function writingResearchInterestTitle(
  interest?: Pick<WritingResearchInterestSummary, "topic" | "folder_name"> | null,
): string {
  return interest?.folder_name?.trim() || interest?.topic || "未绑定研究主题";
}

export function isLatexCompilerMissing(result: WritingCompileSummary | null): boolean {
  if (!result) return false;
  return result.engine === "not-found" || result.log.includes("未找到 LaTeX 编译器");
}

export function getLatexInstallSupport(
  platform: DesktopPlatform = DESKTOP_PLATFORM,
): LatexInstallSupport {
  if (platform === "macos") {
    return {
      description: "请安装 MacTeX / TeX Live，并确保 latexmk 或 xelatex 可用。",
      paths: [MACOS_TEXBIN_PATH],
      primaryActionLabel: "下载 MacTeX",
      secondaryActionLabel: "安装说明",
      missingCompilerMessage:
        "未找到 LaTeX 编译器。请安装 MacTeX / TeX Live，或使用下方按钮下载 MacTeX 安装器。",
      installerOpenedMessage:
        "已打开 MacTeX 官方安装器下载。下载完成后运行 MacTeX.pkg，安装完成再重新编译。",
      installGuideOpenedMessage: "已打开 MacTeX 官方安装说明。",
    };
  }

  if (platform === "linux") {
    return {
      description: "请安装 TeX Live，并确保 latexmk 或 xelatex 可用。",
      paths: [LINUX_TEXLIVE_BIN_PATH, LINUX_TINYTEX_BIN_PATH, "/usr/bin"],
      primaryActionLabel: null,
      secondaryActionLabel: "TeX Live 安装说明",
      missingCompilerMessage:
        "未找到 LaTeX 编译器。请安装 TeX Live，并确认 latexmk 或 xelatex 已加入 PATH。",
      installerOpenedMessage: null,
      installGuideOpenedMessage:
        "已打开 TeX Live 官方安装说明。安装完成后请把 TeX Live bin 目录加入 PATH，再重新编译。",
    };
  }

  return {
    description: "请安装 TeX Live，并确保 latexmk 或 xelatex 可用。",
    paths: [],
    primaryActionLabel: null,
    secondaryActionLabel: "安装说明",
    missingCompilerMessage:
      "未找到 LaTeX 编译器。请安装 TeX Live，并确认 latexmk 或 xelatex 可用。",
    installerOpenedMessage: null,
    installGuideOpenedMessage: "已打开 TeX Live 官方安装说明。",
  };
}

export const LATEX_INSTALL_SUPPORT = getLatexInstallSupport();

export function buildWritingAssistantPrompt(input: {
  actionId: WritingAssistantActionId;
  userInstruction: string;
  projectName: string;
  mainTex: string;
  bibtex: string;
  texFiles: WritingTexFile[];
  notes: string;
  selectedText: string;
  outline: LatexOutlineEntry[];
  diagnostics: LatexDiagnostic[];
  stats: LatexStats;
}): string {
  const action = WRITING_ASSISTANT_ACTIONS.find((item) => item.id === input.actionId) ?? WRITING_ASSISTANT_ACTIONS[0];
  const instruction = input.userInstruction.trim() || defaultWritingAssistantInstruction(input.actionId);
  const selected = input.selectedText.trim();
  const outlineText = input.outline.length > 0
    ? input.outline.map((item) => `${"  ".repeat(Math.max(0, item.level - 1))}- L${item.line} ${item.title}`).join("\n")
    : "暂无大纲";
  const diagnosticsText = input.diagnostics.length > 0
    ? input.diagnostics.map((item) => `- ${item.severity}: ${item.title}${item.line ? ` (L${item.line})` : ""} - ${item.detail}`).join("\n")
    : "暂无结构诊断提示";
  const texFilesText = input.texFiles.length > 0
    ? input.texFiles
      .map((file) => `--- ${file.path} ---\n${truncateForAssistant(file.content, 3200)}`)
      .join("\n\n")
    : "无独立章节文件";

  return `你是小妍，正在桌面端“论文撰写”功能中辅助用户写 LaTeX 论文草稿。

任务：${action.title}
输出约束：
${writingAssistantOutputRule(input.actionId)}
- 默认使用简体中文，除非用户要求英文。
- 不编造论文贡献、实验结果、引用或事实；信息不足时明确指出缺口。
- 保留 LaTeX 命令和引用键，不要破坏已有结构。
- 如果输出可直接写回正文，不要使用 Markdown 代码围栏。

文稿状态：
- 项目名：${input.projectName || DEFAULT_PROJECT_NAME}
- 统计：${input.stats.words} 字/词，${input.stats.equations} 个公式，${input.stats.citations} 个引用，${input.stats.labels} 个标签

大纲：
${outlineText}

结构检查：
${diagnosticsText}

写作便签：
${truncateForAssistant(input.notes.trim() || "无", 1800)}

当前选区：
${selected ? truncateForAssistant(selected, 4000) : "无选区。若任务需要改写，请基于全文上下文给出可插入内容或指出需要用户先选择文本。"}

main.tex：
${truncateForAssistant(input.mainTex, 12000)}

章节文件：
${texFilesText}

references.bib：
${truncateForAssistant(input.bibtex || "无", 3000)}

用户指令：
${instruction}`;
}

function defaultWritingAssistantInstruction(actionId: WritingAssistantActionId): string {
  switch (actionId) {
    case "polish":
      return "请润色当前选区，提升学术表达的准确性和流畅度。如果没有选区，先指出应选择的段落范围。";
    case "continue":
      return "请基于当前文稿上下文续写一段可直接放入论文正文的 LaTeX 内容，保持与前文风格一致。";
    case "abstract":
      return "请根据当前文稿全文生成一版摘要，覆盖问题、方法、主要结果和意义，可直接放入 \\begin{abstract} 环境。";
    case "review":
      return "请从同行审稿人的角度审读当前草稿，按严重程度列出最需要修改的问题，并给出可执行修改建议。覆盖结构完整性、论证逻辑、实验描述、相关工作覆盖和写作质量。";
    default:
      return "请根据当前文稿内容回答我的写作相关问题。";
  }
}

function writingAssistantOutputRule(actionId: WritingAssistantActionId): string {
  switch (actionId) {
    case "polish":
      return "- 直接输出润色后的 LaTeX 文本（保留原有 \\cite、\\ref 等引用）。如有必要，在末尾用一条注释（% 开头）列出主要修改。";
    case "continue":
      return "- 直接输出可插入 main.tex 的 LaTeX 段落，以 \\section 或段落开头，不要解释写作策略，不要加 \\begin{{document}}。";
    case "abstract":
      return "- 输出完整 \\begin{{abstract}}...\\end{{abstract}} 块或纯摘要正文。如有必要，在末尾用一条注释说明与原文摘要的主要差异。";
    case "review":
      return "- 分条列出问题，按严重程度排列（致命 > 重大 > 建议）。每条指出：问题描述、影响、建议修改方式、涉及的章节或行号范围。";
    default:
      return "- 先给可执行结论，再补充依据。涉及写回正文时提供可直接粘贴的 LaTeX 片段，不夹带策略解释。";
  }
}

function truncateForAssistant(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const head = value.slice(0, Math.floor(maxChars * 0.64));
  const tail = value.slice(value.length - Math.floor(maxChars * 0.32));
  return `${head}\n\n...[中间内容已省略]...\n\n${tail}`;
}
