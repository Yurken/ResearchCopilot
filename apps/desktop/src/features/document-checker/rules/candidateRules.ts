import type { DocumentCheckIssue, DocumentCheckNotice, DocumentInspection } from "../types";

function checkNumberSequence(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((match) => Number(match[1])).filter(Number.isFinite);
}

function missingNumbers(values: number[]) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length < 2) return [];
  const missing: number[] = [];
  for (let value = 1; value <= unique[unique.length - 1]; value += 1) {
    if (!unique.includes(value)) missing.push(value);
  }
  return missing;
}

export function evaluateCandidate(candidate: DocumentInspection) {
  const issues: DocumentCheckIssue[] = [];
  const notices: DocumentCheckNotice[] = [];
  const passed: string[] = [];
  const add = (issue: Omit<DocumentCheckIssue, "id">) => issues.push({ id: `candidate-${issue.category}-${issues.length + 1}`, ...issue });
  const notice = (item: Omit<DocumentCheckNotice, "id">) => notices.push({ id: `candidate-${item.category}-notice-${notices.length + 1}`, ...item });

  if (candidate.blankPages.length > 0) {
    add({ severity: "warning", category: "page", message: `发现疑似空白页：第 ${candidate.blankPages.join("、")} 页`, location: `第 ${candidate.blankPages.join("、")} 页`, suggestion: "检查分页符、分节符或空段落，确认空白页是否必要。" });
  }
  if (candidate.pageCount && candidate.pageCount > 1) {
    const evidence = candidate.pageNumberEvidence ?? (candidate.fileType === "pdf" ? "rendered" : "unavailable");
    if (evidence !== "rendered") {
      notice({
        category: "page",
        status: "unavailable",
        message: evidence === "field_only" ? "检测到 DOCX PAGE 域，但无法确认渲染后的页码连续性" : "无法从当前文档确认渲染后的页码连续性",
        suggestion: "请导出 PDF 后检查，或在 Word 中核对各分节的起始页码与重启设置。",
      });
    } else if (candidate.pageNumbers.length === 0) {
      add({ severity: "warning", category: "page", message: "未检测到连续页码", suggestion: "检查 PDF 页面底部页码，或回到原始排版软件核对页码设置。" });
    } else {
      const missing = missingNumbers(candidate.pageNumbers);
      if (missing.length > 0) add({ severity: "warning", category: "page", message: `页码序列可能缺少：${missing.join("、")}`, suggestion: "检查分节后的页码是否重新起始或被隐藏。" });
      else passed.push("页码序列未发现明显断档");
    }
  }

  const figures = checkNumberSequence(candidate.text, /(?:图|Figure\s*)\s*(\d+)/gi);
  const tables = checkNumberSequence(candidate.text, /(?:表|Table\s*)\s*(\d+)/gi);
  if (figures.length === 0 && tables.length === 0) {
    notice({ category: "figure", status: "not_applicable", message: "未检测到图表，图表编号检查不适用", suggestion: "若文档实际包含图片题注，请确认题注未被转换为图片。" });
  } else {
    const missingFigures = missingNumbers(figures);
    const missingTables = missingNumbers(tables);
    if (missingFigures.length > 0 || missingTables.length > 0) {
      add({ severity: "warning", category: "figure", message: [missingFigures.length ? `图号缺少 ${missingFigures.join("、")}` : "", missingTables.length ? `表号缺少 ${missingTables.join("、")}` : ""].filter(Boolean).join("；"), suggestion: "核对图表题注、交叉引用和删除内容后留下的编号空缺。" });
    } else {
      passed.push("图表编号未发现明显断档");
    }
  }

  const headingNumbers = [...candidate.text.matchAll(/(?:^|\n)\s*(\d+)(?:\.\d+)*[\s、．.]\s*[^\d\n]{2,40}/gm)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (headingNumbers.length >= 2) {
    const missingHeadings = missingNumbers(headingNumbers);
    if (missingHeadings.length > 0) add({ severity: "warning", category: "heading", message: `一级标题编号可能缺少：${missingHeadings.join("、")}`, suggestion: "检查标题样式、多级列表和删除章节后留下的编号空缺。" });
    else passed.push("标题编号未发现明显断档");
  }

  const citations = checkNumberSequence(candidate.text, /\[(\d+)\]/g);
  const hasReferenceSection = /参考文献|references/i.test(candidate.text);
  if (citations.length > 0 && !hasReferenceSection) {
    add({ severity: "error", category: "citation", message: "正文存在顺序编码引用，但未识别到参考文献章节", suggestion: "补充参考文献列表，或确认章节标题未被转换为图片。" });
  } else if (hasReferenceSection) {
    passed.push("已识别参考文献章节");
  }

  if (candidate.hasComments || candidate.hasRevisions) {
    add({ severity: "error", category: "hidden", message: `${candidate.hasComments ? "存在批注" : ""}${candidate.hasComments && candidate.hasRevisions ? "，且" : ""}${candidate.hasRevisions ? "存在修订痕迹" : ""}`, suggestion: "提交前接受或拒绝全部修订并删除批注，再导出最终版本。" });
  } else if (candidate.fileType === "docx") {
    passed.push("未发现批注或修订痕迹");
  }

  return { issues, notices, passed };
}
