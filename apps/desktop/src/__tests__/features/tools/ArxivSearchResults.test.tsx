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

  it("展示研究意图、成本、相关性分层和论文关系", () => {
    const richResult: ArxivSearchResponse = {
      ...result,
      candidate_count: 3,
      search_depth: "balanced",
      search_intent: {
        summary: "探索复杂学术搜索与查询演化",
        concepts: ["academic search"],
        methods: ["query evolution"],
        datasets: [],
        domains: ["information retrieval"],
        venues: [],
        time_constraints: [],
      },
      metrics: {
        academic_api_calls: 4,
        web_api_calls: 2,
        llm_calls: 2,
        estimated_tokens: 1280,
        duration_ms: 2400,
        iterations: 2,
        filtered_count: 1,
      },
      strategy_trace: [{
        stage: "query_plan",
        label: "查询理解与分解",
        status: "completed",
        candidate_count: 2,
        duration_ms: 20,
        note: "已拆分查询。",
      }],
      papers: [
        {
          arxiv_id: "seed",
          title: "Seed paper",
          authors: "A",
          category: "SIGIR",
          published_at: "2025-01-01",
          updated_at: "2025-01-01",
          abstract_text: "Seed abstract",
          abs_url: "https://example.com/seed",
          pdf_url: "https://example.com/seed.pdf",
          score: 91,
          reason: "Matches the full query.",
          tags: [],
          citation_count: 20,
          relevance_band: "high",
          matched_queries: ["academic search query evolution"],
          discovered_via: "search",
        },
        {
          arxiv_id: "related",
          title: "Related paper",
          authors: "B",
          category: "ACL",
          published_at: "2026-01-01",
          updated_at: "2026-01-01",
          abstract_text: "Related abstract",
          abs_url: "https://example.com/related",
          pdf_url: "https://example.com/related.pdf",
          score: 68,
          reason: "Covers one subproblem.",
          tags: [],
          citation_count: 4,
          relevance_band: "partial",
          discovered_via: "citation",
        },
        {
          arxiv_id: "snippet",
          title: "Full-text evidence paper",
          authors: "C",
          category: "ICLR",
          published_at: "2024-01-01",
          updated_at: "2024-01-01",
          abstract_text: "Published abstract",
          abs_url: "https://example.com/snippet",
          pdf_url: "https://example.com/snippet.pdf",
          score: 76,
          reason: "The task description appears in the body text.",
          tags: [],
          citation_count: 2,
          relevance_band: "partial",
          discovered_via: "search+full_text_snippet",
        },
      ],
      relations: [{ source_id: "seed", target_id: "related", kind: "cited_by" }],
    };

    render(
      <ArxivSearchResults
        result={richResult}
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

    expect(screen.getByText("搜索策略与成本")).toBeInTheDocument();
    expect(screen.getByText("探索复杂学术搜索与查询演化")).toBeInTheDocument();
    expect(screen.getByText("高度相关")).toBeInTheDocument();
    expect(screen.getAllByText("部分相关")).toHaveLength(2);
    expect(screen.getByText("论文关系图")).toBeInTheDocument();
    expect(screen.getByText("被引用")).toBeInTheDocument();
    expect(screen.getByText("由论文检索与正文片段共同发现")).toBeInTheDocument();
    expect(screen.getByText("1,280")).toBeInTheDocument();
  });
});
