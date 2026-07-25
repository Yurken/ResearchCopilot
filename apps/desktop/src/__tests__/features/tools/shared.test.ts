import { describe, expect, it } from "vitest";
import {
  buildWebSupplementQuery,
  getDefaultCutoffDate,
  hasPaperDiscoveryCriteria,
  mergeWebSearchOutcomes,
} from "../../../features/tools/shared";

describe("tools shared", () => {
  const now = new Date(2026, 6, 22, 12);

  it("默认使用当天作为截止日期", () => {
    expect(getDefaultCutoffDate(undefined, now)).toBe("2026-07-22");
    expect(getDefaultCutoffDate(14, now)).toBe("2026-07-08");
  });

  it("检索词为空时允许使用研究主题或领域筛选", () => {
    expect(hasPaperDiscoveryCriteria({ topic: "agent memory" })).toBe(true);
    expect(hasPaperDiscoveryCriteria({ categories: ["cs.AI"] })).toBe(true);
    expect(hasPaperDiscoveryCriteria({})).toBe(false);
  });

  it("为论文检索同步生成网络补充查询", () => {
    expect(buildWebSupplementQuery({
      topic: "agent memory",
      title_terms: ["long context"],
      categories: ["cs.AI"],
      exclude_terms: ["survey"],
    })).toBe("agent memory, long context, cs.AI");
  });

  it("合并多条网络查询结果并按链接去重", () => {
    const merged = mergeWebSearchOutcomes([
      { provider: "tavily", items: [{ title: "A", url: "https://a.test", snippet: "one" }] },
      {
        provider: "tavily",
        items: [
          { title: "A copy", url: "https://a.test", snippet: "duplicate" },
          { title: "B", url: "https://b.test", snippet: "two" },
        ],
      },
    ]);

    expect(merged?.provider).toBe("tavily");
    expect(merged?.items.map((item) => item.title)).toEqual(["A", "B"]);
  });
});
