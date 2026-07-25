import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/client";
import { usePatentSearch } from "../../features/patent-tool/usePatentSearch";

describe("usePatentSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("未确认外发时不调用公开网络搜索", async () => {
    const query = vi.spyOn(apiClient.webSearch, "query");
    const { result } = renderHook(() => usePatentSearch());

    act(() => result.current.setDescription("一种未公开技术方案"));
    await act(() => result.current.search());

    expect(query).not.toHaveBeenCalled();
    expect(result.current.error).toContain("请先确认");
  });

  it("修改任意检索输入后立即让旧结果失效", async () => {
    vi.spyOn(apiClient.webSearch, "query").mockResolvedValue({
      provider: "tavily",
      items: [{
        title: "CN115123456A 多尺度特征融合",
        url: "https://patents.google.com/patent/CN115123456A/zh",
        snippet: "在线蒸馏",
      }],
    });
    const { result } = renderHook(() => usePatentSearch());

    act(() => {
      result.current.setDescription("旧方案");
      result.current.setKeywords("多尺度特征融合，在线蒸馏");
      result.current.setSearchConsent(true);
    });
    await act(() => result.current.search());
    expect(result.current.results).toHaveLength(1);
    expect(result.current.snapshot?.description).toBe("旧方案");

    act(() => result.current.setDescription("新方案"));
    expect(result.current.results).toEqual([]);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.searched).toBe(false);
  });

  it("输入变化后旧请求不得覆盖新状态", async () => {
    let resolveSearch!: (value: Awaited<ReturnType<typeof apiClient.webSearch.query>>) => void;
    const pendingOutcome = new Promise<Awaited<ReturnType<typeof apiClient.webSearch.query>>>((resolve) => {
      resolveSearch = resolve;
    });
    vi.spyOn(apiClient.webSearch, "query").mockReturnValue(pendingOutcome);
    const { result } = renderHook(() => usePatentSearch());

    act(() => {
      result.current.setDescription("旧方案");
      result.current.setKeywords("旧特征");
      result.current.setSearchConsent(true);
    });
    let pendingSearch!: Promise<void>;
    act(() => {
      pendingSearch = result.current.search();
    });
    expect(result.current.loading).toBe(true);

    act(() => result.current.setDescription("新方案"));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSearch({
        provider: "tavily",
        items: [{ title: "旧结果", url: "https://example.com/old", snippet: "旧特征" }],
      });
      await pendingSearch;
    });

    expect(result.current.description).toBe("新方案");
    expect(result.current.results).toEqual([]);
    expect(result.current.snapshot).toBeNull();
  });
});
