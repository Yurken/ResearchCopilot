import { parsePptPageCount, type PptMode } from "./pptShared";

interface BuildPptPromptInput {
  mode: PptMode;
  topic: string;
  outline: string;
  documentContent: string | null;
  documentName: string | null;
  styleValue: string;
  customStyle: string;
  language: string;
  pageCount: string;
  customPages: string;
}

const JSON_SCHEMA = `{
  "title": "演示标题",
  "slides": [
    { "layout": "title", "title": "主标题", "subtitle": "副标题", "note": "开场演讲脚本（1-2 句口语化讲稿）" },
    { "layout": "agenda", "title": "目录", "bullets": ["第一节", "第二节", "第三节"], "note": "概述演讲结构" },
    { "layout": "section", "title": "章节页标题", "subtitle": "章节说明（可选）", "note": "本章要讲什么、为什么重要" },
    { "layout": "content", "title": "一句可断言的论点", "bullets": ["支撑论据1", "支撑论据2", "支撑论据3"], "note": "讲解该页的演讲脚本（1-3 句）" },
    { "layout": "two_column", "title": "对比页标题", "left": ["左侧1", "左侧2"], "right": ["右侧1", "右侧2"], "note": "演讲脚本" },
    { "layout": "highlight", "title": "核心结论页标题", "highlight": "一句话关键结论", "bullets": ["支撑点1", "支撑点2"], "note": "演讲脚本" },
    { "layout": "timeline", "title": "流程页标题", "steps": ["阶段1", "阶段2", "阶段3"], "note": "流程讲解脚本" },
    { "layout": "comparison", "title": "方案对比", "left": ["方案 A", "优点", "局限"], "right": ["方案 B", "优点", "局限"], "note": "对比讲解脚本" },
    { "layout": "data_chart", "title": "数据洞察", "highlight": "关键结论", "bullets": ["数据说明1"], "chart": { "type": "bar", "labels": ["A", "B"], "values": [10, 20], "source": "数据来源" }, "note": "数据讲解脚本" },
    { "layout": "quote", "title": "引用页标题", "quote": "一句核心引用", "subtitle": "引用来源", "note": "引用讲解脚本" },
    { "layout": "image_focus", "title": "图文页标题", "bullets": ["图片说明"], "image_source": "图片来源或生成方式", "note": "图片讲解脚本" },
    { "layout": "summary", "title": "总结与展望", "bullets": ["核心 takeaway 1", "核心 takeaway 2"], "note": "收尾演讲脚本" }
  ]
}`;

function buildDocumentExcerpt(text: string) {
  const normalized = text.trim();
  if (!normalized) return normalized;
  if (normalized.length <= 7000) return normalized;

  const head = normalized.slice(0, 4600);
  const tail = normalized.slice(-1800);
  return `${head}\n\n[中间已省略 ${normalized.length - 6400} 字原文，请优先根据上下文提炼核心逻辑]\n\n${tail}`;
}

function resolveStyleHint(styleValue: string, customStyle: string) {
  const effectiveStyle = styleValue === "custom" ? customStyle.trim() : styleValue;
  if (!effectiveStyle || effectiveStyle === "auto") {
    return "根据科研主题与内容深度选择最合适的学术汇报风格";
  }
  return `${effectiveStyle}风格`;
}

function resolveLanguageHint(language: string) {
  const languageHintMap: Record<string, string> = {
    auto: "语言根据主题自动决定，中文主题优先中文，英文主题优先英文",
    zh: "全程使用中文",
    en: "All slide copy must be written in English",
  };
  return languageHintMap[language] ?? languageHintMap.auto;
}

function resolvePageHint(pageCount: string, customPages: string) {
  const effectivePages = pageCount === "custom" ? customPages.trim() : pageCount;
  const customPageCount = parsePptPageCount(effectivePages);
  if (customPageCount === null) {
    return "页数由小妍根据内容深度自动决定，建议控制在 10 到 16 页";
  }
  return `总页数控制在 ${customPageCount} 页左右，含标题页和致谢页`;
}

