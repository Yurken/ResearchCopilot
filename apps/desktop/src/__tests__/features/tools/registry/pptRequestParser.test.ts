import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePptRequest } from "../../../../features/tools/registry/ppt/pptRequestParser";

const { mockStream } = vi.hoisted(() => ({
  mockStream: vi.fn(),
}));

vi.mock("../../../../lib/client", () => ({
  apiClient: {
    chat: { stream: mockStream },
  },
  formatErrorMessage: (err: unknown) => String(err ?? ""),
}));

function createStream(chunks: string[]): AsyncIterableIterator<{ type: "delta"; value: string }> {
  let index = 0;
  return {
    next: async () => {
      if (index < chunks.length) {
        return { value: { type: "delta" as const, value: chunks[index++] }, done: false };
      }
      return { value: undefined, done: true };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

describe("parsePptRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("解析主题模式请求", async () => {
    mockStream.mockReturnValue(
      createStream(['{"mode":"topic","topic":"Graph RAG 研究综述","pageCount":12,"language":"zh","style":"学术汇报"}']),
    );
    const result = await parsePptRequest("生成一份关于 Graph RAG 的 12 页学术汇报 PPT", []);
    expect(result.mode).toBe("topic");
    expect(result.topic).toBe("Graph RAG 研究综述");
    expect(result.pageCount).toBe(12);
    expect(result.language).toBe("zh");
    expect(result.style).toBe("学术汇报");
  });

  it("缺失参数使用默认值", async () => {
    mockStream.mockReturnValue(createStream(['{"mode":"topic","topic":"测试"}']));
    const result = await parsePptRequest("生成测试 PPT", []);
    expect(result.mode).toBe("topic");
    expect(result.topic).toBe("测试");
    expect(result.pageCount).toBeUndefined();
    expect(result.language).toBe("auto");
    expect(result.style).toBeUndefined();
  });

  it("页数限制在 4 到 40", async () => {
    mockStream.mockReturnValue(createStream(['{"mode":"topic","topic":"测试","pageCount":2}']));
    const low = await parsePptRequest("生成 2 页 PPT", []);
    expect(low.pageCount).toBe(4);

    mockStream.mockReturnValue(createStream(['{"mode":"topic","topic":"测试","pageCount":100}']));
    const high = await parsePptRequest("生成 100 页 PPT", []);
    expect(high.pageCount).toBe(40);
  });

  it("有 PDF 附件时判定为 document 模式", async () => {
    mockStream.mockReturnValue(createStream(['{"mode":"document"}']));
    const result = await parsePptRequest("根据这篇论文生成 PPT", [
      { name: "paper.pdf", extension: "pdf", mediaTypeLabel: "PDF", content: "论文摘要内容", kind: "text" },
    ]);
    expect(result.mode).toBe("document");
    expect(result.documentName).toBe("paper.pdf");
    expect(result.documentContent).toBe("论文摘要内容");
  });

  it("用户取消时抛出 AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    mockStream.mockReturnValue(createStream(['{"mode":"topic","topic":"测试"}']));
    await expect(parsePptRequest("测试", [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
