import {
  BookOpen,
  FileText,
  Library,
  MessageSquare,
  Microscope,
  PenLine,
  Send,
  Sparkles,
  Wrench,
  SquareTerminal,
} from "lucide-react";
import type { InterestTab } from "../knowledge/ResearchWorkbench";

export type FreeTab =
  | "survey"
  | "papers"
  | "writing"
  | "knowledge"
  | "chat"
  | "tools"
  | "experiment"
  | "submission";

export type LegacyFreeTab = FreeTab | "copilot" | "xiaoyan";

export const FREE_TABS: Array<{ key: FreeTab; label: string; icon: typeof Sparkles }> = [
  { key: "survey", label: "综述", icon: BookOpen },
  { key: "papers", label: "论文", icon: FileText },
  { key: "writing", label: "写作", icon: PenLine },
  { key: "knowledge", label: "知识", icon: Library },
  { key: "chat", label: "对话", icon: MessageSquare },
  { key: "experiment", label: "代码", icon: SquareTerminal },
  { key: "submission", label: "投稿", icon: Send },
  { key: "tools", label: "工具", icon: Wrench },
];

const FREE_TAB_KEYS = FREE_TABS.map((t) => t.key);
const FREE_TAB_SET = new Set<string>(FREE_TAB_KEYS);

export function isFreeTab(value?: string): value is FreeTab {
  return FREE_TAB_SET.has(value ?? "");
}

export function normalizeFreeTab(value?: string): FreeTab {
  if (value === "copilot" || value === "xiaoyan") return "chat";
  return isFreeTab(value) ? value : "survey";
}

export const BASE_INTEREST_TABS: Array<{
  key: InterestTab;
  label: string;
  icon: typeof Sparkles;
}> = [
  { key: "overview", label: "总览", icon: Microscope },
  { key: "papers", label: "论文", icon: FileText },
  { key: "writing", label: "写作", icon: PenLine },
  { key: "chat", label: "对话", icon: MessageSquare },
  { key: "knowledge", label: "知识", icon: Library },
  { key: "experiment", label: "代码", icon: SquareTerminal },
  { key: "submission", label: "投稿", icon: Send },
  { key: "tools", label: "工具", icon: Wrench },
];

export const PLANNER_TAB: {
  key: InterestTab;
  label: string;
  icon: typeof Sparkles;
} = { key: "planner", label: "规划", icon: Sparkles };

export const INTEREST_TAB_KEYS: readonly InterestTab[] = [
  "overview",
  "planner",
  "papers",
  "writing",
  "chat",
  "xiaoyan",
  "knowledge",
  "notes",
  "tools",
  "experiment",
  "submission",
];

const INTEREST_TAB_SET = new Set<string>(INTEREST_TAB_KEYS);

export function isInterestTab(value?: string): value is InterestTab {
  return INTEREST_TAB_SET.has(value ?? "");
}

export function normalizeInterestTab(
  value: string | undefined,
  planned: boolean,
): InterestTab {
  if (value === "notes") return "knowledge";
  if (value === "xiaoyan" || value === "copilot") return "chat";
  if (isInterestTab(value) && (value !== "planner" || planned)) {
    return value;
  }
  return "overview";
}