function buildRules(styleHint: string, languageHint: string, pageHint: string) {
  return `风格：${styleHint}
语言：${languageHint}
页数：${pageHint}
页面比例：16:9 宽屏演示。
叙事与信息架构：
- 整体要有叙事弧线：封面 title 抛出研究问题/动机，目录 agenda 给出路线图，中间按 section 递进组织逻辑，结尾 summary 收束核心 takeaway。
- 学术型内容需覆盖：研究背景、问题、方法、实验、结果、贡献、局限（按需）。
- 项目型内容需覆盖：痛点、方案、产品/技术、市场、商业模式、优势、计划、团队（按需）。
页面内容规则：
- 一页只表达一个核心观点；content 页的 title 写成一句“可断言的论点”而非泛泛标签。
- 避免整页堆满项目符号；优先使用流程图、时间线、对比、数据图、卡片和结构图来表达信息。
- 同一种版式不得连续重复超过两页；相邻页应交替使用 content / two_column / highlight / timeline / comparison / data_chart / quote / image_focus。
- 单页中文正文控制在约 70 至 120 字以内；内容过多时拆页，不能无限缩小字体。
- 正文字号不得低于 14pt（约 18px）；标题与正文必须有明显字号对比。
- 标题要表达结论，而不是仅写名词。
图表与图片规则：
- data_chart 必须携带结构化 chart 字段：type 为 bar/line/pie 之一，labels 和 values 等长，source 必填。
- image_focus 必须提供 image_source 说明图片来源或生成方式。
- 不要输出 Markdown 代码块，不要输出任何解释性文字，只返回一个 JSON 对象。
布局规则：
- layout 只能是 title / agenda / section / content / two_column / highlight / timeline / comparison / data_chart / image_focus / quote / summary。
- 第一页固定用 title，第二页用 agenda，最后一页用 summary 或 title 作为总结/致谢页。
- 全文包含 2 到 3 个 section 分隔页。
- content 页 bullets 每条尽量不超过 22 个字，最多 5 条。
- two_column 只用于对比、并列方法或优缺点分析。
- highlight 用于核心贡献、主要结论、takeaway，总结语必须简洁有力。
- timeline / process 用于研究流程、方法步骤、实验阶段、时间线，steps 控制在 3 到 4 个。
- 每一页都必须给出 note：1-3 句口语化的演讲者脚本（写入 PowerPoint 备注栏，不显示在幻灯片上）。`;
}

export function buildPptPrompt(input: BuildPptPromptInput) {
  const styleHint = resolveStyleHint(input.styleValue, input.customStyle);
  const languageHint = resolveLanguageHint(input.language);
  const pageHint = resolvePageHint(input.pageCount, input.customPages);
  const commonRules = buildRules(styleHint, languageHint, pageHint);

  if (input.mode === "topic") {
    return `请为演示主题“${input.topic.trim()}”生成一份适合科研汇报的幻灯片数据。

严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何额外说明。
格式必须符合：
${JSON_SCHEMA}

${commonRules}`;
  }

  if (input.mode === "outline") {
    return `请根据以下大纲生成一份适合科研汇报的幻灯片数据：

${input.outline.trim()}

严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何额外说明。
格式必须符合：
${JSON_SCHEMA}

${commonRules}
- 严格按照大纲层级组织页面，必要时将连续要点合并成更有节奏的章节结构`;
  }

  return `请根据以下文档内容生成一份适合科研汇报的幻灯片数据：

${buildDocumentExcerpt(input.documentContent ?? "")}

严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何额外说明。
格式必须符合：
${JSON_SCHEMA}

${commonRules}
- 先提炼文档主线，再组织章节，不要机械地逐段复述原文`;
}

export function buildPptRepairPrompt(raw: string) {
  return `请把下面内容修复成一个合法、完整的 JSON 对象，只输出 JSON，不要解释。

要求：
- 顶层必须包含 title 和 slides
- slides 必须是数组
- layout 只能是 title / agenda / section / content / two_column / highlight / timeline / comparison / data_chart / image_focus / quote / summary
- 保留原始语义，缺失字段按最合理方式补全

待修复内容：
${raw.slice(0, 12000)}`;
}
