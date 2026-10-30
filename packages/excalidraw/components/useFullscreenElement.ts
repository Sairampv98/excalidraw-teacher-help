import { useSyncExternalStore } from "react";

/**
 * The element that is full screen right now, or null (D-334).
 *
 * The browser shows only that element while it is full screen, so a window that
 * is drawn anywhere else is drawn behind it and cannot be seen.
 */
export const useFullscreenElement = (): Element | null =>
  useSyncExternalStore(
    (notify) => {
      document.addEventListener("fullscreenchange", notify);

      return () => document.removeEventListener("fullscreenchange", notify);
    },
    () => document.fullscreenElement ?? null,
    () => null,
  );
