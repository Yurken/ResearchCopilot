import type { WebSearchItem } from "@research-copilot/types";

export type DisclosureStatus = "private" | "submitted" | "public";
export type PatentRiskLevel = "low" | "medium" | "high" | "unknown";
export type PatentEvidenceQuality = "web_clue";

export interface PatentSearchPlan {
  features: string[];
  booleanQuery: string;
  webQuery: string;
}

export interface PatentSearchResult extends WebSearchItem {
  publicationNumber: string;
  relevanceScore: number;
  evidenceQuality: PatentEvidenceQuality;
  sourceVerified: boolean;
}

export interface PatentabilityReport {
  noveltyRisk: PatentRiskLevel;
  inventivenessRisk: PatentRiskLevel;
  disclosureRisk: PatentRiskLevel;
  summary: string;
  arguablePoints: string[];
  nextSteps: string[];
  evidenceSummary: string;
}

const FEATURE_SPLIT = /[\n,，;；、|]+/;
const GENERIC_TERMS = new Set(["一种", "通过", "基于", "用于", "方法", "系统", "装置", "技术", "研究", "实现", "进行"]);

export function extractPatentFeatures(description: string, keywords: string): string[] {
  const explicit = keywords.split(FEATURE_SPLIT).map((item) => item.trim()).filter(Boolean);
  const candidates = explicit.length > 0
    ? explicit
    : description
      .split(/[。！？.!?；;\n]+/)
      .flatMap((sentence) => sentence.split(/[，,：:]/))
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 28);

  return [...new Set(candidates)]
    .filter((item) => !GENERIC_TERMS.has(item))
    .slice(0, 8);
}

export function buildPatentSearchPlan(description: string, keywords: string): PatentSearchPlan {
  const features = extractPatentFeatures(description, keywords);
  const fallback = description.trim().slice(0, 80);
  const searchFeatures = features.length > 0 ? features : [fallback];
  const booleanQuery = searchFeatures.map((feature) => `(${feature})`).join(" AND ");
  return {
    features: searchFeatures,
    booleanQuery,
    webQuery: `中国发明专利 ${searchFeatures.join(" ")} site:patents.google.com/patent/CN`,
  };
}

function normalizedTokens(value: string): string[] {
  const latin = value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  const chinese = value.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  return [...new Set([...latin, ...chinese])];
}

function extractPublicationNumber(value: string): string {
  return value.match(/\bCN\s?\d{6,12}\s?[A-Z]\d?\b/i)?.[0]?.replace(/\s/g, "").toUpperCase() ?? "";
}

export function rankPatentResults(items: WebSearchItem[], plan: PatentSearchPlan): PatentSearchResult[] {
  const featureTokens = normalizedTokens(plan.features.join(" "));
  const ranked = items
    .map((item) => {
      const haystack = `${item.title} ${item.snippet} ${item.url}`.toLocaleLowerCase();
      const matched = featureTokens.filter((token) => haystack.includes(token.toLocaleLowerCase())).length;
      const relevanceScore = featureTokens.length > 0 ? matched / featureTokens.length : 0;
      const publicationNumber = extractPublicationNumber(`${item.title} ${item.url} ${item.snippet}`);
      let sourceVerified = false;
      try {
        sourceVerified = new URL(item.url).hostname === "patents.google.com" && Boolean(publicationNumber);
      } catch {
        sourceVerified = false;
      }
      return {
        ...item,
        publicationNumber,
        relevanceScore,
        evidenceQuality: "web_clue" as const,
        sourceVerified,
      };
    })
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  const deduplicated = new Map<string, PatentSearchResult>();
  for (const item of ranked) {
    const normalizedUrl = item.url.split(/[?#]/)[0].replace(/\/$/, "").toLocaleLowerCase();
    const key = item.publicationNumber || normalizedUrl;
    if (!deduplicated.has(key)) deduplicated.set(key, item);
  }
  return [...deduplicated.values()];
}

export function buildPatentabilityReport(
  results: PatentSearchResult[],
  disclosureStatus: DisclosureStatus,
): PatentabilityReport {
  const verifiedResults = results.filter((item) => item.sourceVerified);
  const highest = verifiedResults[0]?.relevanceScore ?? 0;
  const noveltyRisk: PatentRiskLevel = highest >= 0.7 ? "high" : highest >= 0.35 ? "medium" : "unknown";
  const inventivenessRisk: PatentRiskLevel = highest >= 0.5 ? "high" : highest >= 0.35 ? "medium" : "unknown";
  const disclosureRisk: PatentRiskLevel = disclosureStatus === "public" ? "high" : disclosureStatus === "submitted" ? "medium" : "low";

  const summary = verifiedResults.length === 0 || highest < 0.35
    ? "当前只有公开网络线索，或可核验公开号的特征命中不足，无法据此判断新颖性与创造性。"
    : highest >= 0.7
      ? "发现与多数技术特征重叠的公开结果，新颖性风险偏高，应逐项比对权利要求和公开日。"
      : "暂未发现覆盖全部特征的高重叠结果，但仍需继续检索同义词、分类号和非专利文献。";

  return {
    noveltyRisk,
    inventivenessRisk,
    disclosureRisk,
    summary,
    arguablePoints: [
      "明确区别于现有技术的必要技术特征及其组合关系",
      "补充区别特征带来的、可由实验数据支持的技术效果",
      "避免仅以研究目的或应用场景作为核心区别点",
    ],
    nextSteps: [
      "在国家知识产权局等官方数据库用同义词与 IPC 分类号复核",
      "逐篇阅读最接近结果的独立权利要求，而不只看标题与摘要",
      "公开论文、答辩、展会或开源前，与专利代理师确认申请时点",
    ],
    evidenceSummary: `${results.length} 条网页线索，其中 ${verifiedResults.length} 条识别到 Google Patents 来源与中国公开号；未读取完整权利要求。`,
  };
}

export function buildAiPatentPrompt(
  description: string,
  plan: PatentSearchPlan,
  results: PatentSearchResult[],
  disclosureStatus: DisclosureStatus,
): string {
  const evidence = results.slice(0, 8).map((item, index) =>
    `${index + 1}. ${item.title}\n公开号：${item.publicationNumber || "未识别"}\n摘要片段：${item.snippet}\n链接：${item.url}`
  ).join("\n\n");
  return `你是面向中国科研人员的专利检索助手。请基于给定材料输出中文“专利性初步评估”，不得编造专利内容，不得把检索片段当作完整权利要求，也不得给出确定的授权结论。

技术方案：
${description}

关键技术特征：${plan.features.join("；")}
披露状态：${disclosureStatus}

公开网络线索（仅标题与摘要片段，不是完整权利要求）：
${evidence || "暂无结果"}

请依次给出：
1. 结论摘要；
2. 新颖性风险（低/中/高/无法判断）与逐特征理由；
3. 创造性风险与最接近现有技术组合；
4. 可争辩的区别特征；
5. 披露风险；
6. 下一轮检索词、可能的 IPC/CPC 方向和人工复核清单。

最后明确说明：本报告仅供检索与沟通准备，不构成法律意见。`;
}
