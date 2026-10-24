import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deletePage,
  deletePageElements,
  insertPageAfter,
  scalePageContent,
  translateContentForPageLayout,
  useExcalidrawAPI,
  useExcalidrawStateValue,
} from "@excalidraw/excalidraw";

import { randomId } from "@excalidraw/common";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { exportAllPages } from "../pages/exportPages";
import { STORAGE_KEYS } from "../app_constants";
import {
  documentStoreBackendAtom,
  documentStoreErrorAtom,
} from "../data/LocalData";
import { useAtomValue } from "../app-jotai";
import { recordPageSwitch } from "../data/documentStats";

import "./PageBar.scss";

/** page id used when the whole page set is reset */
const FIRST_PAGE_ID = "page-1";

/** how long a destructive action stays armed before it disarms itself */
const CONFIRM_WINDOW_MS = 4000;

/** height of one row in the page list, in css px */
const PAGE_ROW_HEIGHT = 32;

/** how many rows of the page list are rendered at once */
const PAGE_LIST_VISIBLE_ROWS = 8;

/** how many rows are rendered above and below the visible window */
const PAGE_LIST_OVERSCAN = 2;

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

const PageTrashIcon = ({ size = 16 }: IconProps) => (
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
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M15 3v4h4" />
    <path d="M10 12l5 5M15 12l-5 5" />
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

const ScaleContentDownIcon = ({ size = 16 }: IconProps) => (
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
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 12h6" />
  </svg>
);

const ScaleContentUpIcon = ({ size = 16 }: IconProps) => (
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
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 12h6" />
    <path d="M12 9v6" />
  </svg>
);

const ListIcon = ({ size = 16 }: IconProps) => (
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
    <path d="M4 6h16M4 12h16M4 18h16" />
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
 *   list  — the page list, virtualised (a document may hold thousands of pages)
 *   grow/shrink — the current page's rect
 *   scale — the current page's content
 *   v     — tuck the whole bar into the bottom edge (it leaves a small handle
 *           there so it can be brought back)
 */
const PageBar = () => {
  const excalidrawAPI = useExcalidrawAPI();
  // only rerenders when `pages` / `currentPageId` actually change
  const appState = useExcalidrawStateValue(["pages", "currentPageId"]);

  const backend = useAtomValue(documentStoreBackendAtom);
  const documentError = useAtomValue(documentStoreErrorAtom);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // two-step confirm for the destructive controls
  const [armed, setArmed] = useState<"all" | "clear" | "delete" | null>(null);
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

  // the page list is a virtualised window: only the rows around the scroll
  // position are rendered, so a document with thousands of pages does not
  // create thousands of DOM nodes
  const [listOpen, setListOpen] = useState(false);
  const [listScrollTop, setListScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // when a page switch is in flight, the latency is recorded once the editor
  // has re-rendered with the new page
  const switchStartedAt = useRef<number | null>(null);

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

  const firstVisibleIndex = Math.max(
    0,
    Math.floor(listScrollTop / PAGE_ROW_HEIGHT) - PAGE_LIST_OVERSCAN,
  );
  const lastVisibleIndex = Math.min(
    pages.length,
    firstVisibleIndex + PAGE_LIST_VISIBLE_ROWS + PAGE_LIST_OVERSCAN * 2,
  );
  const visiblePages = pages.slice(firstVisibleIndex, lastVisibleIndex);

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

  // bring the current page into view when the list is opened
  useEffect(() => {
    if (!listOpen) {
      return;
    }
    const element = listRef.current;
    if (!element) {
      return;
    }
    const target = Math.max(
      0,
      currentIndex * PAGE_ROW_HEIGHT -
        (PAGE_LIST_VISIBLE_ROWS * PAGE_ROW_HEIGHT) / 2,
    );
    element.scrollTop = target;
    setListScrollTop(target);
  }, [listOpen, currentIndex]);

  // the page-switch latency is the time from the click to the editor showing
  // the new page
  useEffect(() => {
    if (switchStartedAt.current === null) {
      return;
    }
    recordPageSwitch(performance.now() - switchStartedAt.current);
    switchStartedAt.current = null;
  }, [currentPageId]);

  const arm = useCallback((which: "all" | "clear" | "delete") => {
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
      switchStartedAt.current = performance.now();
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

  /**
   * Adds a page *after* the page the user is on.
   *
   * The pages that follow it move one pitch to the right, and their content
   * moves with them — the content lives in absolute scene coordinates, so
   * without the translation it would be left behind on the page before.
   */
  const addPage = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }

    const pageId = `page-${randomId()}`;

    const nextPages = insertPageAfter({
      pages,
      afterPageId: currentPageId ?? "",
      pageId,
    });

    const nextElements = translateContentForPageLayout({
      elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
      previousPages: pages,
      nextPages,
    });

    excalidrawAPI.updateScene({
      elements: nextElements,
      appState: { pages: nextPages, currentPageId: pageId },
    });
  }, [excalidrawAPI, pages, currentPageId]);

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

  /**
   * Drop the current page.
   *
   * The page's elements are soft-deleted rather than removed, so that undoing
   * brings the page and its content back together. Deleting the last page
   * leaves a single, empty page behind — a document always has one page.
   *
   * The pages that follow the deleted one move one pitch to the left, and
   * their content moves with them: the content lives in absolute scene
   * coordinates, so without the translation it would be stranded on the page
   * before the one that now holds it — and those pages would look empty.
   */
  const deleteCurrentPage = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed || !currentPageId) {
      return;
    }

    const elements = excalidrawAPI.getSceneElements();

    const { pages: nextPages, currentPageId: nextCurrentPageId } = deletePage({
      pages,
      currentPageId,
      pageId: currentPageId,
    });

    const nextElements = translateContentForPageLayout({
      elements,
      previousPages: pages,
      nextPages,
    });

    excalidrawAPI.updateScene({
      elements: deletePageElements(nextElements, currentPageId),
      appState: {
        pages: nextPages,
        currentPageId: nextCurrentPageId,
        selectedElementIds: {},
      },
    });
  }, [excalidrawAPI, pages, currentPageId]);

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
    (which: "all" | "clear" | "delete", run: () => void) => {
      if (armed === which) {
        setArmed(null);
        run();
      } else {
        arm(which);
      }
    },
    [armed, arm],
  );

  /**
   * Scales the current page's content around the page's origin.
   *
   * The page rect is left untouched — scaling the content down is the only way
   * to get more room on a page.
   */
  const scaleCurrentPageContent = useCallback(
    (factor: number) => {
      if (!excalidrawAPI || excalidrawAPI.isDestroyed || !currentPageId) {
        return;
      }

      const elements = excalidrawAPI.getSceneElements();

      const { pages: nextPages, elements: nextElements } = scalePageContent({
        elements,
        pages,
        pageId: currentPageId,
        factor,
      });

      excalidrawAPI.updateScene({
        elements: nextElements,
        appState: { pages: nextPages },
      });
    },
    [excalidrawAPI, pages, currentPageId],
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
        onClick={() => guardDestructive("clear", clearCurrentPage)}
        title={
          armed === "clear"
            ? "Click again to clear this page"
            : "Clear this page"
        }
        aria-label="Clear this page"
        data-armed={armed === "clear" ? "true" : undefined}
      >
        <CloseIcon />
      </button>

      <button
        type="button"
        className="excalidraw-page-bar__icon excalidraw-page-bar__icon--danger"
        onClick={() => guardDestructive("delete", deleteCurrentPage)}
        title={
          armed === "delete"
            ? "Click again to delete this page"
            : "Delete this page"
        }
        aria-label="Delete this page"
        data-armed={armed === "delete" ? "true" : undefined}
      >
        <PageTrashIcon />
      </button>

      <span className="excalidraw-page-bar__divider" aria-hidden="true" />

      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={() => scaleCurrentPageContent(0.5)}
        title="Scale this page's content down"
        aria-label="Scale this page's content down"
      >
        <ScaleContentDownIcon />
      </button>

      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={() => scaleCurrentPageContent(2)}
        title="Scale this page's content up"
        aria-label="Scale this page's content up"
      >
        <ScaleContentUpIcon />
      </button>

      <span className="excalidraw-page-bar__divider" aria-hidden="true" />

      <button
        type="button"
        className="excalidraw-page-bar__icon"
        onClick={() => setListOpen((open) => !open)}
        title={listOpen ? "Hide the page list" : "Show the page list"}
        aria-label="Show the page list"
        aria-expanded={listOpen}
      >
        <ListIcon />
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
            : "Export this page as a PDF (at the page's own size)"
        }
        aria-label="Export all pages as a PDF"
      >
        {busy ? "Exporting…" : "Export pages"}
      </button>

      {backend && (
        <span
          className="excalidraw-page-bar__storage"
          title={
            backend === "indexeddb"
              ? "The document is stored in IndexedDB"
              : "IndexedDB is unavailable — the document is stored in localStorage"
          }
          data-backend={backend}
        >
          {backend === "indexeddb" ? "IndexedDB" : "localStorage"}
        </span>
      )}

      {(error || documentError) && (
        <span className="excalidraw-page-bar__error" role="alert">
          {error ?? documentError}
        </span>
      )}

      {listOpen && (
        <div className="excalidraw-page-bar__page-list-panel">
          <div
            className="excalidraw-page-bar__page-list"
            role="listbox"
            aria-label="Page list"
            ref={listRef}
            onScroll={(event) =>
              setListScrollTop(event.currentTarget.scrollTop)
            }
          >
            <div
              className="excalidraw-page-bar__page-list-inner"
              style={{ height: pages.length * PAGE_ROW_HEIGHT }}
            >
              {visiblePages.map((page, offset) => {
                const index = firstVisibleIndex + offset;

                return (
                  <button
                    key={page.id}
                    type="button"
                    role="option"
                    aria-selected={page.id === currentPageId}
                    className="excalidraw-page-bar__page-row"
                    data-page-id={page.id}
                    data-page-index={index}
                    style={{ top: index * PAGE_ROW_HEIGHT }}
                    onClick={() => switchPage(page.id)}
                  >
                    <span className="excalidraw-page-bar__page-row-index">
                      {index + 1}
                    </span>
                    <span className="excalidraw-page-bar__page-row-name">
                      {page.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PageBar;
