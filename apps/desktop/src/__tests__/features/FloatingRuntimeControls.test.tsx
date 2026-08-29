import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FloatingRuntimeControls from "../../features/code-harness/FloatingRuntimeControls";

class PointerEventMock extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? true;
  }
}

Object.defineProperty(window, "PointerEvent", {
  configurable: true,
  value: PointerEventMock,
});

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

describe("FloatingRuntimeControls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(window.localStorage.setItem).mockClear();
  });

  it("drags by the handle, stays visible, and persists the final position", () => {
    render(
      <FloatingRuntimeControls provider="codex" label="Codex">
        <button type="button">停止</button>
      </FloatingRuntimeControls>,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Codex 运行控制" });
    const viewport = toolbar.parentElement;
    const handle = screen.getByRole("button", { name: "拖动 Codex 运行控制" });
    expect(viewport).not.toBeNull();
    vi.spyOn(viewport as HTMLDivElement, "getBoundingClientRect").mockReturnValue(rect({ left: 0, top: 0, width: 800, height: 600 }));
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(rect({ left: 528, top: 12, width: 260, height: 52 }));

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientX: 540, clientY: 24 });
    fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientX: -100, clientY: 700 });

    expect(toolbar).toHaveAttribute("data-dragging", "true");
    expect(toolbar).toHaveStyle({ transform: "translate3d(12px, 536px, 0)" });

    fireEvent.pointerUp(handle, { pointerId: 1, button: 0, isPrimary: true });

    expect(toolbar).toHaveAttribute("data-dragging", "false");
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "rc:floating-runtime-controls:codex",
      JSON.stringify({ x: 12, y: 536 }),
    );
  });
});
