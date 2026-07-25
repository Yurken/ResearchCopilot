import type { ArxivSearchResponse } from "@research-copilot/types";
import { describe, expect, it } from "vitest";
import { render, screen } from "../../helpers/render";
import { ArxivSearchResults } from "../../../features/tools/ArxivSearchResults";

const result: ArxivSearchResponse = {
  query: "agent memory",
  keywords: [],
  applied_filters: { topic: "agent memory" },
  search_expression: "agent memory\nlong-term agent memory",
  search_queries: ["agent memory", "long-term agent memory"],
  query_plan_llm_used: true,
  query_plan_note: "小妍已将自然语言需求拆分为 2 条检索式。",
  cutoff_date: "2026-07-22",
  limit: 6,
  ranking_mode: "relevance",
  candidate_count: 0,
  llm_used: false,
  ranking_note: "已使用启发式相关性排序。",
  overall_summary: "学术数据源暂无匹配。",
  disclaimer: "联网检索结果。",
  papers: [],
};

describe("ArxivSearchResults", () => {
  it("在论文检索结果流中展示网络补充来源", () => {
    render(
      <ArxivSearchResults
        result={result}
        webSupplement={{
          provider: "tavily",
          items: [{ title: "Agent Memory Project", url: "https://example.com", snippet: "Project details" }],
        }}
        appliedFilters={[]}
        searched
        loading={false}
        error=""
        expressionLabel="本次查询表达式"
        emptyMatchHint="调整条件"
        emptySearchHint="重新检索"
        detailActionLabel="详情"
        detailActionTitle="打开详情"
        pdfActionLabel="PDF"
        pdfActionTitle="打开 PDF"
      />,
    );

    expect(screen.getByText("当前条件下没有匹配论文")).toBeInTheDocument();
    expect(screen.getByText("小妍拆分 2 条查询")).toBeInTheDocument();
    expect(screen.getByText("1. agent memory")).toBeInTheDocument();
    expect(screen.getByText("网络补充")).toBeInTheDocument();
    expect(screen.getByText("Agent Memory Project")).toBeInTheDocument();
  });
});
