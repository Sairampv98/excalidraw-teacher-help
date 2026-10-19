import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useExcalidrawAPI,
  useExcalidrawStateValue,
} from "@excalidraw/excalidraw";

import { randomId } from "@excalidraw/common";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { exportAllPages } from "../pages/exportPages";
import { STORAGE_KEYS } from "../app_constants";

import "./PageBar.scss";

/** page id used when the whole page set is reset */
const FIRST_PAGE_ID = "page-1";

/** how long a destructive action stays armed before it disarms itself */
const CONFIRM_WINDOW_MS = 4000;

type IconProps = { size?: number };

const TrashIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const ArrowLeftIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

const ArrowRightIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </svg>
);

const PlusIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const CloseIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const ChevronDownIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const ChevronUpIcon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 15l-6-6-6 6" />
  </svg>
);

/**
 * Page bar: navigation + page-set management.
 *
 * Deliberately an island that sits *below* the edge docks in z-order (see
 * `.excalidraw-page-bar` / `edge-docks.scss`), so a dock dragged over it keeps
 * winning — same visual language, no new stacking context conflicts.
 *
 * Controls:
 *   trash — reset the whole page set back to a single empty page
 *   < >   — previous / next page
 *   n / m — current page indicator
 *   +     — add a page
 *   x     — clear the content of the current page
 *   v     — tuck the whole bar into the bottom edge (it leaves a small handle
 *           there so it can be brought back)
 */
