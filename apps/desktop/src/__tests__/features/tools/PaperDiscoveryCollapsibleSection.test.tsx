import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "../../helpers/render";
import { PaperDiscoveryCollapsibleSection } from "../../../features/tools/PaperDiscoveryCollapsibleSection";

describe("PaperDiscoveryCollapsibleSection", () => {
  it("默认折叠并可展开高级检索内容", () => {
    render(
      <PaperDiscoveryCollapsibleSection
        title="检索词"
        description="补充检索条件"
        status="已填写 2 项"
      >
        <div>高级检索内容</div>
      </PaperDiscoveryCollapsibleSection>,
    );

    const trigger = screen.getByRole("button", { name: /检索词/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("高级检索内容")).not.toBeInTheDocument();
    expect(screen.getByText("已填写 2 项")).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("高级检索内容")).toBeInTheDocument();
  });
});
