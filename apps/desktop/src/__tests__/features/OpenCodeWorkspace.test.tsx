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
  dataHome: "/tmp/xiaoyan/opencode",
};

describe("OpenCodeWorkspace", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "opencode_runtime_status" || command === "opencode_runtime_configure") return stopped;
      if (command === "opencode_runtime_start") return { ...stopped, phase: "starting" };
      if (command === "opencode_runtime_import_xiaoyan_api") {
        return { provider: "xiaoyan", model: "deepseek-chat", dataHome: stopped.dataHome };
      }
      throw new Error(`unexpected command: ${command}`);
    });
  });

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
    expect(screen.getByRole("button", { name: "拖动 OpenCode 运行控制" })).toBeInTheDocument();
  });

  it("configures the current Xiaoyan API without exposing its credential", async () => {
    const user = userEvent.setup();
    render(<OpenCodeWorkspace />);
    await screen.findByText("已发现本机 OpenCode");

    await user.click(screen.getByRole("button", { name: "配置小妍 API" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("opencode_runtime_configure", {
      config: stopped.config,
    }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("opencode_runtime_import_xiaoyan_api"));
    expect(await screen.findByText("已配置 deepseek-chat · xiaoyan")).toBeInTheDocument();
    expect(screen.queryByText(/sk-[a-z0-9]/i)).not.toBeInTheDocument();
  });
});
