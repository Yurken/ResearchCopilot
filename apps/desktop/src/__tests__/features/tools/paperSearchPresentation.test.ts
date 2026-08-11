import { describe, expect, it } from "vitest";
import { paperDiscoverySourceLabel } from "../../../features/tools/paperSearchPresentation";

describe("paperDiscoverySourceLabel", () => {
  it("distinguishes search, citation, reference and full-text discovery", () => {
    expect(paperDiscoverySourceLabel("search")).toBeNull();
    expect(paperDiscoverySourceLabel("citation")).toBe("由引用论文发现");
    expect(paperDiscoverySourceLabel("reference")).toBe("由参考文献发现");
    expect(paperDiscoverySourceLabel("full_text_snippet")).toBe("由正文片段发现");
    expect(paperDiscoverySourceLabel("search+full_text_snippet")).toBe(
      "由论文检索与正文片段共同发现",
    );
  });
});
