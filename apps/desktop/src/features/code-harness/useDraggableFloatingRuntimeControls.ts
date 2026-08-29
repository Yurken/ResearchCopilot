import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampFloatingRuntimeControlsPosition,
  type FloatingRuntimeControlsPosition,
} from "./shared";

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: FloatingRuntimeControlsPosition;
}

function readStoredPosition(storageKey: string): FloatingRuntimeControlsPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingRuntimeControlsPosition>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x as number, y: parsed.y as number };
  } catch {
    return null;
  }
}

function storePosition(storageKey: string, position: FloatingRuntimeControlsPosition | null) {
  if (typeof window === "undefined") return;
  try {
    if (position) window.localStorage.setItem(storageKey, JSON.stringify(position));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // 受限 WebView 中仍保留本次会话的位置。
  }
}

export function useDraggableFloatingRuntimeControls(storageKey: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<FloatingRuntimeControlsPosition | null>(() => readStoredPosition(storageKey));
  const positionRef = useRef(position);
  const [dragging, setDragging] = useState(false);

  const clampPosition = useCallback((candidate: FloatingRuntimeControlsPosition) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!containerRect || !panelRect) return candidate;
    return clampFloatingRuntimeControlsPosition(
      candidate,
      { width: containerRect.width, height: containerRect.height },
      { width: panelRect.width, height: panelRect.height },
    );
  }, []);

  const updatePosition = useCallback((candidate: FloatingRuntimeControlsPosition, persist = false) => {
    const next = clampPosition(candidate);
    positionRef.current = next;
    setPosition(next);
    if (persist) storePosition(storageKey, next);
    return next;
  }, [clampPosition, storageKey]);

  const currentPanelPosition = useCallback((): FloatingRuntimeControlsPosition => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!containerRect || !panelRect) return positionRef.current ?? { x: 12, y: 12 };
    return {
      x: panelRect.left - containerRect.left,
      y: panelRect.top - containerRect.top,
    };
  }, []);

  const resetPosition = useCallback(() => {
    dragStateRef.current = null;
    positionRef.current = null;
    setPosition(null);
    setDragging(false);
    storePosition(storageKey, null);
  }, [storageKey]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const origin = clampPosition(currentPanelPosition());
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
    };
    positionRef.current = origin;
    setPosition(origin);
    setDragging(true);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [clampPosition, currentPanelPosition]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    updatePosition({
      x: dragState.origin.x + event.clientX - dragState.startX,
      y: dragState.origin.y + event.clientY - dragState.startY,
    });
  }, [updatePosition]);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setDragging(false);
    if (positionRef.current) storePosition(storageKey, positionRef.current);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [storageKey]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      resetPosition();
      return;
    }
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const origin = positionRef.current ?? currentPanelPosition();
    updatePosition({
      x: origin.x + direction[0] * step,
      y: origin.y + direction[1] * step,
    }, true);
  }, [currentPanelPosition, resetPosition, updatePosition]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel || typeof ResizeObserver === "undefined") return;
    const keepInsideViewport = () => {
      if (!positionRef.current) return;
      updatePosition(positionRef.current, true);
    };
    keepInsideViewport();
    const observer = new ResizeObserver(keepInsideViewport);
    observer.observe(container);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [updatePosition]);

  return {
    containerRef,
    panelRef,
    position,
    dragging,
    resetPosition,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onKeyDown,
    },
  };
}
