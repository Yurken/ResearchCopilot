import { act, renderHook, waitFor } from "@testing-library/react";
import type { ArxivSearchResponse } from "@research-copilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePaperDiscoverySearch } from "../../../features/tools/usePaperDiscoverySearch";

const mocks = vi.hoisted(() => ({
  paperSearch: vi.fn(),
  webSearch: vi.fn(),
  rankFilter: vi.fn(),
}));

vi.mock("../../../lib/client", () => ({
  apiClient: {
    paperSearch: { search: mocks.paperSearch },
    webSearch: { query: mocks.webSearch },
  },
  journalApi: { rankFilter: mocks.rankFilter },
  paperSearchApi: {
    getHistory: vi.fn().mockResolvedValue([]),
    saveHistory: vi.fn().mockResolvedValue({}),
    deleteHistory: vi.fn().mockResolvedValue(true),
  },
  formatErrorMessage: (error: unknown) => String(error),
}));

const response: ArxivSearchResponse = {
  query: "hierarchical neural models",
  keywords: ["sign language"],
  applied_filters: { topic: "hierarchical neural models" },
  search_expression: "hierarchical neural models sign language",
  search_queries: ["hierarchical neural models", "spatiotemporal sign language"],
  query_plan_llm_used: true,
  query_plan_note: "小妍已将自然语言需求拆分为 2 条检索式。",
  cutoff_date: "2020-05-18",
  limit: 6,
  ranking_mode: "relevance",
  candidate_count: 1,
  llm_used: false,
  ranking_note: "已使用启发式相关性排序。",
  overall_summary: "找到 1 篇论文。",
  disclaimer: "联网检索结果。",
  papers: [],
};

const webSupplement = {
  provider: "tavily",
  answer: "补充找到一个项目主页。",
  items: [{ title: "Project page", url: "https://example.com/project", snippet: "Project details" }],
};

describe("usePaperDiscoverySearch", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.paperSearch.mockReset();
    mocks.webSearch.mockReset();
    mocks.rankFilter.mockReset();
  });

  it("跨页面卸载后恢复填写内容但结果不常驻", async () => {
    mocks.paperSearch.mockResolvedValue(response);
    mocks.webSearch.mockResolvedValue(webSupplement);
    const first = renderHook(() => usePaperDiscoverySearch());

    act(() => {
      first.result.current.panelProps.onTopicChange("hierarchical neural models");
      first.result.current.panelProps.onAllTermsChange("sign language");
      first.result.current.panelProps.onCutoffDateChange("2020-05-18");
    });

    await act(async () => {
      await first.result.current.panelProps.onSubmit();
    });

    expect(mocks.paperSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "hierarchical neural models",
        all_terms: ["sign language"],
      }),
      "2020-05-18",
      6,
      "relevance",
    );
    expect(mocks.webSearch).toHaveBeenNthCalledWith(1, "hierarchical neural models", "2020-05-18");
    expect(mocks.webSearch).toHaveBeenNthCalledWith(2, "spatiotemporal sign language", "2020-05-18");
    await waitFor(() => expect(first.result.current.resultProps.result).toEqual(response));
    first.unmount();

    const restored = renderHook(() => usePaperDiscoverySearch());
    expect(restored.result.current.panelProps.topic).toBe("hierarchical neural models");
    expect(restored.result.current.panelProps.allTerms).toBe("sign language");
    expect(restored.result.current.panelProps.cutoffDate).toBe("2020-05-18");
    expect(restored.result.current.resultProps.searched).toBe(false);
    expect(restored.result.current.resultProps.result).toBeNull();
    expect(restored.result.current.resultProps.webSupplement).toBeNull();
  });

  it("新检索失败时清空并持久化移除上一轮结果", async () => {
    mocks.paperSearch.mockResolvedValueOnce(response);
    mocks.webSearch.mockResolvedValue(webSupplement);
    const first = renderHook(() => usePaperDiscoverySearch());

    act(() => {
      first.result.current.panelProps.onTopicChange("first query");
    });
    await act(async () => {
      await first.result.current.panelProps.onSubmit();
    });
    expect(first.result.current.resultProps.result).toEqual(response);
    first.unmount();

    mocks.paperSearch.mockRejectedValueOnce(new Error("academic search failed"));
    const failed = renderHook(() => usePaperDiscoverySearch());
    act(() => {
      failed.result.current.panelProps.onTopicChange("second query");
    });
    await act(async () => {
      await failed.result.current.panelProps.onSubmit();
    });

    expect(failed.result.current.resultProps.error).toContain("academic search failed");
    expect(failed.result.current.resultProps.result).toBeNull();
    expect(failed.result.current.resultProps.webSupplement).toBeNull();
    failed.unmount();

    const restored = renderHook(() => usePaperDiscoverySearch());
    expect(restored.result.current.panelProps.topic).toBe("second query");
    expect(restored.result.current.resultProps.searched).toBe(false);
    expect(restored.result.current.resultProps.result).toBeNull();
    expect(restored.result.current.resultProps.webSupplement).toBeNull();
  });

  it("应用历史记录时恢复草稿和结果", async () => {
    mocks.paperSearch.mockResolvedValue(response);
    mocks.webSearch.mockResolvedValue(webSupplement);
    const historyEntry = {
      id: "entry-1",
      draft_json: JSON.stringify({
        topic: "historical query",
        allTerms: "sign language",
        cutoffDate: "2020-05-18",
        limit: "6",
        mode: "relevance",
      }),
      result_json: JSON.stringify({
        ...response,
        web_supplement: { ...webSupplement, note: null },
      }),
      created_at: "2026-07-23T00:00:00Z",
    };
    const { result } = renderHook(() => usePaperDiscoverySearch());

    act(() => {
      result.current.panelProps.onApplyHistory?.(historyEntry);
    });

    expect(result.current.panelProps.topic).toBe("historical query");
    expect(result.current.panelProps.allTerms).toBe("sign language");
    expect(result.current.resultProps.searched).toBe(true);
    expect(result.current.resultProps.result).toEqual(response);
    expect(result.current.resultProps.webSupplement).toEqual({ ...webSupplement, note: null });
  });
});
