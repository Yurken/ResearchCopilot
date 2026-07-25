import type {
  DocumentCheckCategory,
  DocumentComparisonItem,
  DocumentInspection,
  DocumentReferenceProfile,
} from "../types";

const BODY_STYLE_MATCH_THRESHOLD = 0.95;

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeFontName(value: string) {
  return value.toLocaleLowerCase().replace(/[+\s_-]/g, "");
}

function fontNameMatches(actual: string, expected: string) {
  const aliases: Record<string, string[]> = {
    宋体: ["宋体", "simsun", "songti", "stsong"],
    黑体: ["黑体", "simhei", "heiti", "stheiti"],
    仿宋: ["仿宋", "fangsong", "stfangsong"],
    楷体: ["楷体", "kaiti", "stkaiti"],
    timesnewroman: ["timesnewroman", "times", "liberationserif"],
  };
  const expectedName = normalizeFontName(expected);
  const candidates = aliases[expectedName] ?? [expectedName];
  return candidates.some((candidate) => normalizeFontName(actual).includes(normalizeFontName(candidate)));
}

function usageRatio<T extends { characters: number }>(usage: T[], matches: (item: T) => boolean) {
  const total = usage.reduce((sum, item) => sum + item.characters, 0);
  if (total === 0) return null;
  return usage.filter(matches).reduce((sum, item) => sum + item.characters, 0) / total;
}

function unavailableComparison(id: string, category: DocumentCheckCategory, label: string, basis: string): DocumentComparisonItem {
  return {
    id,
    category,
    label,
    expected: "未识别",
    actual: "未识别",
    status: "unavailable",
    severity: "info",
    basis,
    suggestion: "请在原始排版软件中人工确认此项。",
  };
}

function orientation(width: number, height: number) {
  if (Math.abs(width - height) <= 2) return "方形";
  return width > height ? "横向" : "纵向";
}

