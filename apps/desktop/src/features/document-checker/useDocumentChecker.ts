import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { formatErrorMessage } from "../../lib/client";
import { inspectDocx } from "./docxParser";
import { inspectPdf } from "./pdfParser";
import { validateDocumentFileSize } from "./fileLimits";
import {
  compareDocuments,
  type DocumentComparisonReport,
  type DocumentInspection,
  type DocumentRole,
  type ReferenceDocumentMode,
  type SelectedDocumentFile,
} from "./shared";

const ROLE_LABELS: Record<DocumentRole, string> = {
  reference: "规范文档",
  candidate: "待校验文档",
};

async function inspectFile(file: SelectedDocumentFile): Promise<DocumentInspection> {
  const bytes = await readFile(file.path);
  validateDocumentFileSize(file.name, bytes.byteLength);
  return file.name.toLocaleLowerCase().endsWith(".pdf")
    ? inspectPdf(bytes, file.name)
    : inspectDocx(bytes, file.name);
}

export function useDocumentChecker() {
  const [referenceFile, setReferenceFile] = useState<SelectedDocumentFile | null>(null);
  const [candidateFile, setCandidateFile] = useState<SelectedDocumentFile | null>(null);
  const [referenceMode, setReferenceModeState] = useState<ReferenceDocumentMode>("explicit_rules");
  const [report, setReport] = useState<DocumentComparisonReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const comparisonRequestId = useRef(0);

  const invalidateComparison = () => {
    comparisonRequestId.current += 1;
    setReport(null);
    setLoading(false);
    setError("");
  };

  const chooseFile = async (role: DocumentRole) => {
    const selected = await open({
      title: `选择${ROLE_LABELS[role]}`,
      multiple: false,
      filters: [{ name: "PDF 或 DOCX 文档", extensions: ["pdf", "docx"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    const file = {
      path: selected,
      name: selected.split(/[\\/]/).pop() ?? selected,
    };
    if (role === "reference") setReferenceFile(file);
    else setCandidateFile(file);
    invalidateComparison();
  };

  const clearFile = (role: DocumentRole) => {
    if (role === "reference") setReferenceFile(null);
    else setCandidateFile(null);
    invalidateComparison();
  };

  const runComparison = async () => {
    if (!referenceFile || !candidateFile || loading) return;
    const requestId = ++comparisonRequestId.current;
    try {
      setLoading(true);
      setError("");
      const [reference, candidate] = await Promise.all([
        inspectFile(referenceFile).catch((cause) => {
          throw new Error(`规范文档解析失败：${formatErrorMessage(cause)}`);
        }),
        inspectFile(candidateFile).catch((cause) => {
          throw new Error(`待校验文档解析失败：${formatErrorMessage(cause)}`);
        }),
      ]);
      if (requestId !== comparisonRequestId.current) return;
      setReport(compareDocuments(reference, candidate, referenceMode));
    } catch (nextError) {
      if (requestId !== comparisonRequestId.current) return;
      setReport(null);
      setError(formatErrorMessage(nextError));
    } finally {
      if (requestId === comparisonRequestId.current) setLoading(false);
    }
  };

  const setReferenceMode = (mode: ReferenceDocumentMode) => {
    setReferenceModeState(mode);
    invalidateComparison();
  };

  return {
    referenceFile,
    candidateFile,
    referenceMode,
    report,
    loading,
    error,
    canCompare: Boolean(referenceFile && candidateFile),
    chooseFile,
    clearFile,
    setReferenceMode,
    runComparison,
  };
}
