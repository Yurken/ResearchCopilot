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
});
