import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { DocumentInspection } from "./shared";
import { DOCUMENT_FILE_LIMITS } from "./fileLimits";

const PT_TO_MM = 25.4 / 72;

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function inspectPdf(bytes: Uint8Array, fileName: string): Promise<DocumentInspection> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  if (document.numPages > DOCUMENT_FILE_LIMITS.pdfPages) {
    await document.destroy();
    throw new Error(`PDF 页数超过 ${DOCUMENT_FILE_LIMITS.pdfPages} 页，请拆分后重试。`);
  }
  const pageWidths: number[] = [];
  const pageHeights: number[] = [];
  const topMargins: number[] = [];
  const rightMargins: number[] = [];
  const bottomMargins: number[] = [];
  const leftMargins: number[] = [];
  const fonts = new Set<string>();
  const fontSizes = new Set<number>();
  const fontUsage = new Map<string, number>();
  const fontSizeUsage = new Map<number, number>();
  const pageNumbers: number[] = [];
  const blankPages: number[] = [];
  const pageTexts: string[] = [];
  let hasComments = false;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const annotations = await page.getAnnotations();
    if (annotations.some((annotation) => annotation.subtype === "Text" || Boolean(annotation.contents))) hasComments = true;
    const items = content.items.filter((item): item is TextItem => "str" in item && Boolean(item.str.trim()));
    const text = items.map((item) => item.str).join(" ");
    pageTexts.push(text);
    pageWidths.push(viewport.width * PT_TO_MM);
    pageHeights.push(viewport.height * PT_TO_MM);
    if (!text.trim()) blankPages.push(pageNumber);

    if (items.length > 0) {
      const left = Math.min(...items.map((item) => item.transform[4]));
      const right = Math.max(...items.map((item) => item.transform[4] + item.width));
      const bottom = Math.min(...items.map((item) => item.transform[5]));
      const top = Math.max(...items.map((item) => item.transform[5] + Math.abs(item.height)));
      leftMargins.push(left * PT_TO_MM);
      rightMargins.push((viewport.width - right) * PT_TO_MM);
      bottomMargins.push(bottom * PT_TO_MM);
      topMargins.push((viewport.height - top) * PT_TO_MM);
    }

    for (const item of items) {
      const style = content.styles[item.fontName];
      const characters = item.str.trim().length;
      if (style?.fontFamily) {
        fonts.add(style.fontFamily);
        fontUsage.set(style.fontFamily, (fontUsage.get(style.fontFamily) ?? 0) + characters);
      }
      const size = Math.hypot(item.transform[0], item.transform[1]);
      if (size >= 5 && size <= 72) {
        const roundedSize = Math.round(size * 10) / 10;
        fontSizes.add(roundedSize);
        fontSizeUsage.set(roundedSize, (fontSizeUsage.get(roundedSize) ?? 0) + characters);
      }
      if (item.transform[5] < viewport.height * 0.12 && /^\d{1,4}$/.test(item.str.trim())) pageNumbers.push(Number(item.str.trim()));
    }
  }

  const width = median(pageWidths);
  const height = median(pageHeights);
  const top = median(topMargins);
  const right = median(rightMargins);
  const bottom = median(bottomMargins);
  const left = median(leftMargins);
  return {
    fileName,
    fileType: "pdf",
    pageCount: document.numPages,
    pageWidthMm: width,
    pageHeightMm: height,
    marginsMm: top !== null && right !== null && bottom !== null && left !== null ? { top, right, bottom, left } : null,
    fonts: [...fonts],
    fontSizesPt: [...fontSizes].sort((a, b) => a - b),
    fontUsage: [...fontUsage].map(([value, characters]) => ({ value, characters })),
    fontSizeUsage: [...fontSizeUsage].map(([value, characters]) => ({ value, characters })),
    text: pageTexts.join("\n\n"),
    pageNumbers: [...new Set(pageNumbers)],
    pageNumberEvidence: "rendered",
    blankPages,
    hasComments,
    hasRevisions: false,
  };
}
