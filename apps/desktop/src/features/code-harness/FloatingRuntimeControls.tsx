import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import { floatingRuntimeControlsStorageKey, type CodeHarnessProvider } from "./shared";
import { useDraggableFloatingRuntimeControls } from "./useDraggableFloatingRuntimeControls";

export default function FloatingRuntimeControls({
  provider,
  label,
  initialPositionClassName = "right-3 top-3",
  children,
}: {
  provider: CodeHarnessProvider;
  label: string;
  initialPositionClassName?: string;
  children: ReactNode;
}) {
  const {
    containerRef,
    panelRef,
    position,
    dragging,
    resetPosition,
    dragHandleProps,
  } = useDraggableFloatingRuntimeControls(floatingRuntimeControlsStorageKey(provider));

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {dragging ? <div aria-hidden="true" className="pointer-events-auto absolute inset-0 cursor-grabbing" /> : null}
      <div
        ref={panelRef}
        role="toolbar"
        aria-label={`${label} 运行控制`}
        data-dragging={dragging ? "true" : "false"}
        className={`pointer-events-auto absolute flex select-none items-center gap-0.5 rounded-2xl border border-nm-dark/10 p-1.5 ${position ? "left-0 top-0" : initialPositionClassName}`}
        style={{
          background: "var(--rc-elevated)",
          boxShadow: "var(--rc-card-shadow)",
          transform: position ? `translate3d(${position.x}px, ${position.y}px, 0)` : undefined,
          willChange: dragging ? "transform" : undefined,
        }}
      >
        <button
          type="button"
          aria-label={`拖动 ${label} 运行控制`}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home"
          title="拖动调整位置；双击或按 Home 恢复默认位置"
          className={`flex h-8 w-5 flex-shrink-0 items-center justify-center rounded-xl text-ink-tertiary transition-colors hover:bg-black/5 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/30 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ touchAction: "none" }}
          onDoubleClick={resetPosition}
          {...dragHandleProps}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}
