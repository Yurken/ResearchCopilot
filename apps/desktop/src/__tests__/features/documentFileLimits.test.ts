import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FILE_LIMITS,
  validateDocumentFileSize,
} from "../../features/document-checker/fileLimits";

describe("文档比对资源限制", () => {
  it("拒绝超过上限的 PDF", () => {
    expect(() => validateDocumentFileSize("超大成稿.pdf", DOCUMENT_FILE_LIMITS.pdfBytes + 1))
      .toThrow("PDF 文件过大");
  });

  it("拒绝超过上限的 DOCX", () => {
    expect(() => validateDocumentFileSize("超大模板.docx", DOCUMENT_FILE_LIMITS.docxBytes + 1))
      .toThrow("DOCX 文件过大");
  });
});
