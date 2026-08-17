import { memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  BookOpen,
  ScrollText,
  Search,
  Map,
  Globe,
  Award,
} from "lucide-react";
import type { ChatToolResult } from "@research-copilot/types";

const TOOL_LABELS: Record<string, string> = {
  create_note: "创建笔记",
  generate_survey: "生成文献综述",
  search_knowledge: "搜索知识库",
  search_papers: "搜索论文库",
  generate_plan: "生成研究规划",
  search_arxiv: "arXiv 检索",
  query_journal: "期刊分区查询",
  lookup_ccf: "CCF 等级查询",
};

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  create_note: BookOpen,
  generate_survey: ScrollText,
  search_knowledge: Search,
  search_papers: FileText,
  generate_plan: Map,
  search_arxiv: Globe,
  query_journal: BookOpen,
  lookup_ccf: Award,
};

function getToolNavLink(toolName: string): string | null {
  switch (toolName) {
    case "create_note":
      return "/knowledge";
    case "generate_survey":
      return "/survey";
    case "search_papers":
      return "/papers";
    case "generate_plan":
      return "/planner";
    default:
      return null;
  }
}

export const ToolActionCard = memo(function ToolActionCard({ tool }: { tool: ChatToolResult }) {
  const navigate = useNavigate();
  const Icon = TOOL_ICONS[tool.tool_name] || Search;
  const label = TOOL_LABELS[tool.tool_name] || tool.tool_name;
  const navLink = getToolNavLink(tool.tool_name);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm mt-1"
      style={{
        borderColor: "var(--rc-border)",
        backgroundColor: "var(--rc-bg-secondary)",
      }}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--rc-accent)" }} />
      <span style={{ color: "var(--rc-text-secondary)" }}>
        {label}：{tool.result}
      </span>
      {navLink && (
        <button
          type="button"
          onClick={() => navigate(navLink)}
          className="text-xs font-medium shrink-0 hover:underline"
          style={{ color: "var(--rc-accent)" }}
        >
          查看
        </button>
      )}
    </div>
  );
});
