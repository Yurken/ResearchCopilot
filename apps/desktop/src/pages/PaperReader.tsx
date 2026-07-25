import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "@research-copilot/ui";
import { papersApi } from "../lib/client";
import PdfReaderViewer, { type PdfReaderViewerHandle } from "../features/reader/PdfReaderViewer";
import ReaderTranslationPanel from "../features/reader/ReaderTranslationPanel";
import ReaderSidebar from "../features/reader/ReaderSidebar";
import ReaderToolbar from "../features/reader/ReaderToolbar";
import ReaderZoomControl from "../features/reader/ReaderZoomControl";
import ReaderQaPanel from "../features/reader/ReaderQaPanel";
import ReaderRightRail, { type ReaderRightPanel } from "../features/reader/ReaderRightRail";
import ReaderResearchActionsPanel from "../features/reader/research-actions/ReaderResearchActionsPanel";
import SelectionPopup from "../features/reader/SelectionPopup";
import { useReaderNotes } from "../features/reader/useReaderNotes";
import { useReaderTranslation } from "../features/reader/useReaderTranslation";
import { useSmoothReaderZoom } from "../features/reader/useSmoothReaderZoom";
import { useReaderDocumentNavigation } from "../features/reader/useReaderDocumentNavigation";
import { useReaderProgress } from "../features/reader/useReaderProgress";
import { useReaderQuestionAnswer } from "../features/reader/useReaderQuestionAnswer";
import { useReaderPdf } from "../features/reader/useReaderPdf";
import { useReaderPdfDocument } from "../features/reader/useReaderPdfDocument";
import {
  isShapeStyle,
  isTextStyle,
  type AnnotationStyle,
  type HighlightColor,
  type NormalizedRect,
  type PaperNote,
  type ReaderImageSelection,
  type ReaderMode,
  type ReaderSelection,
} from "../features/reader/readerTypes";
import { useCorpus } from "../features/papers/useCorpus";
import { useResizableWidth } from "../hooks/useResizableWidth";

