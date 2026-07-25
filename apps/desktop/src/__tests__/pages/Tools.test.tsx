import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "../helpers/render";
import { resetInvokeMock } from "../mocks/tauri";
import Tools from "../../pages/Tools";

// Mock all tool hooks
vi.mock("../../features/tools/useArxivFieldSearch", () => ({
  useArxivFieldSearch: () => ({
    panelProps: { query: "", onQueryChange: vi.fn(), onSubmit: vi.fn() },
    resultProps: { results: [], loading: false, searched: false },
  }),
}));

vi.mock("../../features/tools/usePaperDiscoverySearch", () => ({
  usePaperDiscoverySearch: () => ({
    panelProps: {
      topic: "",
      allTerms: "",
      titleTerms: "",
      abstractTerms: "",
      onSubmit: vi.fn(),
    },
    resultProps: { result: null, appliedFilters: [], searched: false, loading: false, error: "" },
  }),
}));

vi.mock("../../features/tools/useSourceLookup", () => ({
  useSourceLookup: () => ({
    query: "", sections: [], loading: false, error: null, searched: false,
    setQuery: vi.fn(), submit: vi.fn(),
  }),
}));

vi.mock("../../features/tools/useTranslationTool", () => ({
  useTranslationTool: () => ({
    input: "", result: "", loading: false, error: null,
    sourceLang: "en", targetLang: "zh",
    setInput: vi.fn(), setSourceLang: vi.fn(), setTargetLang: vi.fn(), submit: vi.fn(),
  }),
}));

vi.mock("../../features/tools/useMarkdownFormatter", () => ({
  useMarkdownFormatter: () => ({
    input: "", result: "", processing: false, error: null, progress: 0,
    setInput: vi.fn(), submit: vi.fn(), upload: vi.fn(), save: vi.fn(),
  }),
}));

vi.mock("../../features/tools/usePptGenerator", () => ({
  usePptGenerator: () => ({
    featureDisabled: false, mode: "topic", topic: "", outline: "",
    documentName: "", documentLoading: false, documentError: null,
    hasDocumentContent: false, documentCharacterCount: 0,
    styleValue: "academic", customStyle: "", language: "zh", pageCount: "10",
    customPages: "", fileBaseName: "", generateDisabledReason: null,
    pptData: null, status: "idle", slideCount: 0, error: null,
    setMode: vi.fn(), setTopic: vi.fn(), setOutline: vi.fn(),
    setStyleValue: vi.fn(), setCustomStyle: vi.fn(), setLanguage: vi.fn(),
    setPageCount: vi.fn(), setCustomPages: vi.fn(), resetDocument: vi.fn(),
    handleDocumentDrop: vi.fn(), handleDocumentPick: vi.fn(),
    generate: vi.fn(), download: vi.fn(),
  }),
}));

vi.mock("../../features/tools/useFriendLinks", () => ({
  useFriendLinks: () => ({
    panelProps: { links: [], loading: false },
  }),
}));

vi.mock("../../features/tools/useGithubProjectSearch", () => ({
  useGithubProjectSearch: () => ({
    query: "", result: null, loading: false, error: "", searched: false,
    history: [], historyLoading: false,
    setQuery: vi.fn(), submit: vi.fn(), applyHistory: vi.fn(),
    removeHistory: vi.fn(), refreshHistory: vi.fn(),
  }),
}));

