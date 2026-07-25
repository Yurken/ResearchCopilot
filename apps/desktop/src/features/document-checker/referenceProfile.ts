import type {
  DocumentInspection,
  DocumentReferenceProfile,
  ReferenceDocumentMode,
} from "./types";

const CHINESE_FONT_SIZES: Record<string, number> = {
  初号: 42,
  小初: 36,
  一号: 26,
  小一: 24,
  二号: 22,
  小二: 18,
  三号: 16,
  小三: 15,
  四号: 14,
  小四: 12,
  五号: 10.5,
  小五: 9,
  六号: 7.5,
  小六: 6.5,
};

const KNOWN_FONTS = [
  "宋体",
  "黑体",
  "仿宋",
  "楷体",
  "微软雅黑",
  "方正小标宋",
  "Times New Roman",
  "Arial",
];

function parseMeasurement(value: string, unit: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (/inch|inches|英寸/i.test(unit)) return amount * 25.4;
  return /cm|厘米/i.test(unit) ? amount * 10 : amount;
}

function explicitMargin(text: string, side: "top" | "right" | "bottom" | "left") {
  const labels = { top: "上", right: "右", bottom: "下", left: "左" } as const;
  const chinese = text.match(new RegExp(String.raw`${labels[side]}(?:页)?边距[^\d]{0,12}(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|inch(?:es)?|英寸)`, "i"));
  const english = text.match(new RegExp(String.raw`${side}\s+margin[^\d]{0,12}(\d+(?:\.\d+)?)\s*(mm|cm|inch(?:es)?)`, "i"));
  const match = chinese ?? english;
  return match ? parseMeasurement(match[1], match[2]) : null;
}

function explicitUniformMargin(text: string) {
  const match = text.match(/(?<![上下左右])(?:四周|上下左右|页面)?\s*页?边距[^\d]{0,12}(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|inch(?:es)?|英寸)/i)
    ?? text.match(/(?:all\s+)?margins?[^\d]{0,12}(\d+(?:\.\d+)?)\s*(mm|cm|inch(?:es)?)/i);
  return match ? parseMeasurement(match[1], match[2]) : null;
}

function explicitBodyFonts(text: string) {
  const bodyContext = text.match(/(?:中文)?正文[^。；;\n]{0,80}/gi)?.join(" ") ?? "";
  return KNOWN_FONTS.filter((font) => bodyContext.toLocaleLowerCase().includes(font.toLocaleLowerCase()));
}

function explicitBodyFontSize(text: string) {
  const bodyContext = text.match(/(?:中文)?正文[^。；;\n]{0,80}/gi)?.join(" ") ?? "";
  const chineseSize = bodyContext.match(/小初|小[一二三四五六]|初号|[一二三四五六]号/)?.[0];
  if (chineseSize && chineseSize in CHINESE_FONT_SIZES) return CHINESE_FONT_SIZES[chineseSize];
  const pointMatch = bodyContext.match(/(\d+(?:\.\d+)?)\s*(?:pt|磅)/i);
  return pointMatch ? Number(pointMatch[1]) : null;
}

function explicitMaxPages(text: string) {
  const match = text.match(/(?:不超过|不得超过|最多|限于?|控制在)\s*(\d{1,4})\s*页/i);
  return match ? Number(match[1]) : null;
}

function inferredBodyFontSize(sizes: number[]) {
  const bodyCandidates = sizes.filter((size) => size >= 9 && size <= 14).sort((a, b) => a - b);
  if (bodyCandidates.length === 0) return null;
  return bodyCandidates[Math.floor(bodyCandidates.length / 2)];
}

export function deriveReferenceProfile(
  reference: DocumentInspection,
  mode: ReferenceDocumentMode = "explicit_rules",
): DocumentReferenceProfile {
  const text = reference.text;
  const explicitA4 = /(?:^|\W)A4(?:\W|$)/i.test(text);
  const explicitOrientation = /纵向|portrait/i.test(text)
    ? "portrait"
    : /横向|landscape/i.test(text) ? "landscape" : null;
  const uniformMargin = explicitUniformMargin(text);
  const explicitMargins = {
    top: explicitMargin(text, "top") ?? uniformMargin,
    right: explicitMargin(text, "right") ?? uniformMargin,
    bottom: explicitMargin(text, "bottom") ?? uniformMargin,
    left: explicitMargin(text, "left") ?? uniformMargin,
  };
  const hasCompleteExplicitMargins = Object.values(explicitMargins).every((value) => value !== null);
  const explicitFonts = explicitBodyFonts(text);
  const explicitSize = explicitBodyFontSize(text);
  const useTemplate = mode === "template";
  const templateOrientation = reference.pageWidthMm !== null && reference.pageHeightMm !== null
    ? reference.pageWidthMm > reference.pageHeightMm ? "landscape" : "portrait"
    : null;

  return {
    pageWidthMm: explicitA4 ? 210 : useTemplate ? reference.pageWidthMm : null,
    pageHeightMm: explicitA4 ? 297 : useTemplate ? reference.pageHeightMm : null,
    pageOrientation: explicitOrientation ?? (useTemplate ? templateOrientation : null),
    marginsMm: hasCompleteExplicitMargins
      ? explicitMargins as NonNullable<DocumentInspection["marginsMm"]>
      : useTemplate ? reference.marginsMm : null,
    fonts: explicitFonts.length > 0 ? explicitFonts : useTemplate ? reference.fonts : [],
    fontSizePt: explicitSize ?? (useTemplate ? inferredBodyFontSize(reference.fontSizesPt) : null),
    maxPages: explicitMaxPages(text),
    pageBasis: explicitA4 ? "规范文档明确要求" : useTemplate ? "模板文档版式" : "规范正文未明确要求",
    orientationBasis: explicitOrientation ? "规范文档明确要求" : useTemplate ? "模板文档版式" : "规范正文未明确要求",
    marginBasis: hasCompleteExplicitMargins ? "规范文档明确要求" : useTemplate ? "模板文档版式" : "规范正文未明确要求",
    fontBasis: explicitFonts.length > 0 ? "规范文档明确要求" : useTemplate ? "模板文档使用字体" : "规范正文未明确要求",
    fontSizeBasis: explicitSize !== null ? "规范文档明确要求" : useTemplate ? "模板文档常用字号" : "规范正文未明确要求",
  };
}
