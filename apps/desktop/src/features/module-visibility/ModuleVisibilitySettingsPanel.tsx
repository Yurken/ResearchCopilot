import {
  Camera,
  ClipboardList,
  Code2,
  FileCheck2,
  FileSearch,
  FileText,
  Github,
  Globe2,
  Languages,
  Presentation,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Card } from "@research-copilot/ui";
import { TOOL_MODULES, type ModuleGroupKey } from "./shared";
import { useModuleVisibility } from "./useModuleVisibility";

const MODULE_ICONS: Record<string, LucideIcon> = {
  code: Code2,
  snapshots: Camera,
  records: ClipboardList,
  arxiv: Sparkles,
  github: Github,
  source: FileSearch,
  translate: Languages,
  md: FileText,
  ppt: Presentation,
  patent: Scale,
  "document-check": FileCheck2,
  links: Globe2,
};

function ModuleGroup({
  group,
  title,
  description,
  modules,
  values,
  onToggle,
}: {
  group: ModuleGroupKey;
  title: string;
  description: string;
  modules: readonly { key: string; label: string; description: string }[];
  values: Record<string, boolean>;
  onToggle: (group: ModuleGroupKey, key: string) => void;
}) {
  const visibleCount = Object.values(values).filter(Boolean).length;

  return (
    <Card variant="inset" padding="md">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-primary">{title}</p>
          <p className="mt-1 text-xs leading-5 text-ink-tertiary">{description}</p>
        </div>
        <Badge>{visibleCount} / {modules.length} 已显示</Badge>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {modules.map((module) => {
          const visible = values[module.key] !== false;
          const lastVisible = visible && visibleCount === 1;
          const ModuleIcon = MODULE_ICONS[module.key] ?? SlidersHorizontal;
          return (
            <button
              key={module.key}
              type="button"
              aria-pressed={visible}
              disabled={lastVisible}
              title={lastVisible ? "每组至少保留一个页签" : undefined}
              onClick={() => onToggle(group, module.key)}
              className="flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-[transform,box-shadow,border-color,background-color] duration-150 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0"
              style={{
                borderColor: visible
                  ? "color-mix(in srgb, var(--rc-accent) 24%, var(--rc-control-border))"
                  : "var(--rc-card-outline)",
                background: visible ? "var(--rc-chip-bg)" : "var(--rc-card-inset-bg)",
                boxShadow: visible ? "var(--rc-chip-shadow)" : "var(--rc-card-inset-shadow)",
              }}
            >
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: visible ? "var(--rc-info-chip-bg)" : "var(--rc-card-inset-bg)",
                  boxShadow: visible ? "var(--rc-info-chip-shadow)" : "var(--rc-card-inset-shadow)",
                  color: visible ? "var(--rc-info-chip-text)" : "var(--rc-text-muted)",
                }}
              >
                <ModuleIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-primary">{module.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-ink-tertiary">{module.description}</span>
              </span>
              <Badge variant={visible ? "success" : "default"}>{visible ? "显示" : "隐藏"}</Badge>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function ModuleVisibilitySettingsPanel() {
  const { config, toggle, reset } = useModuleVisibility();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-ink-secondary" />
          <div>
            <p className="text-sm font-semibold text-ink-primary">自定义模块</p>
            <p className="mt-0.5 text-xs text-ink-tertiary">隐藏暂时用不到的页签，不会删除已有数据。</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          恢复默认
        </Button>
      </div>

      <ModuleGroup
        group="tools"
        title="实用工具页签"
        description="只展示与你当前研究方向有关的工具。"
        modules={TOOL_MODULES}
        values={config.tools}
        onToggle={(group, key) => toggle(group, key as never)}
      />
    </div>
  );
}
