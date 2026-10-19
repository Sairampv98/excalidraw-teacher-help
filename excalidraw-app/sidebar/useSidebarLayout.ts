import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  getCameraForPage,
  getCurrentPageRect,
  getPageViewportWidth,
  useExcalidrawAPI,
  useExcalidrawStateValue,
} from "@excalidraw/excalidraw";
import { MAX_ZOOM } from "@excalidraw/common";

import type {
  ExcalidrawImperativeAPI,
  ExcalidrawPage,
} from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";

/** matches the library default so a fresh install looks unchanged */
export const DEFAULT_SIDEBAR_WIDTH = 302;

/** narrow enough to still show a usable list, wide enough to read a page of text */
export const MIN_SIDEBAR_WIDTH = 200;

/** past this the canvas stops being worth the space */
export const MAX_SIDEBAR_WIDTH = 720;

/** pure so it can be unit tested without a DOM */
export const clampSidebarWidth = (value: number): number => {
  // a missing or corrupt stored value means "never set", not "as narrow as
  // possible" — clamping it would silently snap the sidebar to the minimum
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.round(
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value)),
  );
};

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    // private mode / storage disabled
    return null;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // non-fatal: we just forget the preference next reload
  }
};

const readStoredWidth = () => {
  const stored = readStored(STORAGE_KEYS.LOCAL_STORAGE_SIDEBAR_WIDTH);
  const parsed = stored ? Number.parseInt(stored, 10) : NaN;
  return Number.isFinite(parsed)
    ? clampSidebarWidth(parsed)
    : DEFAULT_SIDEBAR_WIDTH;
};

const readStoredAutoFit = () => {
  const stored = readStored(STORAGE_KEYS.LOCAL_STORAGE_PAGE_AUTO_FIT);
  // default on: resizing the sidebar should keep the page fully visible
  return stored === null ? true : stored === "1";
};

/**
 * Camera that frames the whole current page inside the space actually left for
 * the canvas.
 *
 * When the sidebar is docked it *is* removed from the canvas box (`layer-ui`
 * narrows the wrapper to `100% - sidebar width`), so `viewportWidth` already
 * means "remaining space" and this is just the normal fit. When the sidebar
 * overlays a narrow viewport, no space is actually freed, so fitting to the full
 * width is the honest answer.
 */
export const getAutoFitCamera = ({
  viewportWidth,
  viewportHeight,
  pages,
  currentPageId,
  sidebarWidth,
  sidebarCoversCanvas,
}: {
  viewportWidth: number;
  viewportHeight: number;
  pages: readonly ExcalidrawPage[];
  currentPageId: string;
  sidebarWidth: number;
  sidebarCoversCanvas: boolean;
}) => {
  // same rule the editor itself uses, so the toggle can't disagree with the
  // clamp that runs straight afterwards
  const freeWidth = getPageViewportWidth(
    viewportWidth,
    sidebarCoversCanvas ? sidebarWidth : 0,
  );

  const pageRect = getCurrentPageRect(pages, currentPageId);

  return getCameraForPage({
    viewportWidth: freeWidth,
    viewportHeight: Math.max(viewportHeight, 1),
    pageRect,
    maxZoom: MAX_ZOOM,
  });
};

/**
 * Sidebar width state plus the pointer plumbing for the drag handle.
 *
 * The width is pushed to the library as a prop, which turns into
 * `--right-sidebar-width`; the sidebar box and the canvas wrapper both size
 * themselves from that one variable, so there is nothing to measure here.
 */
export const useSidebarWidth = () => {
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const applyWidth = useCallback((next: number) => {
    setWidth((current) => {
      const clamped = clampSidebarWidth(next);
      if (clamped !== current) {
        writeStored(STORAGE_KEYS.LOCAL_STORAGE_SIDEBAR_WIDTH, `${clamped}`);
      }
      return clamped;
    });
  }, []);

  const resetWidth = useCallback(() => {
    setWidth((current) => {
      if (current !== DEFAULT_SIDEBAR_WIDTH) {
        writeStored(
          STORAGE_KEYS.LOCAL_STORAGE_SIDEBAR_WIDTH,
          `${DEFAULT_SIDEBAR_WIDTH}`,
        );
      }
      return DEFAULT_SIDEBAR_WIDTH;
    });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // only the primary button, and never while a text selection is in flight
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      dragRef.current = { startX: event.clientX, startWidth: width };
      setDragging(true);

      const onMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        // dragging left grows the sidebar, because the handle sits on its edge
        applyWidth(drag.startWidth + (drag.startX - moveEvent.clientX));
      };

      const onUp = () => {
        dragRef.current = null;
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [applyWidth, width],
  );

  // a drag that ends outside the window (alt-tab, devtools) would otherwise
  // leave the handle stuck in its dragging state
  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onBlur = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [dragging]);

  return useMemo(
    () => ({ width, dragging, onPointerDown, resetWidth }),
    [width, dragging, onPointerDown, resetWidth],
  );
};

/** persisted on/off switch for the "refit the page when space changes" behaviour */
export const usePageAutoFit = () => {
  const [enabled, setEnabled] = useState(readStoredAutoFit);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      writeStored(STORAGE_KEYS.LOCAL_STORAGE_PAGE_AUTO_FIT, next ? "1" : "0");
      return next;
    });
  }, []);

  return { enabled, toggle };
};

/**
 * Re-frames the page whenever the space available to the canvas changes — a
 * sidebar resize, a window resize, or a page switch — but only while the
 * toggle is on.
 *
 * Deliberately keyed on *space* only: zooming or panning does not change
 * `width`/`height`, so ordinary navigation is never interrupted.
 */
export const useAutoFitPageOnResize = ({
  enabled,
  sidebarWidth,
  sidebarCoversCanvas,
}: {
  enabled: boolean;
  sidebarWidth: number;
  sidebarCoversCanvas: boolean;
}) => {
  const excalidrawAPI = useExcalidrawAPI();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(excalidrawAPI);
  apiRef.current = excalidrawAPI;

  // only rerenders when the canvas box or the page actually changes
  const appState = useExcalidrawStateValue([
    "width",
    "height",
    "pages",
    "currentPageId",
  ]);
  const { width, height, pages, currentPageId } = appState ?? {};

  useEffect(() => {
    const api = apiRef.current;

    if (!enabled || !api || api.isDestroyed) {
      return;
    }

    if (!width || !height || !pages?.length || !currentPageId) {
      return;
    }

    const { scrollX, scrollY, zoom } = getAutoFitCamera({
      viewportWidth: width,
      viewportHeight: height,
      pages,
      currentPageId,
      sidebarWidth,
      sidebarCoversCanvas,
    });

    api.updateScene({
      appState: { scrollX, scrollY, zoom: { value: zoom } },
      // refitting the view is not a document edit the user should have to undo
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [
    enabled,
    width,
    height,
    pages,
    currentPageId,
    sidebarWidth,
    sidebarCoversCanvas,
  ]);
};
