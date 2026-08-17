import { useEffect, useState, type RefObject } from "react";
import { resolveCompanionLookDirection } from "./shared";

const LOOK_DEADZONE_RADIUS = 44;
const NATIVE_POINTER_POLL_MS = 80;
const WEB_POINTER_FRESH_MS = 120;

interface NativeWindowMetrics {
  originX: number;
  originY: number;
  width: number;
  height: number;
  scaleFactor: number;
}

function isTauriRuntime(): boolean {
  return Boolean((globalThis as typeof globalThis & { isTauri?: boolean }).isTauri);
}

interface CompanionLookDirectionOptions {
  enabled: boolean;
  targetRef: RefObject<HTMLElement | null>;
}

export function useCompanionLookDirection({
  enabled,
  targetRef,
}: CompanionLookDirectionOptions): number | null {
  const [direction, setDirection] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDirection(null);
      return;
    }

    let animationFrame = 0;
    let pointer: { x: number; y: number } | null = null;
    let lastWebPointerAt = Number.NEGATIVE_INFINITY;
    let nativePoll = 0;
    let nativeReadPending = false;
    let disposed = false;
    const nativeUnlisteners: Array<() => void> = [];

    const updateDirection = () => {
      animationFrame = 0;
      const target = targetRef.current;
      if (!target || !pointer) return;
      const rect = target.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const nextDirection = resolveCompanionLookDirection(
        pointer.x - centerX,
        pointer.y - centerY,
        LOOK_DEADZONE_RADIUS,
      );
      setDirection((current) => current === nextDirection ? current : nextDirection);
    };

    const queueDirectionUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateDirection);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        pointer = null;
        setDirection(null);
        return;
      }
      lastWebPointerAt = Date.now();
      pointer = { x: event.clientX, y: event.clientY };
      queueDirectionUpdate();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    const startNativePointerTracking = async () => {
      if (!isTauriRuntime()) return;
      try {
        const { cursorPosition, getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        let metrics: NativeWindowMetrics | null = null;

        const refreshMetrics = async () => {
          const [innerPosition, innerSize, scaleFactor] = await Promise.all([
            appWindow.innerPosition(),
            appWindow.innerSize(),
            appWindow.scaleFactor(),
          ]);
          if (disposed) return;
          metrics = {
            originX: innerPosition.x,
            originY: innerPosition.y,
            width: innerSize.width,
            height: innerSize.height,
            scaleFactor,
          };
        };

        await refreshMetrics();
        if (disposed) return;

        const trackUnlistener = (promise: Promise<() => void>) => {
          void promise.then((unlisten) => {
            if (disposed) unlisten();
            else nativeUnlisteners.push(unlisten);
          }).catch(() => {});
        };
        const scheduleMetricsRefresh = () => void refreshMetrics().catch(() => {});
        trackUnlistener(appWindow.onMoved(scheduleMetricsRefresh));
        trackUnlistener(appWindow.onResized(scheduleMetricsRefresh));
        trackUnlistener(appWindow.onScaleChanged(scheduleMetricsRefresh));

        nativePoll = window.setInterval(async () => {
          if (
            disposed
            || nativeReadPending
            || Date.now() - lastWebPointerAt < WEB_POINTER_FRESH_MS
          ) return;
          nativeReadPending = true;
          try {
            const nativePointer = await cursorPosition();
            if (disposed || !metrics) return;
            const physicalX = nativePointer.x - metrics.originX;
            const physicalY = nativePointer.y - metrics.originY;
            if (
              physicalX < 0
              || physicalY < 0
              || physicalX > metrics.width
              || physicalY > metrics.height
            ) return;
            pointer = {
              x: physicalX / metrics.scaleFactor,
              y: physicalY / metrics.scaleFactor,
            };
            queueDirectionUpdate();
          } catch {
            window.clearInterval(nativePoll);
            nativePoll = 0;
          } finally {
            nativeReadPending = false;
          }
        }, NATIVE_POINTER_POLL_MS);
      } catch {
        // Browser previews and restricted Tauri capabilities keep DOM pointer tracking only.
      }
    };

    void startNativePointerTracking();
    return () => {
      disposed = true;
      window.removeEventListener("pointermove", handlePointerMove);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (nativePoll) window.clearInterval(nativePoll);
      nativeUnlisteners.forEach((unlisten) => unlisten());
    };
  }, [enabled, targetRef]);

  return direction;
}
