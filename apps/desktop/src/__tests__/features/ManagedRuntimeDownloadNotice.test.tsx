import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManagedRuntimeDownloadNotice from "../../features/code-harness/ManagedRuntimeDownloadNotice";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

describe("ManagedRuntimeDownloadNotice", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      provider: "codex",
      version: "6c59264b",
      installedPath: "/data/managed-runtimes/codex/runtime",
    });
  });

  it("downloads an absent runtime and refreshes its owner", async () => {
    const onInstalled = vi.fn();
    render(
      <ManagedRuntimeDownloadNotice
        provider="codex"
        label="Codex"
        available={false}
        onInstalled={onInstalled}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "一键安装" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("runtime_download_managed", {
      provider: "codex",
    }));
    expect(onInstalled).toHaveBeenCalledOnce();
  });

  it("explains that a first-time background install may take several minutes", async () => {
    invokeMock.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    render(
      <ManagedRuntimeDownloadNotice
        provider="dsh"
        label="DSH"
        available={false}
        onInstalled={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "一键安装" }));

    expect(screen.getByText("正在后台安装 DSH，首次下载可能需要数分钟，请勿关闭小妍。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安装中…" })).toBeDisabled();
  });
});
