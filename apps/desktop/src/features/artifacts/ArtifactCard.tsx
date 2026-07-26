import { useState } from "react";
import {
  FolderOpen,
  Download,
  FileText,
  Image,
  FileSpreadsheet,
  FileType,
  FileArchive,
  File,
  Presentation,
  AlertCircle,
} from "lucide-react";
import { artifactStorage, formatFileSize } from "./artifactStorage";
import type { Artifact } from "@research-copilot/types";

interface ArtifactCardProps {
  artifact: Artifact;
}

const KIND_ICONS: Record<Artifact["kind"], React.ReactNode> = {
  pptx: <Presentation className="h-5 w-5" />,
  docx: <FileText className="h-5 w-5" />,
  xlsx: <FileSpreadsheet className="h-5 w-5" />,
  pdf: <FileType className="h-5 w-5" />,
  image: <Image className="h-5 w-5" />,
  archive: <FileArchive className="h-5 w-5" />,
  other: <File className="h-5 w-5" />,
};

const KIND_LABELS: Record<Artifact["kind"], string> = {
  pptx: "PowerPoint",
  docx: "Word",
  xlsx: "Excel",
  pdf: "PDF",
  image: "图片",
  archive: "压缩包",
  other: "文件",
};

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleOpen = async () => {
    setBusy(true);
    setError("");
    try {
      await artifactStorage.open(artifact);
    } catch (err) {
      setError(`打开失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAs = async () => {
    setBusy(true);
    setError("");
    try {
      await artifactStorage.saveAs(artifact);
    } catch (err) {
      setError(`另存为失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    setBusy(true);
    setError("");
    try {
      await artifactStorage.reveal(artifact);
    } catch (err) {
      setError(`定位失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-2xl border p-3 space-y-2"
      style={{ background: "var(--rc-surface)", borderColor: "var(--rc-border)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: "rgba(0,122,255,0.12)", color: "#007AFF" }}
        >
          {KIND_ICONS[artifact.kind]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-primary truncate">
            {artifact.title || artifact.name}
          </p>
          <p className="text-[11px] text-ink-tertiary mt-0.5">
            {KIND_LABELS[artifact.kind]} · {formatFileSize(artifact.size)} ·{" "}
            {artifact.metadata && typeof artifact.metadata.slideCount === "number"
              ? `${artifact.metadata.slideCount} 页 · `
              : null}
            {formatDate(artifact.createdAt)}
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-1.5 text-xs text-apple-red">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleOpen}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-nm-dark/8 disabled:opacity-50"
          style={{ color: "var(--rc-text-secondary)" }}
        >
          <FileText className="h-3.5 w-3.5" />
          打开
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleSaveAs}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-nm-dark/8 disabled:opacity-50"
          style={{ color: "var(--rc-text-secondary)" }}
        >
          <Download className="h-3.5 w-3.5" />
          另存为
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleReveal}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-nm-dark/8 disabled:opacity-50"
          style={{ color: "var(--rc-text-secondary)" }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          在文件夹中显示
        </button>
      </div>
    </div>
  );
}
