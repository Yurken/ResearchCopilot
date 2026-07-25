import { act, renderHook } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectDocx } from "../../features/document-checker/docxParser";
import { inspectPdf } from "../../features/document-checker/pdfParser";
import type { DocumentInspection } from "../../features/document-checker/shared";
import { useDocumentChecker } from "../../features/document-checker/useDocumentChecker";

vi.mock("../../features/document-checker/docxParser", () => ({ inspectDocx: vi.fn() }));
vi.mock("../../features/document-checker/pdfParser", () => ({ inspectPdf: vi.fn() }));

const reference: DocumentInspection = {
  fileName: "投稿规范.docx",
  fileType: "docx",
  pageCount: 2,
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
  fonts: ["宋体"],
  fontSizesPt: [12],
  text: "A4，正文宋体小四",
  pageNumbers: [1, 2],
  pageNumberEvidence: "rendered",
  blankPages: [],
  hasComments: false,
  hasRevisions: false,
};

const candidate: DocumentInspection = {
  ...reference,
  fileName: "论文成稿.pdf",
  fileType: "pdf",
  pageCount: 8,
  pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
};

describe("useDocumentChecker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(inspectDocx).mockResolvedValue(reference);
    vi.mocked(inspectPdf).mockResolvedValue(candidate);
  });

  it("选择两份文档后分别解析并生成比对报告", async () => {
    vi.mocked(open)
      .mockResolvedValueOnce("/tmp/投稿规范.docx")
      .mockResolvedValueOnce("/tmp/论文成稿.pdf");
    const { result } = renderHook(() => useDocumentChecker());

    await act(() => result.current.chooseFile("reference"));
    await act(() => result.current.chooseFile("candidate"));

    expect(result.current.referenceFile?.name).toBe("投稿规范.docx");
    expect(result.current.candidateFile?.name).toBe("论文成稿.pdf");
    expect(result.current.canCompare).toBe(true);

    await act(() => result.current.runComparison());

    expect(readFile).toHaveBeenNthCalledWith(1, "/tmp/投稿规范.docx");
    expect(readFile).toHaveBeenNthCalledWith(2, "/tmp/论文成稿.pdf");
    expect(inspectDocx).toHaveBeenCalledOnce();
    expect(inspectPdf).toHaveBeenCalledOnce();
    expect(result.current.report?.reference.fileName).toBe("投稿规范.docx");
    expect(result.current.report?.candidate.fileName).toBe("论文成稿.pdf");
    expect(result.current.referenceMode).toBe("explicit_rules");
  });

  it("替换任意文档时清空旧报告", async () => {
    vi.mocked(open)
      .mockResolvedValueOnce("/tmp/投稿规范.docx")
      .mockResolvedValueOnce("/tmp/论文成稿.pdf")
      .mockResolvedValueOnce("/tmp/新版规范.docx");
    const { result } = renderHook(() => useDocumentChecker());

    await act(() => result.current.chooseFile("reference"));
    await act(() => result.current.chooseFile("candidate"));
    await act(() => result.current.runComparison());
    expect(result.current.report).not.toBeNull();

    await act(() => result.current.chooseFile("reference"));
    expect(result.current.referenceFile?.name).toBe("新版规范.docx");
    expect(result.current.report).toBeNull();
  });

  it("切换规范文件角色时清空旧报告", async () => {
    vi.mocked(open)
      .mockResolvedValueOnce("/tmp/投稿规范.docx")
      .mockResolvedValueOnce("/tmp/论文成稿.pdf");
    const { result } = renderHook(() => useDocumentChecker());

    await act(() => result.current.chooseFile("reference"));
    await act(() => result.current.chooseFile("candidate"));
    await act(() => result.current.runComparison());
    expect(result.current.report).not.toBeNull();

    act(() => result.current.setReferenceMode("template"));
    expect(result.current.referenceMode).toBe("template");
    expect(result.current.report).toBeNull();
  });
});
