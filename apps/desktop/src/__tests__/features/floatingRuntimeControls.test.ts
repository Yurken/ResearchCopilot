import { describe, expect, it } from "vitest";
import {
  clampFloatingRuntimeControlsPosition,
  floatingRuntimeControlsStorageKey,
} from "../../features/code-harness/shared";

describe("floating runtime controls", () => {
  it("keeps the control panel inside the visible runtime viewport", () => {
    expect(clampFloatingRuntimeControlsPosition(
      { x: -40, y: 900 },
      { width: 800, height: 600 },
      { width: 260, height: 52 },
    )).toEqual({ x: 12, y: 536 });
  });

  it("keeps the configured margin when the viewport is smaller than the panel", () => {
    expect(clampFloatingRuntimeControlsPosition(
      { x: 200, y: 200 },
      { width: 180, height: 40 },
      { width: 260, height: 52 },
    )).toEqual({ x: 12, y: 12 });
  });

  it("stores an independent position for every runtime provider", () => {
    expect(floatingRuntimeControlsStorageKey("codex")).toBe("rc:floating-runtime-controls:codex");
    expect(floatingRuntimeControlsStorageKey("dsh")).not.toBe(floatingRuntimeControlsStorageKey("pi"));
  });
});
