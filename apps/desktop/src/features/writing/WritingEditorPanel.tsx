import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp, ChevronRight, Clipboard, History, ImagePlus, Replace, Search, X } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import type { WritingAssistantActionId, WritingEditorSource, WritingImageAsset, WritingTexFile } from "./shared";
import WritingEditorContextMenu from "./WritingEditorContextMenu";
import WritingSourceTabs from "./WritingSourceTabs";
import { findWritingTexFile } from "./texFiles";

interface WritingEditorPanelProps {
  editorRef: RefObject<HTMLTextAreaElement>;
  mainTex: string;
  bibtex: string;
  texFiles: WritingTexFile[];
  imageAssets: WritingImageAsset[];
  activeSource: WritingEditorSource;
  onActiveSourceChange: (source: WritingEditorSource) => void;
  onSourceChange: (source: WritingEditorSource, value: string) => void;
  onCreateTexFile: (path: string) => boolean;
  onRenameTexFile: (path: string, nextPath: string) => boolean;
  onDeleteTexFile: (path: string) => void;
  onInsertText: (before: string, after?: string) => void;
  onInsertImage: () => void;
  onAssistantAction: (actionId: WritingAssistantActionId) => void;
  onOpenVersionHistory?: () => void;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}

export default function WritingEditorPanel({
  editorRef,
  mainTex,
  bibtex,
  texFiles,
  imageAssets,
  activeSource,
  onActiveSourceChange,
  onSourceChange,
  onCreateTexFile,
  onRenameTexFile,
  onDeleteTexFile,
  onInsertText,
  onInsertImage,
  onAssistantAction,
  onOpenVersionHistory,
  sidebarCollapsed,
  onExpandSidebar,
}: WritingEditorPanelProps) {
  const lineNumbersRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const value = activeSource === "main"
    ? mainTex
    : activeSource === "bib"
      ? bibtex
      : findWritingTexFile(texFiles, activeSource)?.content ?? "";
  const lineNumbers = useMemo(() => {
    const count = Math.max(1, value.split("\n").length);
    return Array.from({ length: count }, (_, index) => index + 1).join("\n");
  }, [value]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0 });

  const matches = useMemo(() => {
    if (!searchTerm) return [];
    const results: number[] = [];
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m: RegExpExecArray | null;
    while ((m = regex.exec(value)) !== null) {
      results.push(m.index);
    }
    return results;
  }, [value, searchTerm]);

  const selectMatch = useCallback((index: number) => {
    const el = textareaRef.current;
    if (!el || matches.length === 0) return;
    const pos = matches[index % matches.length];
    const end = pos + searchTerm.length;
    el.focus();
    el.setSelectionRange(pos, end);
    const lineIndex = value.slice(0, pos).split("\n").length - 1;
    const lineHeight = 24;
    el.scrollTop = Math.max(0, (lineIndex - 3) * lineHeight);
    setMatchIndex(index);
  }, [matches, searchTerm, value]);

  const navigateNext = useCallback(() => selectMatch(matchIndex + 1), [selectMatch, matchIndex]);
  const navigatePrev = useCallback(() => selectMatch(matchIndex - 1 + matches.length), [selectMatch, matchIndex, matches.length]);

  const handleReplace = useCallback(() => {
    if (matches.length === 0) return;
    const idx = matchIndex % matches.length;
    const pos = matches[idx];
    const newValue = value.slice(0, pos) + replaceTerm + value.slice(pos + searchTerm.length);
    onSourceChange(activeSource, newValue);
    setMatchIndex(idx);
  }, [matches, matchIndex, searchTerm, replaceTerm, value, activeSource, onSourceChange]);

  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0) return;
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const newValue = value.replaceAll(regex, replaceTerm);
    onSourceChange(activeSource, newValue);
  }, [matches, searchTerm, replaceTerm, value, activeSource, onSourceChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
        setSearchTerm("");
        setReplaceTerm("");
        setShowReplace(false);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    setMatchIndex(0);
  }, [searchTerm]);

  useEffect(() => {
    setContextMenu((current) => ({ ...current, open: false }));
  }, [activeSource]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el && el.value !== value) {
      el.value = value;
    }
  }, [value]);

  const handleChange = useCallback((next: string) => {
    onSourceChange(activeSource, next);
  }, [activeSource, onSourceChange]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLTextAreaElement>) => {
    if (activeSource === "bib") return;
    event.preventDefault();
    event.currentTarget.focus();
    setContextMenu({ open: true, x: event.clientX, y: event.clientY });
  }, [activeSource]);

  const handleContextInsert = useCallback((before: string, after = "") => {
    onInsertText(before, after);
  }, [onInsertText]);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm"
      style={{ background: "var(--rc-card-bg)", borderColor: "var(--rc-border)" }}
    >
      <div
        className="flex h-11 items-center gap-1 border-b px-2"
        style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)" }}
      >
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => onExpandSidebar?.()}
            title="展开侧栏"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-tertiary transition-colors hover:bg-white/5 hover:text-ink-primary"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <WritingSourceTabs
          activeSource={activeSource}
          texFiles={texFiles}
          onActiveSourceChange={onActiveSourceChange}
          onCreateTexFile={onCreateTexFile}
          onRenameTexFile={onRenameTexFile}
          onDeleteTexFile={onDeleteTexFile}
        />
        <div className="ml-auto flex items-center gap-3 px-2">
          {onOpenVersionHistory && (
            <>
              <button
                type="button"
                onClick={onOpenVersionHistory}
                title="历史版本"
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-tertiary transition-colors hover:bg-white/5 hover:text-apple-blue"
              >
                <History className="h-3.5 w-3.5" />
                历史版本
              </button>
              <div className="h-3 w-px bg-white/10" />
            </>
          )}
          <button
            type="button"
            onClick={() => void onInsertImage()}
            title="插入图片"
            className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-tertiary transition-colors hover:bg-white/5 hover:text-apple-blue"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {imageAssets.length > 0 && (
              <span>{`${imageAssets.length} 张图`}</span>
            )}
          </button>
          <div className="h-3 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(value);
            }}
            title="复制源码"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-tertiary transition-colors hover:bg-white/5 hover:text-ink-secondary"
          >
            <Clipboard className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div
          className="flex items-center gap-2 border-b px-3 py-1.5"
          style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)" }}
        >
          <div className="flex items-center gap-1.5 rounded-lg border px-2 py-1" style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-bg)" }}>
            <Search className="h-3.5 w-3.5 text-ink-tertiary" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); navigateNext(); }
              }}
              placeholder="查找…"
              className="w-40 border-0 bg-transparent text-xs text-ink-primary outline-none placeholder:text-ink-tertiary/50"
            />
            {searchTerm && (
              <span className="text-[10px] text-ink-tertiary tabular-nums">
                {matches.length > 0 ? `${matchIndex % matches.length + 1}/${matches.length}` : "0"}
              </span>
            )}
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-ink-tertiary/50 hover:text-ink-tertiary"
              onClick={navigatePrev}
              disabled={matches.length === 0}
              title="上一个"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-ink-tertiary/50 hover:text-ink-tertiary"
              onClick={navigateNext}
              disabled={matches.length === 0}
              title="下一个"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowReplace((v) => !v)}
            className={clsx(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition",
              showReplace ? "bg-apple-blue/10 text-apple-blue" : "text-ink-tertiary hover:text-ink-secondary"
            )}
            title="替换"
          >
            <Replace className="h-3 w-3" />
            替换
          </button>

          {showReplace && (
            <>
              <input
                type="text"
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleReplace(); }
                }}
                placeholder="替换为…"
                className="w-36 rounded-lg border bg-transparent px-2 py-1 text-xs text-ink-primary outline-none"
                style={{ borderColor: "var(--rc-border)" }}
              />
              <button
                type="button"
                onClick={handleReplace}
                disabled={matches.length === 0}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-ink-secondary hover:bg-white/5 disabled:opacity-30"
              >
                替换
              </button>
              <button
                type="button"
                onClick={handleReplaceAll}
                disabled={matches.length === 0}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-ink-secondary hover:bg-white/5 disabled:opacity-30"
              >
                全部替换
              </button>
            </>
          )}

          <button
            type="button"
            className="ml-auto flex h-5 w-5 items-center justify-center rounded text-ink-tertiary/40 hover:text-ink-tertiary"
            onClick={() => { setSearchOpen(false); setSearchTerm(""); setReplaceTerm(""); setShowReplace(false); }}
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="flex w-12 shrink-0 flex-col border-r pt-4 text-right font-mono text-[11px] leading-6 text-ink-tertiary/40 select-none"
          style={{ borderColor: "var(--rc-border)", background: "var(--rc-card-inset-bg)" }}
        >
          <pre
            ref={lineNumbersRef}
            aria-hidden="true"
            className="overflow-hidden px-2"
          >
            {lineNumbers}
          </pre>
        </div>
        <textarea
          ref={(el) => {
            textareaRef.current = el;
            if (editorRef && "current" in editorRef) {
              (editorRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
            }
          }}
          defaultValue={value}
          spellCheck={false}
          onInput={(event) => handleChange(event.currentTarget.value)}
          onScroll={(event) => {
            if (lineNumbersRef.current) {
              lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || activeSource === "bib") return;
            event.preventDefault();
            onInsertText("  ");
          }}
          onContextMenu={handleContextMenu}
          className="rc-selectable min-h-full flex-1 resize-none overflow-auto border-0 bg-transparent px-4 py-4 font-mono text-[13.5px] leading-6 text-ink-primary outline-none"
          style={{ tabSize: 2, caretColor: "var(--rc-accent)" }}
        />
      </div>
      <WritingEditorContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu((current) => ({ ...current, open: false }))}
        onInsert={handleContextInsert}
        onInsertImage={onInsertImage}
        onAssistantAction={onAssistantAction}
      />
    </section>
  );
}
