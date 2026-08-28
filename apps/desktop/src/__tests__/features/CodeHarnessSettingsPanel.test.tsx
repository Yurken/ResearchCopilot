import { describe, expect, it, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CodeHarnessSettingsPanel from "../../features/code-harness/CodeHarnessSettingsPanel";
import { readCodeHarnessProvider } from "../../features/code-harness/shared";

describe("CodeHarnessSettingsPanel", () => {
  beforeEach(() => localStorage.clear());

  it("can switch the code harness to Codex", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CodeHarnessSettingsPanel />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /DeepSeek Harness/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Codex Harness/ }));
    expect(readCodeHarnessProvider()).toBe("codex");
    expect(screen.getByRole("button", { name: /Codex Harness/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("can switch the code harness to OpenCode", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CodeHarnessSettingsPanel /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: /OpenCode/ }));
    expect(readCodeHarnessProvider()).toBe("opencode");
    expect(screen.getByRole("button", { name: /OpenCode/ })).toHaveAttribute("aria-pressed", "true");
  });
});