// Mock panel components
vi.mock("../../features/tools/ArxivFieldSearchPanel", () => ({
  ArxivFieldSearchPanel: () => <div data-testid="arxiv-field-panel">arXiv 字段检索</div>,
}));
vi.mock("../../features/tools/ArxivSearchResults", () => ({
  ArxivSearchResults: () => <div data-testid="arxiv-results">检索结果</div>,
}));
vi.mock("../../features/tools/PaperDiscoveryPanel", () => ({
  PaperDiscoveryPanel: () => <div data-testid="paper-discovery-panel">论文发现</div>,
}));
vi.mock("../../features/tools/SourceLookupPanel", () => ({
  SourceLookupPanel: () => <div data-testid="source-lookup-panel">刊会查询</div>,
}));
vi.mock("../../features/tools/TranslationPanel", () => ({
  TranslationPanel: () => <div data-testid="translation-panel">翻译面板</div>,
}));
vi.mock("../../features/tools/MarkdownFormatterPanel", () => ({
  MarkdownFormatterPanel: () => <div data-testid="md-formatter-panel">MD 整理</div>,
}));
vi.mock("../../features/tools/PptWorkspace", () => ({
  PptWorkspace: () => <div data-testid="ppt-workspace">PPT 生成</div>,
}));
vi.mock("../../features/tools/FriendLinksPanel", () => ({
  FriendLinksPanel: () => <div data-testid="friend-links-panel">科研友链</div>,
}));
vi.mock("../../features/patent-tool/PatentWorkspace", () => ({
  default: () => <div data-testid="patent-workspace">专利工具</div>,
}));
vi.mock("../../features/document-checker/DocumentCheckerWorkspace", () => ({
  default: () => <div data-testid="document-checker-workspace">文档校验工具</div>,
}));

// Mock CapsuleTabs from @research-copilot/ui
vi.mock("@research-copilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@research-copilot/ui")>();
  return {
    ...actual,
    CapsuleTabs: ({ options, value, onChange }: { options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void }) => (
      <div data-testid="capsule-tabs">
        {options.map((opt) => (
          <button
            key={opt.value}
            data-testid={`tab-${opt.value}`}
            onClick={() => onChange(opt.value)}
            style={{ fontWeight: value === opt.value ? "bold" : "normal" }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    ),
  };
});

describe("Tools 页面", () => {
  beforeEach(() => {
    resetInvokeMock();
    localStorage.clear();
  });

  it("应渲染紧凑工具页签导航", () => {
    render(<Tools />);
    expect(screen.getByTestId("capsule-tabs")).toBeInTheDocument();
  });

  it("应显示所有工具标签", () => {
    render(<Tools />);
    expect(screen.getByText("论文检索")).toBeInTheDocument();
    expect(screen.getByText("刊会查询")).toBeInTheDocument();
    expect(screen.getByText("学术翻译")).toBeInTheDocument();
    expect(screen.getByText("MD 整理")).toBeInTheDocument();
    expect(screen.getByText("生成 PPT")).toBeInTheDocument();
    expect(screen.getByText("专利检索")).toBeInTheDocument();
    expect(screen.getByText("文档校验")).toBeInTheDocument();
    expect(screen.getByText("科研友链")).toBeInTheDocument();
  });

  it("默认应显示论文检索标签", () => {
    render(<Tools />);
    expect(screen.getByTestId("paper-discovery-panel")).toBeInTheDocument();
    expect(screen.getByTestId("arxiv-field-panel")).toBeInTheDocument();
  });

  it("点击刊会查询应切换标签", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("刊会查询"));
    expect(screen.getByTestId("source-lookup-panel")).toBeInTheDocument();
  });

  it("点击学术翻译应切换标签", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("学术翻译"));
    expect(screen.getByTestId("translation-panel")).toBeInTheDocument();
  });

  it("点击 MD 整理应切换标签", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("MD 整理"));
    expect(screen.getByTestId("md-formatter-panel")).toBeInTheDocument();
  });

  it("点击生成 PPT 应切换标签", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("生成 PPT"));
    expect(screen.getByTestId("ppt-workspace")).toBeInTheDocument();
  });

  it("点击科研友链应切换标签", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("科研友链"));
    expect(screen.getByTestId("friend-links-panel")).toBeInTheDocument();
  });

  it("点击专利检索应切换到专利工具", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("专利检索"));
    expect(screen.getByTestId("patent-workspace")).toBeInTheDocument();
  });

  it("点击文档校验应切换到校验工具", () => {
    render(<Tools />);
    fireEvent.click(screen.getByText("文档校验"));
    expect(screen.getByTestId("document-checker-workspace")).toBeInTheDocument();
  });
});
