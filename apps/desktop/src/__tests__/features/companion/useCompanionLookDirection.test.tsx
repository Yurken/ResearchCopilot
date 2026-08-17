import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { useCompanionLookDirection } from "../../../features/companion/useCompanionLookDirection";

describe("useCompanionLookDirection", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "isTauri", {
      configurable: true,
      value: true,
    });
    vi.mocked(cursorPosition).mockResolvedValue({ x: 500, y: 200 } as Awaited<ReturnType<typeof cursorPosition>>);
    vi.mocked(getCurrentWindow).mockReturnValue({
      innerPosition: vi.fn().mockResolvedValue({ x: 200, y: 100 }),
      innerSize: vi.fn().mockResolvedValue({ width: 1600, height: 1200 }),
      scaleFactor: vi.fn().mockResolvedValue(2),
      onMoved: vi.fn().mockResolvedValue(() => {}),
      onResized: vi.fn().mockResolvedValue(() => {}),
      onScaleChanged: vi.fn().mockResolvedValue(() => {}),
    } as unknown as ReturnType<typeof getCurrentWindow>);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "isTauri");
    vi.clearAllMocks();
  });

  it("continues tracking the native cursor when an iframe owns pointer events", async () => {
    const target = document.createElement("div");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const { result } = renderHook(() => useCompanionLookDirection({
      enabled: true,
      targetRef: { current: target },
    }));

    await waitFor(() => expect(result.current).toBe(4));
    expect(cursorPosition).toHaveBeenCalled();
  });
});
