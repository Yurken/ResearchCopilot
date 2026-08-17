import { useState } from "react";
import { apiClient, formatErrorMessage, type ResearchIdeaSuggestion } from "../../lib/client";

const MAX_ITEMS = 12;
const MAX_TEXT_CHARS = 12000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "csv", "tsv", "log"]);

export interface IdeaMaterialItem {
  id: string;
  name: string;
  kind: "text" | "image";
  content?: string;
  data?: string;
  mediaType?: string;
}

// Uint8Array → base64（分块避免 String.fromCharCode 调用栈溢出）。
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function getFileName(path: string) {
  return path.split(/[/\\]/).pop() || path;
}
function getExtension(path: string) {
  const name = getFileName(path);
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : "";
}

/**
 * 「没想好做什么」中的「给小妍资料找 idea」：收集零散材料（自由文字 + txt/md/pdf 文本 +
 * 图片），交给 knowledge_ideas_from_materials 提炼研究 idea 与背景。文档读取与图片转 base64
 * 在前端完成，含图片时后端走视觉模型。
 */
export function useIdeaFromMaterials() {
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<IdeaMaterialItem[]>([]);
  const [ideas, setIdeas] = useState<ResearchIdeaSuggestion[]>([]);
  const [feedback, setFeedback] = useState("");
  const [reading, setReading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addFiles = async () => {
    if (items.length >= MAX_ITEMS) {
      setError(`最多添加 ${MAX_ITEMS} 个材料。`);
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [{ name: "资料", extensions: ["pdf", ...Object.keys(IMAGE_MIME), ...TEXT_EXTENSIONS] }],
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length === 0) return;

      setReading(true);
      setError("");
      const next: IdeaMaterialItem[] = [];
      const failed: string[] = [];
      for (const path of paths.slice(0, MAX_ITEMS - items.length)) {
        const extension = getExtension(path);
        const name = getFileName(path);
        const id = `${Date.now()}-${path}`;
        try {
          if (IMAGE_MIME[extension]) {
            const { readFile } = await import("@tauri-apps/plugin-fs");
            const bytes = await readFile(path);
            if (bytes.length > MAX_IMAGE_BYTES) {
              throw new Error(`图片过大（上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB）`);
            }
            next.push({ id, name, kind: "image", data: bytesToBase64(bytes), mediaType: IMAGE_MIME[extension] });
          } else if (extension === "pdf") {
            const text = (await apiClient.papers.extractPdfText(path, MAX_TEXT_CHARS)).trim();
            if (!text) throw new Error("未提取到可读文本");
            next.push({ id, name, kind: "text", content: text });
          } else if (TEXT_EXTENSIONS.has(extension)) {
            const { readTextFile } = await import("@tauri-apps/plugin-fs");
            const text = (await readTextFile(path)).slice(0, MAX_TEXT_CHARS).trim();
            if (!text) throw new Error("文件为空");
            next.push({ id, name, kind: "text", content: text });
          } else {
            throw new Error(`不支持的类型 .${extension || "unknown"}`);
          }
        } catch (err) {
          failed.push(`${name}：${formatErrorMessage(err)}`);
        }
      }
      if (next.length) setItems((current) => [...current, ...next]);
      if (failed.length) setError(failed.join("；"));
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const removeItem = (id: string) => setItems((current) => current.filter((item) => item.id !== id));

  const generate = async () => {
    if (loading) return;
    const textParts: string[] = [];
    if (notes.trim()) textParts.push(`【手记 / 碎片】\n${notes.trim()}`);
    for (const item of items) {
      if (item.kind === "text" && item.content) textParts.push(`【${item.name}】\n${item.content}`);
    }
    const materials = textParts.join("\n\n---\n\n");
    const images = items.flatMap((item) =>
      item.kind === "image" && item.data && item.mediaType
        ? [{ data: item.data, mediaType: item.mediaType }]
        : [],
    );
    if (!materials.trim() && images.length === 0) {
      setError("请先添加一些材料：粘贴文字，或添加 txt / md / pdf / 图片。");
      return;
    }

    setLoading(true);
    setError("");
    setIdeas([]);
    try {
      const result = await apiClient.knowledge.ideasFromMaterials(materials, images, feedback.trim());
      setIdeas(result);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return {
    notes,
    setNotes,
    items,
    ideas,
    feedback,
    setFeedback,
    reading,
    loading,
    error,
    addFiles,
    removeItem,
    generate,
  };
}