export default function PaperReader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const viewerRef = useRef<PdfReaderViewerHandle>(null);

  const { paper, pdfData, loadError, loading } = useReaderPdf(id);
  const { pdfDoc, loading: documentLoading, error: documentError } = useReaderPdfDocument(pdfData);
  const readerLoading = loading || documentLoading;
  const readerError = loadError || documentError;
  const { scale, renderScale, zoomByFactor, zoomStep, setScale } = useSmoothReaderZoom(1.4);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [editing, setEditing] = useState<{ note: PaperNote; x: number; y: number } | null>(null);
  const [toast, setToast] = useState("");

  // 可拖拽宽度
  const leftPanel = useResizableWidth({ initialWidth: 256, minWidth: 180, maxWidth: 400 });
  const rightPanelSize = useResizableWidth({ initialWidth: 320, minWidth: 240, maxWidth: 500 });

  // 工具栏状态
  const [leftOpen, setLeftOpen] = useState(true);
  const [mode, setMode] = useState<ReaderMode>("view");
  const [annotateTool, setAnnotateTool] = useState<AnnotationStyle>("highlight");
  const [annotateColor, setAnnotateColor] = useState<HighlightColor>("yellow");
  const [annotateFill, setAnnotateFill] = useState<HighlightColor | null>(null);
  // 翻译栏展开即等于「自动翻译」：展开时划词自动翻译，收起则不翻译。
  const [rightPanel, setRightPanel] = useState<ReaderRightPanel>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { notes, error: notesError, createAnnotation, updateColor, updateFill, updateContent, moveAnnotation, deleteAnnotation, undo } = useReaderNotes(id);
  const translation = useReaderTranslation();
  const corpus = useCorpus(id);
  const navigation = useReaderDocumentNavigation(pdfDoc, searchQuery);
  const readerProgress = useReaderProgress(id);
  const qa = useReaderQuestionAnswer(id, paper?.title ?? "", navigation.pages);

  const flashToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  useEffect(() => {
    setSelection(null);
    setEditing(null);
    setSearchQuery("");
  }, [id]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // Cmd(mac)/Ctrl(win)+Z 撤销最近一次批注；在输入框内则交还给浏览器做文本撤销。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

  // 翻译栏展开时，按 Shift+空格（未在输入框）快速开关「连续翻译」。
  const toggleContinuous = translation.toggleContinuous;
  useEffect(() => {
    if (rightPanel !== "translation") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== "Space" || !event.shiftKey) return;
      const target = document.activeElement as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault(); // 阻止空格滚动 PDF
      toggleContinuous();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rightPanel, toggleContinuous]);

  // 划词处理：文本批注模式直接套用预选工具；翻译栏开启则自动翻译；否则弹出工具菜单。
  const handleTextSelected = useCallback(
    (next: ReaderSelection) => {
      setEditing(null);

      if (rightPanel === "translation" && !translation.locked) {
        void translation.translate(next.text, next.page);
      }

      if (mode === "text-annotation" && !isTextStyle(annotateTool)) {
        void createAnnotation({
          page: next.page,
          highlightText: next.text,
          color: annotateColor,
          style: annotateTool,
          positions: next.positions,
        });
        clearSelection();
        return;
      }

      setSelection(next);
    },
    [rightPanel, mode, annotateColor, annotateTool, translation, createAnnotation, clearSelection],
  );

  const handlePopupsCleared = useCallback(() => {
    setSelection(null);
    setEditing(null);
  }, []);

  const handleNoteClick = useCallback((note: PaperNote, point: { x: number; y: number }) => {
    if (isTextStyle(note.style)) return;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setEditing({ note, x: point.x, y: point.y });
  }, []);

  const handleModeChange = useCallback((nextMode: ReaderMode) => {
    if (nextMode === "text-annotation" && isShapeStyle(annotateTool)) setAnnotateTool("highlight");
    if (nextMode === "shape-annotation" && !isShapeStyle(annotateTool)) setAnnotateTool("rect");
    setMode(nextMode);
  }, [annotateTool]);

  const handleAnnotate = useCallback(
    (color: HighlightColor, style: AnnotationStyle, note?: string) => {
      if (!selection) return;
      void createAnnotation({
        page: selection.page,
        highlightText: selection.text,
        color,
        style,
        positions: selection.positions,
        content: note,
      });
      clearSelection();
    },
    [selection, createAnnotation, clearSelection],
  );

  const handleSaveCorpus = useCallback(
    (note?: string) => {
      if (!selection || !id) return;
      void corpus.addEntry({ paperId: id, text: selection.text, page: selection.page, note });
      clearSelection();
      flashToast("已收入语料库");
    },
    [selection, id, corpus, clearSelection, flashToast],
  );

  const handleTranslate = useCallback(() => {
    if (!selection) return;
    setRightPanel("translation");
    void translation.translate(selection.text, selection.page);
    setSelection(null);
  }, [selection, translation]);

  const handleInterpret = useCallback(() => {
    if (!selection) return;
    setRightPanel("translation");
    translation.interpretText(selection.text);
    setSelection(null);
  }, [selection, translation]);

  // 形状绘制完成：把拖出的框存成形状批注（无原文），带边框色与填充色。
  const handleShapeDrawn = useCallback(
    (page: number, rect: NormalizedRect) => {
      void createAnnotation({
        page,
        highlightText: "",
        color: annotateColor,
        style: annotateTool,
        positions: [rect],
        fillColor: annotateFill,
      });
    },
    [createAnnotation, annotateColor, annotateTool, annotateFill],
  );

  const handleTextDrawn = useCallback(
    (page: number, rect: NormalizedRect, content: string) => {
      void createAnnotation({
        page,
        highlightText: "",
        color: annotateColor,
        style: "text",
        positions: [rect],
        content,
      });
    },
    [createAnnotation, annotateColor],
  );

  const handleAnnotationMove = useCallback(
    (note: PaperNote, rect: NormalizedRect) => void moveAnnotation(note.id, [rect]),
    [moveAnnotation],
  );

  const handleAreaSelected = useCallback(
    (image: ReaderImageSelection) => {
      setRightPanel("translation");
      setSelection(null);
      setEditing(null);
      translation.interpretImage(image);
    },
    [translation],
  );

  const drawShape = mode === "shape-annotation" && isShapeStyle(annotateTool) ? annotateTool : null;
  const drawText = mode === "text-annotation" && isTextStyle(annotateTool);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--rc-surface)" }}>
      <ReaderToolbar
        leftOpen={leftOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onBack={() => navigate("/papers")}
        mode={mode}
        onModeChange={handleModeChange}
        tool={annotateTool}
        onToolChange={setAnnotateTool}
        color={annotateColor}
        onColorChange={setAnnotateColor}
        fill={annotateFill}
        onFillChange={setAnnotateFill}
        onOpenExternal={id ? () => void papersApi.openFile(id) : undefined}
      />

      {notesError ? (
        <div className="shrink-0 bg-apple-red/10 px-4 py-1.5 text-xs text-apple-red">{notesError}</div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <ReaderSidebar
            width={leftPanel.width}
            currentPaperId={id}
            onPaperSelect={(paperId) => navigate(`/papers/${paperId}/reader`)}
            outline={navigation.outline}
            thumbnails={navigation.thumbnails}
            numPages={navigation.numPages}
            navigationLoading={navigation.loading}
            navigationError={navigation.error}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={navigation.searchResults}
            notes={notes}
            progress={readerProgress.progress}
            onPageSelect={(page) => viewerRef.current?.scrollToPage(page)}
            onNoteDelete={(noteId) => void deleteAnnotation(noteId)}
            onDragStart={(event) => leftPanel.onDragStart(event, "right")}
          />
        ) : null}

        <div className="relative min-w-0 flex-1">
          {readerLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-tertiary">正在打开论文…</div>
          ) : readerError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-semibold text-ink-primary">无法阅读</p>
              <p className="max-w-md text-xs leading-5 text-ink-tertiary">{readerError}</p>
              {id ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void papersApi.openFile(id)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  尝试用系统阅读器打开
                </Button>
              ) : null}
            </div>
          ) : pdfDoc ? (
            <PdfReaderViewer
              ref={viewerRef}
              pdfDoc={pdfDoc}
              notes={notes}
              scale={scale}
              renderScale={renderScale}
              readingAreaSelectionEnabled={mode === "view"}
              initialPage={readerProgress.initialPage}
              onProgressChange={readerProgress.recordProgress}
              onTextSelected={handleTextSelected}
              onSelectionCleared={handlePopupsCleared}
              onNoteClick={handleNoteClick}
              onZoom={zoomByFactor}
              onAreaSelected={handleAreaSelected}
              onAreaSelectError={flashToast}
              drawShape={drawShape}
              drawText={drawText}
              drawColor={annotateColor}
              drawFill={annotateFill}
              onShapeDrawn={handleShapeDrawn}
              onTextDrawn={handleTextDrawn}
              onTextUpdate={(note, content) => void updateContent(note.id, content)}
              onTextDelete={(note) => void deleteAnnotation(note.id)}
              onTextColorChange={(note, color) => void updateColor(note.id, color)}
              onAnnotationMove={handleAnnotationMove}
            />
          ) : null}
          {pdfDoc && !readerLoading && !readerError ? (
            <ReaderZoomControl
              scalePercent={Math.round(scale * 100)}
              onZoomIn={() => zoomStep(0.1)}
              onZoomOut={() => zoomStep(-0.1)}
              onScalePercentChange={(percent) => setScale(percent / 100)}
            />
          ) : null}
        </div>

        <ReaderRightRail
          active={rightPanel}
          onSelect={(panel) => setRightPanel((current) => current === panel ? null : panel)}
        />

        {rightPanel === "translation" ? (
          <ReaderTranslationPanel
            current={translation.current}
            interpretation={translation.interpretation}
            locked={translation.locked}
            continuous={translation.continuous}
            fontSize={translation.fontSize}
            translationModel={translation.translationModel}
            availableModels={translation.availableModels}
            loadingModels={translation.loadingModels}
            modelsError={translation.modelsError}
            onToggleLock={translation.toggleLock}
            onToggleContinuous={translation.toggleContinuous}
            onInterpret={translation.interpret}
            onTranslationModelChange={translation.setTranslationModel}
            onEditSource={translation.editSource}
            onClear={translation.clear}
            onCollapse={() => setRightPanel(null)}
            width={rightPanelSize.width}
            onDragStart={(e) => rightPanelSize.onDragStart(e, "left")}
          />
        ) : null}

        {rightPanel === "qa" ? (
          <ReaderQaPanel
            width={rightPanelSize.width}
            currentPage={readerProgress.progress.page}
            messages={qa.messages}
            sending={qa.sending}
            error={qa.error}
            onAsk={(question, page) => void qa.ask(question, page)}
            onClear={qa.clear}
            onCollapse={() => setRightPanel(null)}
            onDragStart={(event) => rightPanelSize.onDragStart(event, "left")}
          />
        ) : null}

        {rightPanel === "research" ? (
          <ReaderResearchActionsPanel
            paper={paper}
            page={readerProgress.progress.page}
            selection={selection?.text}
            pageText={navigation.pages.find((item) => item.page === readerProgress.progress.page)?.text}
            width={rightPanelSize.width}
            onCollapse={() => setRightPanel(null)}
            onDragStart={(event) => rightPanelSize.onDragStart(event, "left")}
          />
        ) : null}
      </div>

      {selection ? (
        <SelectionPopup
          x={selection.popupX}
          y={selection.popupY}
          selectedText={selection.text}
          onAnnotate={handleAnnotate}
          onSaveCorpus={handleSaveCorpus}
          onTranslate={handleTranslate}
          onInterpret={handleInterpret}
          onClose={clearSelection}
        />
      ) : editing ? (
        <SelectionPopup
          key={editing.note.id}
          mode="edit"
          x={editing.x}
          y={editing.y}
          selectedText={editing.note.highlight_text ?? ""}
          initialColor={editing.note.highlight_color}
          isShape={isShapeStyle(editing.note.style)}
          initialFill={editing.note.fill_color}
          noteContent={editing.note.content}
          onRecolor={(color) => void updateColor(editing.note.id, color)}
          onRecolorFill={(fill) => void updateFill(editing.note.id, fill)}
          onUpdateNote={(content) => void updateContent(editing.note.id, content)}
          onDelete={() => {
            void deleteAnnotation(editing.note.id);
            setEditing(null);
          }}
          onTranslate={() => {
            void translation.translate(editing.note.highlight_text ?? "", editing.note.page);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {toast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-lg"
          style={{ background: "rgba(28,28,30,0.92)" }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
