const MEBIBYTE = 1024 * 1024;

export const DOCUMENT_FILE_LIMITS = {
  pdfBytes: 100 * MEBIBYTE,
  docxBytes: 50 * MEBIBYTE,
  pdfPages: 500,
  docxUncompressedBytes: 200 * MEBIBYTE,
} as const;

export function validateDocumentFileSize(fileName: string, bytes: number) {
  const isPdf = fileName.toLocaleLowerCase().endsWith(".pdf");
  const limit = isPdf ? DOCUMENT_FILE_LIMITS.pdfBytes : DOCUMENT_FILE_LIMITS.docxBytes;
  if (bytes > limit) {
    throw new Error(`${isPdf ? "PDF" : "DOCX"} 文件过大（上限 ${Math.round(limit / MEBIBYTE)} MB），请压缩或拆分后重试。`);
  }
}
