import { useEffect } from "react";
import { FileCheck2, FileText, FileSearch, Github, Globe2, Languages, Presentation, Scale, Sparkles } from "lucide-react";
import { usePersistentStringState } from "../hooks/usePersistentStringState";
import { ArxivFieldSearchPanel } from "../features/tools/ArxivFieldSearchPanel";
import { ArxivSearchResults } from "../features/tools/ArxivSearchResults";
import { FriendLinksPanel } from "../features/tools/FriendLinksPanel";
import { PaperDiscoveryPanel } from "../features/tools/PaperDiscoveryPanel";
import { MarkdownFormatterPanel } from "../features/tools/MarkdownFormatterPanel";
import { CapsuleTabs } from "@research-copilot/ui";
import { PptWorkspace } from "../features/tools/PptWorkspace";
import { SourceLookupPanel } from "../features/tools/SourceLookupPanel";
import { useArxivFieldSearch } from "../features/tools/useArxivFieldSearch";
import { useFriendLinks } from "../features/tools/useFriendLinks";
import { useMarkdownFormatter } from "../features/tools/useMarkdownFormatter";
import { usePaperDiscoverySearch } from "../features/tools/usePaperDiscoverySearch";
import { usePptGenerator } from "../features/tools/usePptGenerator";
import { useSourceLookup } from "../features/tools/useSourceLookup";
import { useGithubProjectSearch } from "../features/tools/useGithubProjectSearch";
import { GithubProjectSearchPanel } from "../features/tools/GithubProjectSearchPanel";
import { useTranslationTool } from "../features/tools/useTranslationTool";
import { TranslationPanel } from "../features/tools/TranslationPanel";
import PatentWorkspace from "../features/patent-tool/PatentWorkspace";
import DocumentCheckerWorkspace from "../features/document-checker/DocumentCheckerWorkspace";
import { useModuleVisibility } from "../features/module-visibility/useModuleVisibility";
import type { ToolModuleKey } from "../features/module-visibility/shared";

const TOOL_TABS = [
  { key: "arxiv", icon: <Sparkles className="h-4 w-4" />, label: "论文检索" },
  { key: "github", icon: <Github className="h-4 w-4" />, label: "GitHub 项目" },
  { key: "source", icon: <FileSearch className="h-4 w-4" />, label: "刊会查询" },
  { key: "translate", icon: <Languages className="h-4 w-4" />, label: "学术翻译" },
  { key: "md", icon: <FileText className="h-4 w-4" />, label: "MD 整理" },
  { key: "ppt", icon: <Presentation className="h-4 w-4" />, label: "生成 PPT" },
  { key: "patent", icon: <Scale className="h-4 w-4" />, label: "专利检索" },
  { key: "document-check", icon: <FileCheck2 className="h-4 w-4" />, label: "文档校验" },
  { key: "links", icon: <Globe2 className="h-4 w-4" />, label: "科研友链" },
] as const satisfies ReadonlyArray<{ key: ToolModuleKey; icon: React.ReactNode; label: string }>;

type ToolTabKey = (typeof TOOL_TABS)[number]["key"];
const TOOL_TAB_KEYS = TOOL_TABS.map((tab) => tab.key);