const PageBar = () => {
  const excalidrawAPI = useExcalidrawAPI();
  // only rerenders when `pages` / `currentPageId` actually change
  const appState = useExcalidrawStateValue(["pages", "currentPageId"]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // two-step confirm for the destructive controls
  const [armed, setArmed] = useState<"all" | "page" | null>(null);
  const armTimer = useRef<number | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return (
        localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_PAGE_BAR_HIDDEN) === "1"
      );
    } catch {
      // private mode / storage disabled — stay expanded
      return false;
    }
  });

  const pages = useMemo<readonly ExcalidrawPage[]>(
    () => appState?.pages ?? [],
    [appState?.pages],
  );
  const currentPageId = appState?.currentPageId;

  const currentIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === currentPageId),
  );
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= pages.length - 1;

  // disarm automatically so a stray second click can't wipe the board much later
  useEffect(() => {
    if (!armed) {
      return;
    }
    armTimer.current = window.setTimeout(() => {
      setArmed(null);
    }, CONFIRM_WINDOW_MS);

    return () => {
      if (armTimer.current) {
        window.clearTimeout(armTimer.current);
      }
    };
  }, [armed]);

  const arm = useCallback((which: "all" | "page") => {
    setArmed((current) => (current === which ? null : which));
  }, []);

  const switchPage = useCallback(
    (pageId: string) => {
      if (
        !excalidrawAPI ||
        excalidrawAPI.isDestroyed ||
        pageId === currentPageId
      ) {
        return;
      }
      // the editor re-frames the view on the newly selected page
      excalidrawAPI.updateScene({ appState: { currentPageId: pageId } });
    },
    [excalidrawAPI, currentPageId],
  );

  const step = useCallback(
    (delta: number) => {
      const next = pages[currentIndex + delta];
      if (next) {
        switchPage(next.id);
      }
    },
    [pages, currentIndex, switchPage],
  );

  const addPage = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }

    const nextIndex = pages.length;
    const page: ExcalidrawPage = {
      id: `page-${randomId()}`,
      name: `Page ${nextIndex + 1}`,
    };

    excalidrawAPI.updateScene({
      appState: { pages: [...pages, page], currentPageId: page.id },
    });
  }, [excalidrawAPI, pages]);

  /** soft-delete every element that belongs to the current page */
  const clearCurrentPage = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed || !currentPageId) {
      return;
    }

    const elements = excalidrawAPI
      .getSceneElements()
      .map((element) =>
        element.pageId === currentPageId && !element.isDeleted
          ? { ...element, isDeleted: true }
          : element,
      );

    excalidrawAPI.updateScene({
      elements,
      appState: { selectedElementIds: {} },
    });
  }, [excalidrawAPI, currentPageId]);

  /** drop every page and every element, back to one empty page */
  const deleteAllPages = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }

    const elements = excalidrawAPI
      .getSceneElements()
      .map((element) =>
        element.isDeleted ? element : { ...element, isDeleted: true },
      );

    excalidrawAPI.updateScene({
      elements,
      appState: {
        pages: [{ id: FIRST_PAGE_ID, name: "Page 1" }],
        currentPageId: FIRST_PAGE_ID,
        selectedElementIds: {},
      },
    });
  }, [excalidrawAPI]);

  /** two-step: first click arms, second click runs the action */
  const guardDestructive = useCallback(
    (which: "all" | "page", run: () => void) => {
      if (armed === which) {
        setArmed(null);
        run();
      } else {
        arm(which);
      }
    },
    [armed, arm],
  );

  const onExportAll = useCallback(async () => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed || busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await exportAllPages(excalidrawAPI, {
        baseName: excalidrawAPI.getName() || "excalidraw",
      });
    } catch (err) {
      console.error("pages: export failed", err);
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }, [excalidrawAPI, busy]);

  const toggleHidden = useCallback(() => {
    setHidden((current) => {
      const next = !current;
      try {
        localStorage.setItem(
          STORAGE_KEYS.LOCAL_STORAGE_PAGE_BAR_HIDDEN,
          next ? "1" : "0",
        );
      } catch {
        // non-fatal: the bar just will not remember its state across reloads
      }
      return next;
    });
  }, []);

  if (!excalidrawAPI) {
    return null;
  }

  const confirmArmed = armed !== null;
  const counterLabel = pages.length
    ? `${currentIndex + 1} / ${pages.length}`
    : "0 / 0";

  // tucked into the bottom edge — just enough to bring the bar back
  if (hidden) {
    return (
      <div className="excalidraw-page-bar-hidden">
        <button
          type="button"
          className="excalidraw-page-bar-hidden__handle"
          onClick={toggleHidden}
          title="Show the page bar"
          aria-label="Show the page bar"
        >
          <ChevronUpIcon />
          <span className="excalidraw-page-bar-hidden__counter">
            {counterLabel}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="excalidraw-page-bar">
      {/* Collapse lives at the *left* end on purpose: the bar is centred on the
          viewport, so its right-hand end slides under the (now always-open)
          sidebar, while the left end stays reachable. */}
      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={toggleHidden}
        title="Hide the page bar"
        aria-label="Hide the page bar"
      >
        <ChevronDownIcon />
      </button>

      <span className="excalidraw-page-bar__divider" aria-hidden="true" />

      <button
        type="button"
        className="excalidraw-page-bar__icon excalidraw-page-bar__icon--danger"
        onClick={() => guardDestructive("all", deleteAllPages)}
        title={
          armed === "all"
            ? "Click again to delete every page"
            : "Delete all pages"
        }
        aria-label="Delete all pages"
        data-armed={armed === "all" ? "true" : undefined}
      >
        <TrashIcon />
      </button>

      <span className="excalidraw-page-bar__divider" aria-hidden="true" />

      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={() => step(-1)}
        disabled={isFirst}
        title="Previous page"
        aria-label="Previous page"
      >
        <ArrowLeftIcon />
      </button>

      <span
        className="excalidraw-page-bar__counter"
        title={pages[currentIndex]?.name ?? "Page"}
      >
        {counterLabel}
      </span>

      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={() => step(1)}
        disabled={isLast}
        title="Next page"
        aria-label="Next page"
      >
        <ArrowRightIcon />
      </button>

      <span className="excalidraw-page-bar__divider" aria-hidden="true" />

      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={addPage}
        title="Add a page"
        aria-label="Add a page"
      >
        <PlusIcon />
      </button>

      <button
        type="button"
        className="excalidraw-page-bar__icon excalidraw-page-bar__icon--danger"
        onClick={() => guardDestructive("page", clearCurrentPage)}
        title={
          armed === "page"
            ? "Click again to clear this page"
            : "Clear this page"
        }
        aria-label="Clear this page"
        data-armed={armed === "page" ? "true" : undefined}
      >
        <CloseIcon />
      </button>

      {confirmArmed && (
        <span className="excalidraw-page-bar__error" role="alert">
          Click again to confirm
        </span>
      )}

      <button
        type="button"
        className="excalidraw-page-bar__action"
        onClick={onExportAll}
        disabled={busy}
        title={
          pages.length > 1
            ? `Export all ${pages.length} pages as one multi-page PDF`
            : "Export this page as a PDF (exactly 1920x1080)"
        }
        aria-label="Export all pages as a PDF"
      >
        {busy ? "Exporting…" : "Export pages"}
      </button>

      {error && (
        <span className="excalidraw-page-bar__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
};

export default PageBar;
