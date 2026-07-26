import { Badge, Card } from "@research-copilot/ui";
import { FileText, Layers3, Presentation } from "lucide-react";
import { PPT_LAYOUT_LABELS, summarizeSlideContent, type PptData, type PptLayout } from "./pptShared";

interface PptPreviewPanelProps {
  data: PptData;
  fileBaseName: string;
}

const layoutBadgeVariant: Record<PptLayout, "default" | "success" | "warning" | "info" | "purple"> = {
  title: "purple",
  section: "default",
  content: "info",
  two_column: "warning",
  highlight: "success",
  timeline: "purple",
  agenda: "info",
  comparison: "warning",
  process: "purple",
  data_chart: "success",
  image_focus: "info",
  quote: "default",
  summary: "success",
};

export function PptPreviewPanel({ data, fileBaseName }: PptPreviewPanelProps) {
  const layoutCounts = data.slides.reduce<Record<string, number>>((acc, slide) => {
    acc[slide.layout] = (acc[slide.layout] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card padding="md" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2 min-w-0">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
            <Presentation className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-primary">生成预览</p>
            <h3 className="mt-1 truncate text-lg font-semibold text-ink-primary">{data.title}</h3>
            <p className="mt-1 text-xs text-ink-muted">先确认页面结构，再下载 PowerPoint 文件。</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Badge variant="info">{data.slides.length} 页</Badge>
          <Badge variant="default" className="max-w-full">
            <FileText className="mr-1 h-3.5 w-3.5" />
            {fileBaseName}.pptx
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(layoutCounts).map(([layout, count]) => (
          <Badge key={layout} variant={layoutBadgeVariant[layout as PptLayout]}>
            <Layers3 className="mr-1 h-3.5 w-3.5" />
            {PPT_LAYOUT_LABELS[layout as PptLayout]} {count}
          </Badge>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {data.slides.map((slide, index) => (
          <div
            key={`${slide.layout}-${index}-${slide.title}`}
            className="min-w-0 rounded-2xl border px-4 py-3"
            style={{
              background: "var(--rc-surface)",
              borderColor: "var(--rc-border)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold tracking-[0.14em] text-ink-muted">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Badge variant={layoutBadgeVariant[slide.layout]}>
                {PPT_LAYOUT_LABELS[slide.layout]}
              </Badge>
            </div>
            <p className="mt-3 break-words text-sm font-semibold leading-6 text-ink-primary">{slide.title}</p>
            <p className="mt-2 break-words text-xs leading-6 text-ink-muted">
              {summarizeSlideContent(slide) || "该页将由小妍自动补齐内容。"}
            </p>
            {slide.note && (
              <p className="mt-2 break-words text-[11px] leading-5 text-ink-muted/80" title={slide.note}>
                <span className="font-medium">备注：</span>
                {slide.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
