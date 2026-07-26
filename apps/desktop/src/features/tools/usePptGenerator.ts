import { useEffect, useRef, useState } from "react";
import { generatePptArtifact, type PptGenerationRequest, type PptGenerationStage } from "./pptService";
import { apiClient, formatErrorMessage } from "../../lib/client";
import { parsePptPageCount, type PptData, type PptMode, type PptStatus } from "./pptShared";

function isGeneratingStatus(status: PptStatus) {
  return status === "drafting" || status === "repairing" || status === "building";
}

const STAGE_TO_STATUS: Record<PptGenerationStage, PptStatus | null> = {
  parsing: "drafting",
  planning: "drafting",
  drafting: "drafting",
  repairing: "repairing",
  building: "building",
  saving: "building",
  completed: "ready",
};

export function usePptGenerator() {
  const [mode, setMode] = useState<PptMode>("topic");
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState("");
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<string | null>(null);
  const [styleValue, setStyleValue] = useState("auto");
  const [customStyle, setCustomStyle] = useState("");
  const [language, setLanguage] = useState("auto");
  const [pageCount, setPageCount] = useState("auto");
  const [customPages, setCustomPages] = useState("");
  const [status, setStatus] = useState<PptStatus>("idle");
  const [slideCount, setSlideCount] = useState(0);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [pptData, setPptData] = useState<PptData | null>(null);
  const [error, setError] = useState("");
  const [skillEnabled, setSkillEnabled] = useState<boolean | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [documentLoading, setDocumentLoading] = useState(false);
  const [fileBaseName, setFileBaseName] = useState("slides");
  const runIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const documentRunIdRef = useRef(0);
  const prevInputKeyRef = useRef("");

  useEffect(() => {
    apiClient.skills.list().then((skills) => {
      const skill = skills.find((item) => item.name === "ppt-generate");
      setSkillEnabled(skill?.is_enabled !== false);
    }).catch(() => setSkillEnabled(false));
  }, []);

  const featureDisabled = skillEnabled === false;

  useEffect(() => {
    const inputKey = JSON.stringify([
      mode,
      topic,
      outline,
      documentContent,
      documentName,
      styleValue,
      customStyle,
      language,
      pageCount,
      customPages,
    ]);
    if (inputKey === prevInputKeyRef.current) return;
    prevInputKeyRef.current = inputKey;

    if (isGeneratingStatus(status)) {
      runIdRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setStatus("idle");
      setBuffer(null);
      setPptData(null);
      setSlideCount(0);
      setError("");
      return;
    }

    if (status !== "ready" && status !== "error") return;
    setStatus("idle");
    setBuffer(null);
    setPptData(null);
    setSlideCount(0);
    setError("");
  }, [
    customPages,
    customStyle,
    documentContent,
    documentName,
    language,
    mode,
    outline,
    pageCount,
    status,
    styleValue,
    topic,
  ]);

  const resetDocument = () => {
    documentRunIdRef.current += 1;
    setDocumentName(null);
    setDocumentContent(null);
    setDocumentError("");
    setDocumentLoading(false);
  };

  const loadDocument = async (name: string, loader: () => Promise<string>) => {
    const documentRunId = ++documentRunIdRef.current;
    setDocumentName(name);
    setDocumentLoading(true);
    setDocumentContent(null);
    setDocumentError("");
    try {
      const text = await loader();
      if (documentRunId !== documentRunIdRef.current) return;
      setDocumentContent(text);
    } catch (err) {
      if (documentRunId !== documentRunIdRef.current) return;
      setDocumentContent(null);
      setDocumentError(formatErrorMessage(err));
    } finally {
      if (documentRunId === documentRunIdRef.current) {
        setDocumentLoading(false);
      }
    }
  };

  const handleDocumentDrop = async (file: File) => {
    const droppedFile = file as File & { path?: string };
    if (file.name.toLowerCase().endsWith(".pdf")) {
      if (!droppedFile.path) {
        setDocumentName(file.name);
        setDocumentContent(null);
        setDocumentError("拖拽的 PDF 无法获取本地路径，请使用“本地文件”按钮选择 PDF。");
        setDocumentLoading(false);
        return;
      }
      await loadDocument(file.name, () => apiClient.papers.extractPdfText(droppedFile.path as string));
      return;
    }

    await loadDocument(file.name, () => file.text());
  };

  const handleDocumentPick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      filters: [{ name: "文档", extensions: ["pdf", "txt", "md"] }],
      multiple: false,
    });
    if (typeof path !== "string") return;

    const name = path.split("/").pop() ?? path;
    if (name.toLowerCase().endsWith(".pdf")) {
      await loadDocument(name, () => apiClient.papers.extractPdfText(path));
      return;
    }

    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    await loadDocument(name, () => readTextFile(path));
  };

  const customPageInvalid = pageCount === "custom" && parsePptPageCount(customPages) === null;
  const documentCharacterCount = documentContent?.length ?? 0;
  const generating = isGeneratingStatus(status);
  const generateDisabledReason = featureDisabled
    ? "请先在技能库中启用 PPT 生成功能。"
    : generating
      ? "当前正在生成，请等待完成。"
      : mode === "topic" && !topic.trim()
        ? "先输入演示主题。"
        : mode === "outline" && !outline.trim()
          ? "先粘贴汇报大纲。"
          : mode === "document" && documentLoading
            ? "文档仍在读取中。"
            : mode === "document" && !documentContent
              ? "先导入一份文档内容。"
              : Boolean(documentError)
                ? "请先修复文档读取错误。"
                : styleValue === "custom" && !customStyle.trim()
                  ? "先填写自定义风格描述。"
                  : customPageInvalid
                    ? "页数需填写 4 到 40 之间的整数。"
                    : "";

  const generate = async () => {
    if (generateDisabledReason) return;

    const runId = ++runIdRef.current;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setStatus("drafting");
    setBuffer(null);
    setPptData(null);
    setSlideCount(0);
    setError("");

    const request: PptGenerationRequest = {
      mode,
      topic,
      outline,
      documentName: documentName ?? undefined,
      documentContent: documentContent ?? undefined,
      style: styleValue === "custom" ? customStyle : styleValue,
      language,
      pageCount: pageCount === "custom" ? parsePptPageCount(customPages) ?? undefined : parsePptPageCount(pageCount) ?? undefined,
    };

    try {
      const result = await generatePptArtifact(request, {
        signal: abortController.signal,
        onProgress: (progress) => {
          if (runId !== runIdRef.current) return;
          const nextStatus = STAGE_TO_STATUS[progress.stage];
          if (nextStatus) setStatus(nextStatus);
        },
      });

      if (runId !== runIdRef.current) return;
      setSlideCount(result.slideCount);
      setBuffer(result.buffer);
      setPptData(result.data);
      setFileBaseName(result.fileBaseName);
      setStatus("ready");
    } catch (err) {
      if (runId !== runIdRef.current) return;
      if ((err as Error)?.name === "AbortError") {
        setError("生成已取消。");
      } else {
        setError(formatErrorMessage(err));
      }
      setStatus("error");
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  };

  const download = async () => {
    if (!buffer) {
      setError("文件数据为空，请重新生成。");
      return;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
        defaultPath: `${fileBaseName}.pptx`,
      });
      if (path) {
        await writeFile(path, new Uint8Array(buffer));
      }
    } catch (err) {
      setError(formatErrorMessage(err));
    }
  };

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    featureDisabled,
    mode,
    topic,
    outline,
    documentName,
    documentLoading,
    documentError,
    hasDocumentContent: Boolean(documentContent),
    styleValue,
    customStyle,
    language,
    pageCount,
    customPages,
    fileBaseName,
    documentCharacterCount,
    generateDisabledReason,
    pptData,
    status,
    slideCount,
    error,
    setMode,
    setTopic,
    setOutline,
    setStyleValue,
    setCustomStyle,
    setLanguage,
    setPageCount,
    setCustomPages,
    resetDocument,
    handleDocumentDrop,
    handleDocumentPick,
    generate,
    download,
  };
}
