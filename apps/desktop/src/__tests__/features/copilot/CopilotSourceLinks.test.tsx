import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotSourceLinks } from "../../../features/copilot/CopilotSourceLinks";

describe("CopilotSourceLinks", () => {
  it("展示论文证据定位并保留本地资产链接", () => {
    render(
      <CopilotSourceLinks
        sources={[
          {
            source: "Synthetic Training Fixture · 4.1 Training Setup",
            content: "本地论文资产 synthetic-paper-e02；证据定位：4.1 Training Setup。",
            url: "/tmp/synthetic-paper.pdf",
          },
        ]}
      />,
    );

    const source = screen.getByRole("link", {
      name: "Synthetic Training Fixture · 4.1 Training Setup",
    });
    expect(source).toHaveAttribute("href", "/tmp/synthetic-paper.pdf");
    expect(source).toHaveAttribute(
      "title",
      "本地论文资产 synthetic-paper-e02；证据定位：4.1 Training Setup。",
    );
  });

  it("没有来源时不渲染容器", () => {
    const { container } = render(<CopilotSourceLinks />);
    expect(container.firstChild).toBeNull();
  });
});
