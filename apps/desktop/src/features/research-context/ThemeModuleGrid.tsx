import {
  ArrowUpRight,
  FileText,
  MessageSquare,
  Send,
  SquareTerminal,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ResearchThemeProgress } from "./shared";

interface ThemeModuleGridProps {
  progress: ResearchThemeProgress;
}

interface ModuleCard {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
  iconColor: string;
  count: number | string;
  caption: string;
}

export default function ThemeModuleGrid({ progress }: ThemeModuleGridProps) {
  const modules: ModuleCard[] = [
    {
      key: "papers",
      label: "论文",
      to: "/papers",
      icon: FileText,
      iconColor: "text-apple-purple",
      count: progress.paperCount,
      caption: progress.analyzedPaperCount > 0 ? `${progress.analyzedPaperCount} 篇已解读` : "导入与解读",
    },
    {
      key: "notes",
      label: "笔记",
      to: "/knowledge",
      icon: StickyNote,
      iconColor: "text-apple-green",
      count: progress.noteCount,
      caption: progress.claimCount > 0 ? `${progress.claimCount} 条主张` : "知识沉淀",
    },
    {
      key: "code",
      label: "代码",
      to: "/code",
      icon: SquareTerminal,
      iconColor: "text-apple-orange",
      count: "DSH",
      caption: "官方 Harness",
    },
    {
      key: "submission",
      label: "投稿",
      to: "/submission",
      icon: Send,
      iconColor: "text-apple-blue",
      count: progress.submissionCount,
      caption: "投稿与版本",
    },
    {
      key: "sessions",
      label: "对话",
      to: "/chat",
      icon: MessageSquare,
      iconColor: "text-apple-teal",
      count: progress.sessionCount,
      caption: "围绕主题的问答",
    },
  ];

  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
        模块直达
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Link
              key={module.key}
              to={module.to}
              className="group rounded-2xl px-3 py-3 transition-shadow hover:shadow-md"
              style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-card-flat-shadow)" }}
            >
              <div className="flex items-center justify-between">
                <Icon className={`h-4 w-4 ${module.iconColor}`} />
                <ArrowUpRight className="h-3.5 w-3.5 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-2 text-xl font-semibold leading-7 text-ink-primary">{module.count}</p>
              <p className="text-xs font-medium text-ink-secondary">{module.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-ink-tertiary">{module.caption}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