export default function Tools() {
  const { config: moduleVisibility } = useModuleVisibility();
  const visibleToolTabs = TOOL_TABS.filter((tab) => moduleVisibility.tools[tab.key]);
  const {
    query: sourceQuery,
    sections: sourceSections,
    loading: sourceLoading,
    error: sourceError,
    searched: sourceSearched,
    setQuery: setSourceQuery,
    submit: handleSourceLookup,
  } = useSourceLookup();
  const paperDiscovery = usePaperDiscoverySearch();
  const arxivFieldSearch = useArxivFieldSearch();
  const githubProjectSearch = useGithubProjectSearch();
  const friendLinks = useFriendLinks();
  const [activeTab, setActiveTab] = usePersistentStringState<ToolTabKey>(
    "rc:tools:active-tab",
    "arxiv",
    TOOL_TAB_KEYS,
  );

  useEffect(() => {
    if (!moduleVisibility.tools[activeTab]) setActiveTab(visibleToolTabs[0]?.key ?? "arxiv");
  }, [activeTab, moduleVisibility.tools, setActiveTab, visibleToolTabs]);

  const {
    input: mdInput,
    result: mdResult,
    processing: mdProcessing,
    error: mdError,
    progress: mdProgress,
    setInput: setMdInput,
    submit: handleMdFormat,
    upload: handleMdUpload,
    save: handleMdSave,
  } = useMarkdownFormatter();
  const {
    input: translateInput,
    result: translateResult,
    loading: translateLoading,
    error: translateError,
    sourceLang: translateSourceLang,
    targetLang: translateTargetLang,
    setInput: setTranslateInput,
    setSourceLang: setTranslateSourceLang,
    setTargetLang: setTranslateTargetLang,
    submit: handleTranslate,
  } = useTranslationTool();
  const {
    featureDisabled: pptFeatureDisabled,
    mode: pptMode,
    topic: pptTopic,
    outline: pptOutline,
    documentName: pptDocName,
    documentLoading: pptDocLoading,
    documentError: pptDocError,
    hasDocumentContent: pptHasDocumentContent,
    documentCharacterCount: pptDocumentCharacterCount,
    styleValue: pptStyle,
    customStyle: pptCustomStyle,
    language: pptLang,
    pageCount: pptPages,
    customPages: pptCustomPages,
    fileBaseName: pptFileBaseName,
    generateDisabledReason: pptGenerateDisabledReason,
    pptData,
    status: pptStatus,
    slideCount: pptSlideCount,
    error: pptError,
    setMode: setPptMode,
    setTopic: setPptTopic,
    setOutline: setPptOutline,
    setStyleValue: setPptStyle,
    setCustomStyle: setPptCustomStyle,
    setLanguage: setPptLang,
    setPageCount: setPptPages,
    setCustomPages: setPptCustomPages,
    resetDocument: resetPptDocument,
    handleDocumentDrop: handlePptDocumentDrop,
    handleDocumentPick: handlePptDocumentPick,
    generate: handlePptGenerate,
    download: handlePptDownload,
  } = usePptGenerator();

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--rc-surface)" }}>
      <div className="app-header shrink-0 px-6 pb-3">
        {/* <div className="mb-3">
          <h1 className="text-lg font-semibold text-ink-primary">实用工具</h1>
          <p className="mt-1 text-xs text-ink-tertiary">小妍为你准备了一些科研实用工具，可在设置的界面布局中按研究方向精简页签。</p>
        </div> */}
        <div className="overflow-x-auto pb-1">
          <CapsuleTabs
            options={visibleToolTabs.map((t) => ({ value: t.key, label: t.label, icon: t.icon }))}
            value={activeTab}
            onChange={(v) => setActiveTab(v as ToolTabKey)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-3 pb-6 space-y-5">

      {activeTab === "arxiv" && <>
      <PaperDiscoveryPanel {...paperDiscovery.panelProps} />

      <ArxivSearchResults
        {...paperDiscovery.resultProps}
        expressionLabel="本次查询表达式"
        emptyMatchHint="建议精简自然语言需求、补充关键词，或放宽标题词、摘要词和领域标签条件。"
        emptySearchHint="检查检索字段和截止日期后重试。"
        detailActionLabel="详情"
        detailActionTitle="打开论文详情页"
        pdfActionLabel="PDF"
        pdfActionTitle="打开论文 PDF"
      />

      <ArxivFieldSearchPanel {...arxivFieldSearch.panelProps} />

      <ArxivSearchResults
        {...arxivFieldSearch.resultProps}
        expressionLabel="官方 arXiv 查询式"
        emptyMatchHint="建议增加最近天数，或放宽标题词、摘要词和分类条件。"
        emptySearchHint="检查检索字段和时间窗口后重试。"
        detailActionLabel="abs"
        detailActionTitle="打开 arXiv 摘要页"
        pdfActionLabel="pdf"
        pdfActionTitle="打开 arXiv PDF"
      />
      </>}

      {activeTab === "github" ? (
        <GithubProjectSearchPanel
          query={githubProjectSearch.query}
          result={githubProjectSearch.result}
          loading={githubProjectSearch.loading}
          error={githubProjectSearch.error}
          searched={githubProjectSearch.searched}
          history={githubProjectSearch.history}
          historyLoading={githubProjectSearch.historyLoading}
          onQueryChange={githubProjectSearch.setQuery}
          onSubmit={githubProjectSearch.submit}
          onApplyHistory={githubProjectSearch.applyHistory}
          onRemoveHistory={githubProjectSearch.removeHistory}
        />
      ) : null}

      {activeTab === "source" ? (
        <SourceLookupPanel
          query={sourceQuery}
          sections={sourceSections}
          loading={sourceLoading}
          error={sourceError}
          searched={sourceSearched}
          onQueryChange={setSourceQuery}
          onSubmit={handleSourceLookup}
        />
      ) : null}

      {activeTab === "translate" ? (
        <TranslationPanel
          input={translateInput}
          result={translateResult}
          loading={translateLoading}
          error={translateError}
          sourceLang={translateSourceLang}
          targetLang={translateTargetLang}
          onInputChange={setTranslateInput}
          onSourceLangChange={setTranslateSourceLang}
          onTargetLangChange={setTranslateTargetLang}
          onSubmit={handleTranslate}
        />
      ) : null}

      {activeTab === "md" ? (
        <MarkdownFormatterPanel
          input={mdInput}
          result={mdResult}
          processing={mdProcessing}
          error={mdError}
          progress={mdProgress}
          onInputChange={setMdInput}
          onUpload={handleMdUpload}
          onSubmit={handleMdFormat}
          onSave={handleMdSave}
        />
      ) : null}

      {activeTab === "ppt" ? (
        <PptWorkspace
          featureDisabled={pptFeatureDisabled}
          mode={pptMode}
          topic={pptTopic}
          outline={pptOutline}
          documentName={pptDocName}
          documentLoading={pptDocLoading}
          documentError={pptDocError}
          hasDocumentContent={pptHasDocumentContent}
          documentCharacterCount={pptDocumentCharacterCount}
          styleValue={pptStyle}
          customStyle={pptCustomStyle}
          language={pptLang}
          pageCount={pptPages}
          customPages={pptCustomPages}
          fileBaseName={pptFileBaseName}
          generateDisabledReason={pptGenerateDisabledReason}
          resultData={pptData}
          status={pptStatus}
          slideCount={pptSlideCount}
          error={pptError}
          onModeChange={setPptMode}
          onTopicChange={setPptTopic}
          onOutlineChange={setPptOutline}
          onDocumentDrop={handlePptDocumentDrop}
          onPickDocument={handlePptDocumentPick}
          onResetDocument={resetPptDocument}
          onStyleChange={setPptStyle}
          onCustomStyleChange={setPptCustomStyle}
          onLanguageChange={setPptLang}
          onPageCountChange={setPptPages}
          onCustomPagesChange={setPptCustomPages}
          onGenerate={handlePptGenerate}
          onDownload={handlePptDownload}
        />
      ) : null}

      {activeTab === "patent" ? <PatentWorkspace /> : null}

      {activeTab === "document-check" ? <DocumentCheckerWorkspace /> : null}

      {activeTab === "links" ? (
        <FriendLinksPanel {...friendLinks.panelProps} />
      ) : null}

      </div>
    </div>
  );
}
