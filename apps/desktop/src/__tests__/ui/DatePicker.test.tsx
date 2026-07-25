import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatePicker } from "@research-copilot/ui";
import { describe, expect, it, vi } from "vitest";

describe("DatePicker", () => {
  it("使用拟态日历面板选择日期", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        label="截止日期"
        value="2026-07-22"
        max="2026-07-22"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "截止日期" }));
    expect(screen.getByRole("dialog", { name: "截止日期" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "2026年7月22日" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "2026年7月23日" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "上一个月" }));
    await user.click(screen.getByRole("gridcell", { name: "2026年6月30日" }));
    expect(onChange).toHaveBeenCalledWith("2026-06-30");
    expect(screen.queryByRole("dialog", { name: "截止日期" })).not.toBeInTheDocument();
  });

  it("可快速切换年份和月份", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        label="截止日期"
        value="2026-07-22"
        max="2026-07-22"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "截止日期" }));
    await user.click(screen.getByRole("button", { name: "快速选择年份，当前 2026 年" }));
    expect(screen.getByRole("grid", { name: "年份" })).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "2024 年" }));
    expect(screen.getByRole("grid", { name: "月份" })).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "3 月" }));
    await user.click(screen.getByRole("gridcell", { name: "2024年3月15日" }));
    expect(onChange).toHaveBeenCalledWith("2024-03-15");
  });
});
