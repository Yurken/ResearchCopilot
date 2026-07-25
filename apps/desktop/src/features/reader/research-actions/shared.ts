import type { Paper } from "@research-copilot/types";

export type ReaderResearchAction =
  | "explain-page"
  | "summarize-selection"
  | "research-question";

export interface PaperResearchStatusSummary {
  phase: string;
  nextAction: string;
  assets: string[];
  tone: "neutral" | "active" | "success" | "danger";
}

export function derivePaperResearchStatus(paper: Paper): PaperResearchStatusSummary {
  const assets = [
    paper.analysis ? "论文解读" : "",
    paper.reproduction_guide ? "复现指南" : "",
  ].filter(Boolean);

  if (["failed", "error"].includes(paper.status)) {
    return { phase: "处理受阻", nextAction: "检查失败原因并重新解析", assets, tone: "danger" };
  }
  if (paper.status === "parsing") {
    return { phase: "正在解析", nextAction: "解析完成后开始阅读", assets, tone: "active" };
  }
  if (paper.status === "analyzing") {
    return { phase: "正在精读", nextAction: "完成后核对关键结论", assets, tone: "active" };
  }
  if (paper.status === "reproduced" || paper.reproduction_guide) {
    return { phase: "已形成复现方案", nextAction: "创建实验并验证论文结果", assets, tone: "success" };
  }
  if (paper.status === "analyzed" || paper.analysis) {
    return { phase: "已完成精读", nextAction: "生成结构化笔记或发起研究问题", assets, tone: "success" };
  }
  if (paper.status === "parsed") {
    return { phase: "可阅读", nextAction: "开始精读并记录关键证据", assets, tone: "neutral" };
  }
  return { phase: "已导入", nextAction: "等待解析或手动重新解析", assets, tone: "neutral" };
}

export function buildReaderResearchPrompt(
  action: ReaderResearchAction,
  paper: Paper,
  page: number,
  selection?: string,
  pageText?: string,
) {
  const location = `论文《${paper.title}》第 ${page} 页`;
  const excerpt = pageText?.trim()
    ? `\n\n当前页原文：\n${pageText.trim().slice(0, 5000)}`
    : "";
  if (action === "summarize-selection" && selection?.trim()) {
    return `请总结并解释${location}的以下选中文字，指出它在全文论证中的作用，并区分原文事实与推断：\n\n${selection.trim()}${excerpt}`;
  }
  if (action === "research-question") {
    return `请基于${location}帮助我提出一个值得继续研究的问题。先说明问题来自本文哪项方法、结论或局限，再给出可验证的研究假设和下一步。${excerpt}`;
  }
  return `请解释${location}的核心内容，结合本页原文说明关键概念、方法和结论，并明确证据限制。${excerpt}`;
}

export function buildPaperExperimentDraft(paper: Paper) {
  const analysis = paper.analysis;
  const guide = paper.reproduction_guide;
  const metrics = guide?.evaluation_metrics || analysis?.experiment_results || "待从论文中补充";
  const notes = [
    `关联论文：${paper.title}`,
    paper.authors ? `作者：${paper.authors}` : null,
    paper.doi ? `DOI：${paper.doi}` : null,
    "",
    "## 研究目标",
    analysis?.research_question || `验证《${paper.title}》的核心方法与主要结论。`,
    "",
    "## 方法概述",
    analysis?.core_method || "待从论文精读结果中补充。",
    "",
    "## 建议复现步骤",
    guide?.dataset_preparation ? `1. 准备数据：${guide.dataset_preparation}` : "1. 获取并核对论文使用的数据集",
    guide?.environment_setup ? `2. 配置环境：${guide.environment_setup}` : "2. 对齐运行环境与依赖版本",
    guide?.training_process ? `3. 训练：${guide.training_process}` : "3. 运行论文默认训练配置",
    guide?.inference_process ? `4. 推理：${guide.inference_process}` : "4. 执行推理并保存原始输出",
    `5. 对比评价指标：${metrics}`,
    "6. 记录复现差异、原因与不确定项",
    "",
    "## 风险与不确定项",
    guide?.risks_and_notes || analysis?.limitations || "代码、数据版本和随机种子尚待确认。",
  ].filter((line): line is string => line !== null).join("\n");

  return {
    title: `复现：${paper.title}`,
    config: {
      source: "paper_reader",
      paper_id: paper.id,
      paper_title: paper.title,
      code_repository: guide?.code_repository || "",
      dependencies: guide?.dependencies || "",
      evaluation_metrics: metrics,
    },
    notes,
  };
}
