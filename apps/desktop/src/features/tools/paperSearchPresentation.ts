import type { PaperDiscoverySource } from "@research-copilot/types";

export function paperDiscoverySourceLabel(source: PaperDiscoverySource | undefined): string | null {
  switch (source) {
    case "citation":
      return "由引用论文发现";
    case "reference":
      return "由参考文献发现";
    case "full_text_snippet":
      return "由正文片段发现";
    case "search+full_text_snippet":
      return "由论文检索与正文片段共同发现";
    case "search":
    case undefined:
      return null;
  }
}