export function buildLayoutComparisons(
  profile: DocumentReferenceProfile,
  candidate: DocumentInspection,
): DocumentComparisonItem[] {
  const comparisons: DocumentComparisonItem[] = [];
  const expectedWidth = profile.pageWidthMm;
  const expectedHeight = profile.pageHeightMm;
  const actualWidth = candidate.pageWidthMm;
  const actualHeight = candidate.pageHeightMm;
  const hasPageDimensions = expectedWidth !== null && expectedHeight !== null
    && actualWidth !== null && actualHeight !== null;

  if (hasPageDimensions) {
    const expected = [expectedWidth, expectedHeight].sort((a, b) => a - b);
    const actual = [actualWidth, actualHeight].sort((a, b) => a - b);
    const sizeMatches = actual.every((value, index) => Math.abs(value - expected[index]) <= 2);
    comparisons.push({
      id: "comparison-page-size",
      category: "page",
      label: "纸张尺寸",
      expected: `${rounded(expectedWidth)} × ${rounded(expectedHeight)} mm`,
      actual: `${rounded(actualWidth)} × ${rounded(actualHeight)} mm`,
      status: sizeMatches ? "match" : "mismatch",
      severity: "error",
      basis: profile.pageBasis,
      suggestion: "在页面设置中统一纸张大小，并检查是否混入其他尺寸页面。",
    });
    if (profile.pageOrientation) {
      const expectedOrientation = profile.pageOrientation === "portrait" ? "纵向" : "横向";
      const actualOrientation = orientation(actualWidth, actualHeight);
      comparisons.push({
        id: "comparison-page-orientation",
        category: "page",
        label: "页面方向",
        expected: expectedOrientation,
        actual: actualOrientation,
        status: expectedOrientation === actualOrientation ? "match" : "mismatch",
        severity: "error",
        basis: profile.orientationBasis,
        suggestion: "在页面设置中统一纵向或横向，避免把旋转后的同尺寸纸张误判为一致。",
      });
    } else {
      comparisons.push(unavailableComparison("comparison-page-orientation", "page", "页面方向", profile.orientationBasis));
    }
  } else {
    comparisons.push(unavailableComparison("comparison-page-size", "page", "纸张尺寸", profile.pageBasis));
    comparisons.push(unavailableComparison("comparison-page-orientation", "page", "页面方向", profile.orientationBasis));
  }

  if (profile.marginsMm && candidate.marginsMm) {
    const labels = ["上", "右", "下", "左"];
    const expected = [profile.marginsMm.top, profile.marginsMm.right, profile.marginsMm.bottom, profile.marginsMm.left];
    const actual = [candidate.marginsMm.top, candidate.marginsMm.right, candidate.marginsMm.bottom, candidate.marginsMm.left];
    const matches = actual.every((value, index) => Math.abs(value - expected[index]) <= 3);
    comparisons.push({
      id: "comparison-margins",
      category: "page",
      label: "页边距",
      expected: expected.map((value, index) => `${labels[index]} ${rounded(value)}`).join(" / ") + " mm",
      actual: actual.map((value, index) => `${labels[index]} ${rounded(value)}`).join(" / ") + " mm",
      status: matches ? "match" : "mismatch",
      severity: "warning",
      basis: profile.marginBasis,
      suggestion: candidate.fileType === "pdf" ? "PDF 页边距按正文边界估算，请回到 Word/LaTeX 页面设置中复核。" : "在 Word 的布局 → 页边距中按规范文档统一设置。",
    });
  } else {
    comparisons.push(unavailableComparison("comparison-margins", "page", "页边距", profile.marginBasis));
  }

  if (profile.fonts.length > 0 && candidate.fontUsage?.length) {
    const ratio = usageRatio(candidate.fontUsage, (item) => profile.fonts.some((font) => fontNameMatches(item.value, font)));
    comparisons.push({
      id: "comparison-fonts",
      category: "font",
      label: "正文字体",
      expected: `${profile.fonts.slice(0, 5).join("、")}（可识别正文字符占比 ≥ 95%）`,
      actual: ratio === null ? "未识别" : `匹配字符占比 ${Math.round(ratio * 100)}%`,
      status: ratio === null ? "unavailable" : ratio >= BODY_STYLE_MATCH_THRESHOLD ? "match" : "mismatch",
      severity: "warning",
      basis: profile.fontBasis,
      suggestion: "检查成稿正文样式，并统一为规范要求的字体；标题、脚注中的偶然命中不再视为通过。",
    });
  } else {
    comparisons.push(unavailableComparison("comparison-fonts", "font", "正文字体", profile.fontBasis));
  }

  if (profile.fontSizePt !== null && candidate.fontSizeUsage?.length) {
    const expectedFontSize = profile.fontSizePt;
    const ratio = usageRatio(candidate.fontSizeUsage, (item) => Math.abs(item.value - expectedFontSize) <= 0.6);
    comparisons.push({
      id: "comparison-font-size",
      category: "font",
      label: "正文字号",
      expected: `${rounded(expectedFontSize)} pt（可识别正文字符占比 ≥ 95%）`,
      actual: ratio === null ? "未识别" : `匹配字符占比 ${Math.round(ratio * 100)}%`,
      status: ratio === null ? "unavailable" : ratio >= BODY_STYLE_MATCH_THRESHOLD ? "match" : "mismatch",
      severity: "warning",
      basis: profile.fontSizeBasis,
      suggestion: "检查成稿正文样式的字号；脚注或单个字符出现目标字号不再视为通过。",
    });
  } else {
    comparisons.push(unavailableComparison("comparison-font-size", "font", "正文字号", profile.fontSizeBasis));
  }

  if (profile.maxPages !== null) {
    const pageCount = candidate.pageCount;
    comparisons.push({
      id: "comparison-page-limit",
      category: "page",
      label: "页数上限",
      expected: `不超过 ${profile.maxPages} 页`,
      actual: pageCount === null ? "未识别" : `${pageCount} 页`,
      status: pageCount === null ? "unavailable" : pageCount <= profile.maxPages ? "match" : "mismatch",
      severity: "error",
      basis: "规范文档明确要求",
      suggestion: "按规范压缩正文，或将允许的内容移至附录。",
    });
  }

  return comparisons;
}
