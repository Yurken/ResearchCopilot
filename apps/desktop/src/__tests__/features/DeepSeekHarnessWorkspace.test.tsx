import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeepSeekHarnessWorkspace from "../../features/deepseek-harness/DeepSeekHarnessWorkspace";
import type { DshRuntimeSnapshot } from "../../features/deepseek-harness/shared";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const stoppedSnapshot: DshRuntimeSnapshot = {
  phase: "stopped",
  config: {
    mode: "auto",
    externalExecutable: null,
    externalHome: null,
    profile: "web",
    workspaceDir: null,
  },
  url: null,
  error: null,
  logs: [],
  bundledAvailable: true,
  pathAvailable: false,
  pathExecutable: null,
  lockedVersion: "0.1.0-rc.5",
  lockedCommit: "47f943859bef60e4160492346772ded9b24f765a",
  nodeRequirement: "^22.19.0 || >=24.0.0",
  source: "https://github.com/deepseek-ai/deepseek-harness",
  dataHome: "/tmp/xiaoyan/dsh/bundled-home",
};

describe("DeepSeekHarnessWorkspace", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "dsh_runtime_status" || command === "dsh_runtime_configure") return stoppedSnapshot;
      if (command === "dsh_runtime_start") return { ...stoppedSnapshot, phase: "starting" };
      if (command === "dsh_runtime_import_xiaoyan_api") {
        return {
          route: "xiaoyan",
          protocol: "openai-completions",
          model: "deepseek-chat",
          dataHome: stoppedSnapshot.dataHome,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
  });

  it("keeps the launch controls focused and hides release metadata", async () => {
    render(<DeepSeekHarnessWorkspace />);

    expect(await screen.findByRole("heading", { name: "启动 DSH" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DeepSeek Harness" })).toBeInTheDocument();
    expect(screen.queryByText("小妍代码")).not.toBeInTheDocument();
    expect(screen.getByText("DSH 已安装在小妍私有目录")).toBeInTheDocument();
    expect(screen.queryByText(/0\.1\.0-rc\.5/)).not.toBeInTheDocument();
    expect(screen.queryByText("Node 运行要求")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "官方源码" })).not.toBeInTheDocument();
    expect(screen.queryByText("实验记录")).not.toBeInTheDocument();
    expect(screen.queryByText("快照")).not.toBeInTheDocument();
  });

  it("passes an external executable through the runtime controller", async () => {
    const user = userEvent.setup();
    render(<DeepSeekHarnessWorkspace />);
    await screen.findByText("DSH 已安装在小妍私有目录");
    await user.click(screen.getByRole("button", { name: "高级配置" }));
    await user.type(screen.getByLabelText(/使用其他本机 DSH/), "/usr/local/bin/dsh");
    await user.click(screen.getByRole("button", { name: "启动 DSH" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("dsh_runtime_configure", {
      config: expect.objectContaining({
        mode: "external",
        externalExecutable: "/usr/local/bin/dsh",
        profile: "web",
      }),
    }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("dsh_runtime_start"));
  });

  it("embeds only the loopback URL returned by the backend", async () => {
    invokeMock.mockResolvedValueOnce({
      ...stoppedSnapshot,
      phase: "running",
      url: "http://127.0.0.1:63244",
    });
    render(<DeepSeekHarnessWorkspace />);

    const frame = await screen.findByTitle("DeepSeek Harness");
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:63244");
    expect(frame).toHaveAttribute("sandbox", expect.stringContaining("allow-scripts"));
    expect(screen.getByRole("toolbar", { name: "DSH 运行控制" })).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重启" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "小妍代码" })).not.toBeInTheDocument();
  });

  it("configures the current Xiaoyan API without exposing its credential", async () => {
    const user = userEvent.setup();
    render(<DeepSeekHarnessWorkspace />);
    await screen.findByText("DSH 已安装在小妍私有目录");

    await user.click(screen.getByRole("button", { name: "配置小妍 API" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("dsh_runtime_configure", {
      config: stoppedSnapshot.config,
    }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("dsh_runtime_import_xiaoyan_api"));
    expect(await screen.findByText("已配置 deepseek-chat · xiaoyan")).toBeInTheDocument();
    expect(screen.queryByText(/sk-[a-z0-9]/i)).not.toBeInTheDocument();
  });
});
