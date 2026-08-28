import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OpenCodeWorkspace from "../../features/opencode/OpenCodeWorkspace";
import type { OpenCodeRuntimeSnapshot } from "../../features/opencode/shared";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const stopped: OpenCodeRuntimeSnapshot = {
  phase: "stopped",
  config: { mode: "auto", externalExecutable: null, workspaceDir: null },
  url: null, error: null, logs: [], pathAvailable: true, bundledAvailable: false, bundledExecutable: null,
  pathExecutable: "/opt/homebrew/bin/opencode", source: "https://github.com/anomalyco/opencode",
};

describe("OpenCodeWorkspace", () => {
  beforeEach(() => { invokeMock.mockReset(); invokeMock.mockImplementation(async (command: string) => command === "opencode_runtime_status" ? stopped : { ...stopped, phase: "starting" }); });

  it("shows the official web runtime launch controls", async () => {
    render(<OpenCodeWorkspace />);
    expect(await screen.findByRole("heading", { name: "启动 OpenCode" })).toBeInTheDocument();
    expect(screen.getByText("已发现本机 OpenCode")).toBeInTheDocument();
    expect(await screen.findByText(/\/opt\/homebrew\/bin\/opencode/)).toBeInTheDocument();
  });

  it("starts an externally selected runtime", async () => {
    const user = userEvent.setup(); render(<OpenCodeWorkspace />); await screen.findByText("已发现本机 OpenCode");
    await user.click(screen.getByText("高级设置"));
    await user.type(screen.getByRole("textbox", { name: /使用其他本机 OpenCode/ }), "/usr/local/bin/opencode");
    await user.click(screen.getByRole("button", { name: "启动 OpenCode" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("opencode_runtime_configure", { config: expect.objectContaining({ mode: "external", externalExecutable: "/usr/local/bin/opencode" }) }));
  });

  it("embeds the official OpenCode Web page while running", async () => {
    invokeMock.mockResolvedValueOnce({ ...stopped, phase: "running", url: "http://127.0.0.1:4810/" });
    render(<OpenCodeWorkspace />);
    expect(await screen.findByTitle("OpenCode Web")).toHaveAttribute("src", "http://127.0.0.1:4810/");
    expect(screen.getByRole("toolbar", { name: "OpenCode 运行控制" })).toBeInTheDocument();
  });
});
