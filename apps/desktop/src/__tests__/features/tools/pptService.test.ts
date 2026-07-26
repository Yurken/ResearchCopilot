import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePptArtifact } from "../../../features/tools/pptService";

const { mockStream } = vi.hoisted(() => ({
  mockStream: vi.fn(),
}));

vi.mock("../../../lib/client", () => ({
  apiClient: {
    chat: { stream: mockStream },
  },
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

describe("generatePptArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("首次返回合法 JSON 时直接生成 PPTX", async () => {
    mockStream.mockReturnValue(
      createStream([
        '{"title":"测试","slides":[{"layout":"title","title":"封面","subtitle":"副标题"},{"layout":"content","title":"正文","bullets":["要点1"],"note":"备注"}]}',
      ]),
    );

    const result = await generatePptArtifact({ mode: "topic", topic: "测试" });
    expect(result.title).toBe("测试");
    expect(result.slideCount).toBe(2);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it("首次返回坏 JSON 后进入修复流程", async () => {
    mockStream
      .mockReturnValueOnce(createStream(['{"title":"测试","slides":']))
      .mockReturnValueOnce(
        createStream([
          '{"title":"测试","slides":[{"layout":"title","title":"封面"},{"layout":"content","title":"正文","bullets":["要点"]}]}',
        ]),
      );

    const result = await generatePptArtifact({ mode: "topic", topic: "测试" });
    expect(result.title).toBe("测试");
    expect(result.slideCount).toBe(2);
  });

  it("修复失败时正确报错", async () => {
    mockStream
      .mockReturnValueOnce(createStream(['invalid']))
      .mockReturnValueOnce(createStream(['still invalid']));

    await expect(generatePptArtifact({ mode: "topic", topic: "测试" })).rejects.toThrow();
  });

  it("用户取消时抛出 AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generatePptArtifact({ mode: "topic", topic: "测试" }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
