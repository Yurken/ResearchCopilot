import { describe, it, expect, vi, beforeEach } from "vitest";
import { artifactStorage, formatFileSize } from "../../../features/artifacts/artifactStorage";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../../lib/client", () => ({
  apiClient: {
    artifact: {
      save: mockInvoke,
      open: mockInvoke,
      reveal: mockInvoke,
      saveAs: mockInvoke,
      delete: mockInvoke,
    },
  },
}));

describe("artifactStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("save 将 ArrayBuffer 转为字节数组并调用 artifact_save", async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    mockInvoke.mockResolvedValue({
      id: "art-1",
      kind: "pptx",
      name: "test.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      localPath: "/tmp/artifacts/art-1/test.pptx",
      size: 3,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const result = await artifactStorage.save({
      id: "art-1",
      kind: "pptx",
      name: "test.pptx",
      buffer,
    });

    expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({
      id: "art-1",
      kind: "pptx",
      name: "test.pptx",
      bytes: [1, 2, 3],
    }));
    expect(result.artifact.size).toBe(3);
  });

  it("open 调用 artifact_open", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await artifactStorage.open({
      id: "art-1",
      kind: "pptx",
      name: "test.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      localPath: "/tmp/artifacts/art-1/test.pptx",
      size: 3,
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(mockInvoke).toHaveBeenCalledWith("art-1", "/tmp/artifacts/art-1/test.pptx");
  });

  it("formatFileSize 格式化文件大小", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.00 MB");
  });
});
