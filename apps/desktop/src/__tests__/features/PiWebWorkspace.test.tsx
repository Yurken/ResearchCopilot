import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PiWebWorkspace from "../../features/pi-web/PiWebWorkspace";
import type { PiWebRuntimeSnapshot } from "../../features/pi-web/shared";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const stopped: PiWebRuntimeSnapshot = {
  phase: "stopped",
  config: { mode: "auto", externalExecutable: null, agentDir: null, workspaceDir: null },
  url: null,
  error: null,
  logs: [],
  pathAvailable: true,
  bundledAvailable: false,
  bundledExecutable: null,
  pathExecutable: "/opt/homebrew/bin/pi-web",
  source: "https://github.com/agegr/pi-web",
  dataHome: "/Users/researcher/.pi/agent",
};

describe("PiWebWorkspace", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "pi_web_runtime_status" ? stopped : { ...stopped, phase: "starting" });
  });

  it("shows Pi launch controls and the discovered executable", async () => {
    render(<PiWebWorkspace />);
    expect(await screen.findByRole("heading", { name: "启动 Pi" })).toBeInTheDocument();
    expect(screen.getByText("已发现本机 Pi")).toBeInTheDocument();
    expect(await screen.findByText(/\/opt\/homebrew\/bin\/pi-web/)).toBeInTheDocument();
  });

  it("starts an externally selected Pi runtime", async () => {
    const user = userEvent.setup();
    render(<PiWebWorkspace />);
    await screen.findByText("已发现本机 Pi");
    await user.click(screen.getByText("高级设置"));
    await user.type(screen.getByRole("textbox", { name: /使用其他本机 Pi/ }), "/usr/local/bin/pi-web");
    await user.click(screen.getByRole("button", { name: "启动 Pi" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("pi_web_runtime_configure", {
      config: expect.objectContaining({ mode: "external", externalExecutable: "/usr/local/bin/pi-web" }),
    }));
  });

  it("embeds the full Pi page while running", async () => {
    invokeMock.mockResolvedValueOnce({ ...stopped, phase: "running", url: "http://127.0.0.1:30142/" });
    render(<PiWebWorkspace />);
    expect(await screen.findByTitle("Pi")).toHaveAttribute("src", "http://127.0.0.1:30142/");
    expect(screen.getByRole("toolbar", { name: "Pi 运行控制" })).toBeInTheDocument();
  });
});
