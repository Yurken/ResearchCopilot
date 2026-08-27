import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CodexWorkspace from "../../features/codex/CodexWorkspace";
import type { CodexRuntimeSnapshot } from "../../features/codex/shared";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const stoppedSnapshot: CodexRuntimeSnapshot = {
  phase: "stopped",
  config: {
    mode: "path",
    externalExecutable: null,
    externalHome: null,
    workspaceDir: null,
  },
  url: null,
  error: null,
  logs: [],
  pathAvailable: true,
  pathExecutable: "/usr/local/bin/codex",
  source: "https://github.com/openai/codex",
  dataHome: "/tmp/xiaoyan/codex/home",
};

describe("CodexWorkspace", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "codex_runtime_status" || command === "codex_runtime_configure") return stoppedSnapshot;
      if (command === "codex_runtime_start") return { ...stoppedSnapshot, phase: "starting" };
      if (command === "codex_runtime_import_xiaoyan_api") {
        return {
          provider: "xiaoyan",
          model: "deepseek-chat",
          dataHome: stoppedSnapshot.dataHome,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
  });

  it("keeps the launch controls focused on Codex", async () => {
    render(<CodexWorkspace />);

    expect(await screen.findByRole("heading", { name: "启动 Codex" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Codex Harness" })).toBeInTheDocument();
    expect(screen.getByText("已安装 Codex")).toBeInTheDocument();
    expect(screen.queryByText("小妍代码")).not.toBeInTheDocument();
    expect(screen.queryByText("DeepSeek Harness")).not.toBeInTheDocument();
  });

  it("passes an external executable through the runtime controller", async () => {
    const user = userEvent.setup();
    render(<CodexWorkspace />);
    await screen.findByText("已安装 Codex");

    await user.click(screen.getByRole("button", { name: /自定义 Codex/ }));
    await user.type(screen.getByLabelText("codex 可执行文件"), "/usr/local/bin/codex");
    await user.click(screen.getByRole("button", { name: "启动 Codex" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_runtime_configure", {
      config: expect.objectContaining({
        mode: "external",
        externalExecutable: "/usr/local/bin/codex",
      }),
    }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_runtime_start"));
  });

  it("shows the session workspace when Codex is running", async () => {
    invokeMock.mockResolvedValueOnce({
      ...stoppedSnapshot,
      phase: "running",
      url: "http://127.0.0.1:4501/",
    });
    render(<CodexWorkspace />);

    expect(await screen.findByTitle("Codex Web")).toHaveAttribute("src", "http://127.0.0.1:4501/");
    expect(screen.getByRole("toolbar", { name: "Codex 运行控制" })).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "启动 Codex" })).not.toBeInTheDocument();
  });

  it("configures the current Xiaoyan API without exposing its credential", async () => {
    const user = userEvent.setup();
    render(<CodexWorkspace />);
    await screen.findByText("已安装 Codex");

    await user.click(screen.getByRole("button", { name: "配置小妍 API" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_runtime_configure", {
      config: stoppedSnapshot.config,
    }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("codex_runtime_import_xiaoyan_api"));
    expect(await screen.findByText("已配置 deepseek-chat · xiaoyan")).toBeInTheDocument();
    expect(screen.queryByText(/sk-[a-z0-9]/i)).not.toBeInTheDocument();
  });
});
