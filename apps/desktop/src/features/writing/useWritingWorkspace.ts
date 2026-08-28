import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PROJECT_NAME,
  type WritingCreateDraftOptions,
  type WritingEditorSource,
  type WritingImageAsset,
  type WritingTexFile,
  type WritingTemplateId,
  type WritingViewMode,
} from "./shared";
import { analyzeLatex, buildLatexPreviewBlocks, extractLatexOutline, getLatexStats } from "./latexAnalysis";
import { buildLatexImageFigureInsert } from "./latexProject";
import { useWritingCompiler } from "./useWritingCompiler";
import { useWritingDraftLibrary } from "./useWritingDraftLibrary";
import { useWritingFileActions } from "./useWritingFileActions";
import { useWritingVersions } from "./useWritingVersions";
import { WRITING_TEMPLATES, getDefaultWritingTemplate, getWritingTemplate } from "./templates";
import {
  findWritingTexFile,
  normalizeWritingTexFilePath,
  writingTexFilePathFromSource,
  writingTexFileSource,
  resolveWritingProjectSource,
} from "./texFiles";

interface InsertOptions {
  selectInserted?: boolean;
}

export function useWritingWorkspace() {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    drafts,
    activeDraft,
    activeDraftId,
    interests,
    loadingInterests,
    interestError,
    lastSavedAt,
    libraryReady,
    setActiveDraftId,
    updateActiveDraft,
    createDraft: createLibraryDraft,
    deleteDraft: deleteLibraryDraft,
  } = useWritingDraftLibrary();
  const projectName = activeDraft.projectName;
  const templateId = activeDraft.templateId;
  const mainTex = activeDraft.mainTex;
  const bibtex = activeDraft.bibtex;
  const texFiles = activeDraft.texFiles;
  const notes = activeDraft.notes;
  const imageAssets = activeDraft.imageAssets;
  const [viewMode, setViewMode] = useState<WritingViewMode>("split");
  const [activeSource, setActiveSource] = useState<WritingEditorSource>("main");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const outline = useMemo(() => extractLatexOutline(mainTex), [mainTex]);
  const stats = useMemo(() => getLatexStats(mainTex), [mainTex]);
  const diagnostics = useMemo(() => analyzeLatex(mainTex, bibtex), [bibtex, mainTex]);
  const previewSource = useMemo(() => resolveWritingProjectSource(mainTex, texFiles), [mainTex, texFiles]);
  const previewBlocks = useMemo(() => buildLatexPreviewBlocks(previewSource), [previewSource]);
  const currentTemplate = useMemo(() => getWritingTemplate(templateId), [templateId]);

  useEffect(() => {
    setActiveSource("main");
  }, [activeDraftId]);

  const clearStatus = useCallback(() => {
    setError("");
    setMessage("");
  }, []);
  const showMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
    setError("");
  }, []);
  const showError = useCallback((nextError: string) => {
    setError(nextError);
  }, []);
  const versionHistory = useWritingVersions({
    // 草稿库未就绪时 activeDraft 是内存占位草稿，不触发任何版本记录。
    draftId: libraryReady ? activeDraft.id : "",
    mainTex,
    bibtex,
    texFiles,
    notes,
    onApplyVersion: updateActiveDraft,
  });
  const compiler = useWritingCompiler({
    draftId: activeDraft.id,
    projectName,
    mainTex,
    bibtex,
    texFiles,
    notes,
    imageAssets,
    onMessage: showMessage,
    onError: showError,
    clearStatus,
  });

  const setProjectName = useCallback((value: string) => {
    updateActiveDraft({ projectName: value });
  }, [updateActiveDraft]);

  const setMainTex = useCallback((value: string) => {
    updateActiveDraft({ mainTex: value });
  }, [updateActiveDraft]);

  const setBibtex = useCallback((value: string) => {
    updateActiveDraft({ bibtex: value });
  }, [updateActiveDraft]);

  const setTexFiles = useCallback((value: WritingTexFile[]) => {
    updateActiveDraft({ texFiles: value });
  }, [updateActiveDraft]);

  const setTexFileContent = useCallback((path: string, content: string) => {
    setTexFiles(texFiles.map((file) => (file.path === path ? { ...file, content } : file)));
  }, [setTexFiles, texFiles]);

  const createTexFile = useCallback((rawPath: string) => {
    const path = normalizeWritingTexFilePath(rawPath);
    if (!path) {
      showError("章节文件路径无效。请使用相对 .tex 路径，例如 sections/introduction.tex。");
      return false;
    }
    if (texFiles.some((file) => file.path === path)) {
      setActiveSource(writingTexFileSource(path));
      showError(`章节文件已存在：${path}`);
      return false;
    }
    setTexFiles([...texFiles, { path, content: `% ${path}\n` }]);
    setActiveSource(writingTexFileSource(path));
    showMessage(`已新建章节文件：${path}`);
    return true;
  }, [setTexFiles, showError, showMessage, texFiles]);

  const renameTexFile = useCallback((currentPath: string, rawNextPath: string) => {
    const nextPath = normalizeWritingTexFilePath(rawNextPath);
    if (!nextPath) {
      showError("章节文件路径无效。请使用相对 .tex 路径，例如 sections/introduction.tex。");
      return false;
    }
    if (!texFiles.some((file) => file.path === currentPath)) {
      showError("章节文件不存在，无法重命名。");
      return false;
    }
    if (nextPath !== currentPath && texFiles.some((file) => file.path === nextPath)) {
      showError(`章节文件已存在：${nextPath}`);
      return false;
    }

    setTexFiles(texFiles.map((file) => (file.path === currentPath ? { ...file, path: nextPath } : file)));
    if (writingTexFilePathFromSource(activeSource) === currentPath) {
      setActiveSource(writingTexFileSource(nextPath));
    }
    showMessage(`已重命名章节文件：${nextPath}`);
    return true;
  }, [activeSource, setTexFiles, showError, showMessage, texFiles]);

  const deleteTexFile = useCallback((path: string) => {
    const nextFiles = texFiles.filter((file) => file.path !== path);
    if (nextFiles.length === texFiles.length) return;
    setTexFiles(nextFiles);
    if (writingTexFilePathFromSource(activeSource) === path) {
      setActiveSource("main");
    }
    showMessage(`已移除章节文件：${path}`);
  }, [activeSource, setTexFiles, showMessage, texFiles]);

  const setNotes = useCallback((value: string) => {
    updateActiveDraft({ notes: value });
  }, [updateActiveDraft]);

  const setImageAssets = useCallback((value: WritingImageAsset[]) => {
    updateActiveDraft({ imageAssets: value });
  }, [updateActiveDraft]);

  const setResearchInterestId = useCallback((value: string) => {
    updateActiveDraft({ researchInterestId: value || undefined });
  }, [updateActiveDraft]);

  const fileActions = useWritingFileActions({
    draftId: activeDraft.id,
    projectName,
    mainTex,
    bibtex,
    texFiles,
    notes,
    imageAssets,
    setMainTex,
    setBibtex,
    setTexFiles,
    setImageAssets,
    setActiveSource,
    onMessage: showMessage,
    onError: showError,
    clearStatus,
  });

  const activeSourceContent = activeSource === "main"
    ? mainTex
    : activeSource === "bib"
      ? bibtex
      : findWritingTexFile(texFiles, activeSource)?.content ?? "";

  const updateSourceContent = useCallback((source: WritingEditorSource, value: string) => {
    if (source === "main") {
      setMainTex(value);
      return;
    }
    if (source === "bib") {
      setBibtex(value);
      return;
    }
    const path = writingTexFilePathFromSource(source);
    if (path) setTexFileContent(path, value);
  }, [setBibtex, setMainTex, setTexFileContent]);

  const insertText = useCallback((before: string, after = "", options: InsertOptions = {}) => {
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? activeSourceContent.length;
    const end = editor?.selectionEnd ?? activeSourceContent.length;
    const selected = activeSourceContent.slice(start, end);
    const nextValue = `${activeSourceContent.slice(0, start)}${before}${selected}${after}${activeSourceContent.slice(end)}`;
    const cursorStart = start + before.length;
    const cursorEnd = options.selectInserted ? cursorStart + selected.length : cursorStart + selected.length;

    if (editor) {
      editor.value = nextValue;
    }
    updateSourceContent(activeSource, nextValue);
    window.requestAnimationFrame(() => {
      const currentEditor = editorRef.current;
      currentEditor?.focus();
      currentEditor?.setSelectionRange(cursorEnd, cursorEnd);
    });
  }, [activeSource, activeSourceContent, updateSourceContent]);

  const insertImage = useCallback(async () => {
    const asset = await fileActions.importImage();
    if (!asset) return;
    const snippet = buildLatexImageFigureInsert(asset);
    insertText(snippet.before, snippet.after);
  }, [fileActions, insertText]);

  const getSelectedText = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || editor.selectionStart === editor.selectionEnd) return "";
    return activeSourceContent.slice(editor.selectionStart, editor.selectionEnd);
  }, [activeSourceContent]);

  const insertGeneratedText = useCallback((text: string) => {
    if (!text.trim()) return;
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? activeSourceContent.length;
    const end = editor?.selectionEnd ?? activeSourceContent.length;
    const nextValue = `${activeSourceContent.slice(0, start)}${text}${activeSourceContent.slice(end)}`;
    const cursor = start + text.length;

    if (editor) {
      editor.value = nextValue;
    }
    updateSourceContent(activeSource, nextValue);
    window.requestAnimationFrame(() => {
      const currentEditor = editorRef.current;
      currentEditor?.focus();
      currentEditor?.setSelectionRange(cursor, cursor);
    });
  }, [activeSource, activeSourceContent, updateSourceContent]);

  const jumpToLine = useCallback((line: number) => {
    setActiveSource("main");
    const performJump = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const index = getLineStartIndex(mainTex, line);
      const end = Math.min(index + 1, mainTex.length);
      editor.focus();
      editor.setSelectionRange(index, end);
      setTimeout(() => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return;
        currentEditor.setSelectionRange(index, index);
        const lineHeight = 24;
        currentEditor.scrollTop = Math.max(0, (line - 3) * lineHeight);
      }, 100);
    };

    if (activeSource === "main") {
      performJump();
    } else {
      window.setTimeout(performJump, 50);
    }
  }, [mainTex, activeSource]);

  const applyTemplate = useCallback((nextTemplateId: WritingTemplateId) => {
    const template = getWritingTemplate(nextTemplateId);
    updateActiveDraft({
      templateId: nextTemplateId,
      mainTex: template.mainTex,
      bibtex: template.bibtex,
      texFiles: [],
    });
    setMessage(`已套用「${template.title}」模板`);
    setError("");
  }, [updateActiveDraft]);

  const resetWorkspace = useCallback(() => {
    const template = getDefaultWritingTemplate();
    updateActiveDraft({
      projectName: DEFAULT_PROJECT_NAME,
      templateId: template.id,
      mainTex: template.mainTex,
      bibtex: template.bibtex,
      texFiles: [],
      notes: "",
    });
    setMessage("已重置为默认论文草稿");
    setError("");
  }, [updateActiveDraft]);

  const createDraft = useCallback((options: WritingCreateDraftOptions = {}) => {
    const draft = createLibraryDraft(options);
    setMessage(`已新建文稿「${draft.projectName}」`);
    setError("");
  }, [createLibraryDraft]);

  const deleteDraft = useCallback((id: string) => {
    // 历史版本由后端随草稿删除级联清理，无需单独调用。
    const deleted = deleteLibraryDraft(id);
    if (deleted) {
      setMessage("已删除文稿");
      setError("");
    } else {
      setError("至少保留一篇文稿。");
    }
  }, [deleteLibraryDraft]);

  return {
    drafts,
    activeDraftId,
    interests,
    loadingInterests,
    interestError,
    projectName,
    researchInterestId: activeDraft.researchInterestId ?? "",
    templateId,
    currentTemplate,
    mainTex,
    bibtex,
    texFiles,
    notes,
    imageAssets,
    viewMode,
    activeSource,
    exportingTarget: fileActions.exportingTarget,
    compileStatus: compiler.compileStatus,
    compileResult: compiler.compileResult,
    latexInstallerStatus: compiler.latexInstallerStatus,
    message,
    error,
    lastSavedAt,
    versionHistory,
    outline,
    stats,
    diagnostics,
    previewBlocks,
    templates: WRITING_TEMPLATES,
    editorRef: editorRef as RefObject<HTMLTextAreaElement>,
    setProjectName,
    setResearchInterestId,
    setMainTex,
    setBibtex,
    setTexFiles,
    setTexFileContent,
    updateSourceContent,
    setNotes,
    setViewMode,
    setActiveSource,
    setActiveDraftId,
    createDraft,
    deleteDraft,
    createTexFile,
    renameTexFile,
    deleteTexFile,
    insertText,
    insertImage,
    getSelectedText,
    insertGeneratedText,
    jumpToLine,
    applyTemplate,
    resetWorkspace,
    importTexFile: fileActions.importTexFile,
    importTexProject: fileActions.importTexProject,
    importBibFile: fileActions.importBibFile,
    copyMainTex: fileActions.copyMainTex,
    exportProject: fileActions.exportProject,
    compilePdf: compiler.compilePdf,
    openLatexInstaller: compiler.openLatexInstaller,
    openLatexDownloadPage: compiler.openLatexDownloadPage,
    openCompiledPdf: compiler.openCompiledPdf,
    saveCompiledPdf: compiler.saveCompiledPdf,
  };
}

function getLineStartIndex(source: string, line: number): number {
  if (line <= 1) return 0;
  let currentLine = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n") continue;
    currentLine += 1;
    if (currentLine === line) return index + 1;
  }
  return source.length;
}
