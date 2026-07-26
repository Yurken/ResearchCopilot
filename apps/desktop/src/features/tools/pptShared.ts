export type PptMode = "topic" | "document" | "outline";
export type PptStatus = "idle" | "drafting" | "repairing" | "building" | "ready" | "error";
export type PptLayout =
  | "title"
  | "section"
  | "content"
  | "two_column"
  | "highlight"
  | "timeline"
  | "agenda"
  | "comparison"
  | "process"
  | "data_chart"
  | "image_focus"
  | "quote"
  | "summary";

export interface PptSlide {
  layout: PptLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  left?: string[];
  right?: string[];
  highlight?: string;
  steps?: string[];
  note?: string;
  /** 数据图表页的结构化数据（供后续渲染图表使用）。 */
  chart?: { type: "bar" | "line" | "pie"; labels: string[]; values: number[]; source?: string };
  /** 图片页的图片来源或生成方式说明。 */
  imageSource?: string;
  /** 引用页的引用文本。 */
  quote?: string;
  /** 页面额外元数据（扩展字段）。 */
  meta?: Record<string, unknown>;
}

export interface PptData {
  title: string;
  slides: PptSlide[];
}

export const STYLE_OPTIONS = [
  { value: "auto", label: "小妍推荐" },
  { value: "文献综述", label: "文献综述" },
  { value: "实验汇报", label: "实验汇报" },
  { value: "开题答辩", label: "开题答辩" },
  { value: "技术路线", label: "技术路线" },
  { value: "custom", label: "自定义" },
] as const;

export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "小妍推荐" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;

export const PAGE_OPTIONS = [
  { value: "auto", label: "小妍推荐" },
  { value: "8", label: "8 页" },
  { value: "12", label: "12 页" },
  { value: "16", label: "16 页" },
  { value: "20", label: "20 页" },
  { value: "custom", label: "自定义" },
] as const;

export const PPT_LAYOUT_LABELS: Record<PptLayout, string> = {
  title: "标题页",
  section: "章节页",
  content: "内容页",
  two_column: "双列页",
  highlight: "结论页",
  timeline: "流程页",
  agenda: "目录页",
  comparison: "对比页",
  process: "流程页",
  data_chart: "数据页",
  image_focus: "图文页",
  quote: "引用页",
  summary: "总结页",
};

/**
 * 将扩展布局名映射到当前渲染器可处理的基准布局，保持向后兼容。
 * 新增布局优先复用已有渲染逻辑，避免一次性重写整个 PPTX 构建器。
 */
export function mapPptLayoutToBase(layout: PptLayout): Exclude<PptLayout, "agenda" | "comparison" | "process" | "data_chart" | "image_focus" | "quote" | "summary"> {
  switch (layout) {
    case "agenda":
      return "content";
    case "comparison":
      return "two_column";
    case "process":
      return "timeline";
    case "data_chart":
      return "highlight";
    case "image_focus":
      return "content";
    case "quote":
      return "highlight";
    case "summary":
      return "title";
    default:
      return layout;
  }
}

export function parsePptPageCount(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const pageCount = Number.parseInt(normalized, 10);
  if (pageCount < 4 || pageCount > 40) return null;
  return pageCount;
}

export function summarizeSlideContent(slide: PptSlide) {
  if (slide.layout === "highlight") {
    return [slide.highlight, ...(slide.bullets ?? [])].filter(Boolean).join(" · ");
  }
  if (slide.layout === "timeline") {
    return [...(slide.steps ?? []), slide.note].filter(Boolean).join(" → ");
  }
  if (slide.layout === "two_column") {
    return [...(slide.left ?? []), ...(slide.right ?? [])].filter(Boolean).join(" · ");
  }
  return [slide.subtitle, ...(slide.bullets ?? [])].filter(Boolean).join(" · ");
}
