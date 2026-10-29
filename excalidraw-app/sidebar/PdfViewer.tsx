import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { OcrEnginePicker } from "../components/OcrEnginePicker";

import { mergeRuns, pdfRegionRuns, runsText } from "./pdfSelection";
import { SidebarIcon } from "./SidebarIcons";

import type { ReactNode } from "react";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * The PDF viewer (D-279).
 *
 * It draws the pages of a PDF itself, with pdf.js, instead of leaning on the
 * browser's own PDF plug-in: that plug-in is missing or switched off in some
 * browsers ("Inline PDF preview is unavailable in this browser"), and it has
 * no text a teacher can select and send to the page. Here the text is real, so
 * the same selection bar the markdown viewer has works on it, and a scanned
 * page can be read with OCR.
 *
 * pdf.js is not a dependency of the app. It is fetched the first time a PDF is
 * opened, from a pinned version, so a teacher who never opens a PDF never pays
 * for it - the same way the in-browser Python runtime is fetched (D-268).
 */

/** the version of pdf.js that is fetched, pinned */
export const PDFJS_VERSION = "4.10.38";

const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`;

/** the most pages drawn: a book is not drawn all at once */
export const PDF_MAX_PAGES = 300;

/** how big a page is drawn at a zoom of 100%, in css pixels per PDF point */
const BASE_SCALE = 1.4;

/** the zoom a PDF may have: from a whole page in a narrow panel to a close look */
export const PDF_ZOOM_MIN = 0.2;
export const PDF_ZOOM_MAX = 4;

/** the room left round a page that is fitted, in css pixels */
const FIT_MARGIN = 12;

/** one wheel notch of ctrl + wheel changes the zoom by this factor */
const WHEEL_ZOOM_FACTOR = 1.12;

export const clampPdfZoom = (zoom: number) =>
  Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, zoom));

/** the part of pdf.js's API this viewer uses */
export type PdfPageProxy = {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
    scale: number;
  };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    transform?: number[];
  }) => { promise: Promise<void> };
  streamTextContent: () => unknown;
};

export type PdfDocumentProxy = {
  numPages: number;
  getPage: (index: number) => Promise<PdfPageProxy>;
  destroy?: () => Promise<void> | void;
};

export type PdfJs = {
  getDocument: (source: { data: Uint8Array }) => {
    promise: Promise<PdfDocumentProxy>;
  };
  GlobalWorkerOptions: { workerSrc: string };
  TextLayer: new (options: {
    textContentSource: unknown;
    container: HTMLElement;
    viewport: unknown;
  }) => { render: () => Promise<void> };
};

let loading: Promise<PdfJs> | null = null;

/** fetches pdf.js once; a failed fetch is tried again the next time */
export const loadPdfJs = (): Promise<PdfJs> => {
  // pdf.js reads a PDF in a worker: without one it cannot run, and that is said
  if (typeof Worker === "undefined") {
    return Promise.reject(
      new Error("this browser cannot run the PDF reader (no web workers)"),
    );
  }

  loading ??= import(/* @vite-ignore */ `${PDFJS_BASE}pdf.min.mjs`)
    .then((module: PdfJs) => {
      module.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;

      return module;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });

  return loading;
};

type Status =
  | { state: "loading" }
  | { state: "ready"; pages: number; shown: number }
  | { state: "failed"; reason: string };

/** a picture of one drawn page, for the OCR */
export type PdfPagePicture = {
  dataURL: string;
  width: number;
  height: number;
};

/**
 * What a box drawn on a page covers (D-314).
 *
 * The text and the lines are the runs of text that are for the most part inside
 * the box; the picture is the part of the page that is inside it, cut from the
 * page as it was drawn, and it is only made when it is asked for.
 */
export type PdfRegion = {
  /** the box, in css pixels from the top-left corner of the column of pages */
  box: { x: number; y: number; width: number; height: number };
  /** the text in the box: a row to a line, a tab between far apart pieces */
  text: string;
  /** the same text, a piece to a line, each where it was on its page (D-301) */
  lines: OcrLine[];
  /** the part of the page in the box, as a picture (D-315) */
  picture: () => PdfPagePicture | null;
};

/** a box smaller than this is a click, not a selection */
const MIN_BOX = 6;

/** what the choices under a box need, to be put where they fit (css pixels) */
const REGION_BAR_WIDTH = 220;
const REGION_BAR_HEIGHT = 36;
const REGION_BAR_GAP = 6;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/** the part of a drawn page that a box covers, as a picture of its own pixels */
const cropPage = (
  sheet: HTMLElement,
  box: { left: number; top: number; right: number; bottom: number },
): PdfPagePicture | null => {
  const canvas = sheet.querySelector("canvas");
  const page = sheet.getBoundingClientRect();

  if (!canvas || !page.width || !page.height) {
    return null;
  }

  // the canvas has more pixels than the page has css pixels on a sharp screen
  const scaleX = canvas.width / page.width;
  const scaleY = canvas.height / page.height;
  const width = Math.max(1, Math.round((box.right - box.left) * scaleX));
  const height = Math.max(1, Math.round((box.bottom - box.top) * scaleY));

  const cut = document.createElement("canvas");

  cut.width = width;
  cut.height = height;

  const context = cut.getContext("2d");

  if (!context) {
    return null;
  }

  context.drawImage(
    canvas,
    (box.left - page.left) * scaleX,
    (box.top - page.top) * scaleY,
    width,
    height,
    0,
    0,
    width,
    height,
  );

  return { dataURL: cut.toDataURL("image/png"), width, height };
};

export const PdfViewer = ({
  file,
  zoom,
  onZoomChange,
  containerRef,
  loader = loadPdfJs,
  onReadPage,
  toolbarHost,
  onRegion,
  renderRegionBar,
}: {
  file: File;
  /** 1 is 100% */
  zoom: number;
  /** the viewer asks for a zoom: the wheel, the pinch and the fit buttons */
  onZoomChange?: (zoom: number) => void;
  /** the element a selection has to lie in, for the selection bar */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** how pdf.js is fetched; a test hands in its own */
  loader?: () => Promise<PdfJs>;
  /** the teacher asked for the text of a page to be read (OCR) */
  onReadPage?: (picture: PdfPagePicture) => void;
  /**
   * Where the toolbar is drawn (D-313): in the row of the zoom, outside the
   * part that scrolls. `undefined` leaves it at the top of the viewer, and
   * `null` says the place is not there yet, so nothing is drawn.
   */
  toolbarHost?: HTMLElement | null;
  /** a box was drawn on a page and it covers `region` (D-314) */
  onRegion?: (region: PdfRegion) => void;
  /** the choices under the box (D-314) */
  renderRegionBar?: (region: PdfRegion, close: () => void) => ReactNode;
}) => {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  /** the box that was drawn and what it covers, kept until it is put away */
  const [region, setRegion] = useState<PdfRegion | null>(null);
  /** the box while it is being drawn */
  const [draft, setDraft] = useState<PdfRegion["box"] | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<{
    sheet: HTMLElement;
    x: number;
    y: number;
    box: { left: number; top: number; right: number; bottom: number } | null;
  } | null>(null);
  const documentRef = useRef<PdfDocumentProxy | null>(null);
  const jsRef = useRef<PdfJs | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  /** the first page at a zoom of 100%, for the fit buttons */
  const firstPageRef = useRef<{ width: number; height: number } | null>(null);
  /** the viewer starts fitted; once the teacher has zoomed it stays theirs */
  const fittedRef = useRef(false);
  const zoomRef = useRef(zoom);

  zoomRef.current = zoom;

  // the file is read and opened once
  useEffect(() => {
    let cancelled = false;

    setStatus({ state: "loading" });
    fittedRef.current = false;

    (async () => {
      try {
        // one after the other: a rejection that nobody is waiting for is lost
        const pdfjs = await loader();
        const bytes = await file.arrayBuffer();

        const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) })
          .promise;

        if (cancelled) {
          void doc.destroy?.();
          return;
        }

        jsRef.current = pdfjs;
        documentRef.current = doc;

        // the first page's size says how much room the document needs
        const first = await doc.getPage(1);
        const size = first.getViewport({ scale: BASE_SCALE });

        firstPageRef.current = { width: size.width, height: size.height };

        setStatus({
          state: "ready",
          pages: doc.numPages,
          shown: Math.min(doc.numPages, PDF_MAX_PAGES),
        });
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: "failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      void documentRef.current?.destroy?.();
      documentRef.current = null;
    };
  }, [file, loader]);

  /** the zoom at which the first page fills the viewer's width, or all of it */
  const fitZoom = useCallback((mode: "width" | "page") => {
    const viewer = viewerRef.current;
    const page = firstPageRef.current;

    if (!viewer || !page) {
      return null;
    }

    const byWidth = (viewer.clientWidth - FIT_MARGIN) / page.width;
    const byHeight = (viewer.clientHeight - FIT_MARGIN) / page.height;

    // a viewer with no size (not laid out yet) says nothing
    const fit = mode === "width" ? byWidth : Math.min(byWidth, byHeight);

    return fit > 0 ? clampPdfZoom(fit) : null;
  }, []);

  // the document opens fitted to the sidebar, so a page is whole at first sight
  useEffect(() => {
    if (status.state !== "ready" || fittedRef.current) {
      return;
    }

    fittedRef.current = true;

    const fit = fitZoom("width");

    if (fit) {
      onZoomChange?.(fit);
    }
  }, [status, fitZoom, onZoomChange]);

  // ctrl + wheel (and a pinch, which arrives as the same) zooms; a plain wheel
  // scrolls, as it does everywhere
  useEffect(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      fittedRef.current = true;
      onZoomChange?.(
        clampPdfZoom(
          zoomRef.current *
            (event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR),
        ),
      );
    };

    // not passive: a zoom must stop the page from zooming as well
    viewer.addEventListener("wheel", onWheel, { passive: false });

    return () => viewer.removeEventListener("wheel", onWheel);
  }, [onZoomChange]);

  // the middle button drags the page about; a plain drag is left to the
  // browser, so the text under it is selected (D-296, D-302)
  const panRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  /** the page under a point of the screen, if there is one */
  const sheetAt = (x: number, y: number) => {
    for (const sheet of containerRef.current?.querySelectorAll<HTMLElement>(
      ".app-doc-pdf-page",
    ) ?? []) {
      const rect = sheet.getBoundingClientRect();

      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return sheet;
      }
    }

    return null;
  };

  /** a box on the screen, as a box from the corner of the column of pages */
  const fromStage = (box: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }) => {
    const stage = stageRef.current?.getBoundingClientRect();

    return {
      x: box.left - (stage?.left ?? 0),
      y: box.top - (stage?.top ?? 0),
      width: box.right - box.left,
      height: box.bottom - box.top,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    if (event.button === 0) {
      const target = event.target as Element | null;

      // the choices under the box, and the scrollbars, are not the page
      if (target?.closest?.(".app-doc-pdf-regionbar")) {
        return;
      }

      const area = viewer.getBoundingClientRect();

      if (
        viewer.clientWidth &&
        (event.clientX > area.left + viewer.clientWidth ||
          event.clientY > area.top + viewer.clientHeight)
      ) {
        return;
      }

      const sheet = sheetAt(event.clientX, event.clientY);

      // a drag on a page draws a box, and a new box puts the old one away
      setRegion(null);
      setDraft(null);
      boxRef.current = sheet
        ? { sheet, x: event.clientX, y: event.clientY, box: null }
        : null;

      if (sheet) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }

      return;
    }

    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewer.scrollLeft,
      top: viewer.scrollTop,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewer = viewerRef.current;
    const start = panRef.current;
    const drawing = boxRef.current;

    if (viewer && start) {
      viewer.scrollLeft = start.left - (event.clientX - start.x);
      viewer.scrollTop = start.top - (event.clientY - start.y);
      return;
    }

    if (!drawing) {
      return;
    }

    // the box stays inside the page it was begun on
    const page = drawing.sheet.getBoundingClientRect();
    const x = clamp(event.clientX, page.left, page.right);
    const y = clamp(event.clientY, page.top, page.bottom);

    drawing.box = {
      left: Math.min(drawing.x, x),
      top: Math.min(drawing.y, y),
      right: Math.max(drawing.x, x),
      bottom: Math.max(drawing.y, y),
    };
    setDraft(fromStage(drawing.box));
  };

  const onPointerUp = () => {
    panRef.current = null;

    const drawing = boxRef.current;

    boxRef.current = null;
    setDraft(null);

    const box = drawing?.box;

    // a click draws no box
    if (
      !drawing ||
      !box ||
      box.right - box.left < MIN_BOX ||
      box.bottom - box.top < MIN_BOX
    ) {
      return;
    }

    const runs = pdfRegionRuns(drawing.sheet, box);
    const next: PdfRegion = {
      box: fromStage(box),
      text: runsText(runs),
      lines: mergeRuns(runs),
      picture: () => cropPage(drawing.sheet, box),
    };

    setRegion(next);
    onRegion?.(next);
  };

  const onPointerCancel = () => {
    panRef.current = null;
    boxRef.current = null;
    setDraft(null);
  };

  const fit = (mode: "width" | "page") => {
    const next = fitZoom(mode);

    fittedRef.current = true;

    if (next) {
      onZoomChange?.(next);
    }
  };

  /**
   * Reads the page the teacher is on (D-302): the one that most of the viewer
   * shows, or the first when nothing says (a viewer with no layout).
   */
  const readCurrentPage = () => {
    const viewer = viewerRef.current;
    const pages = containerRef.current;

    if (!viewer || !pages || !onReadPage) {
      return;
    }

    const view = viewer.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let most = 0;

    for (const sheet of pages.querySelectorAll<HTMLElement>(
      ".app-doc-pdf-page",
    )) {
      const rect = sheet.getBoundingClientRect();
      const shown =
        Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);

      if (shown > most) {
        best = sheet;
        most = shown;
      }
    }

    const canvas = (
      best ?? pages.querySelector<HTMLElement>(".app-doc-pdf-page")
    )?.querySelector("canvas");

    if (!canvas) {
      return;
    }

    onReadPage({
      dataURL: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    });
  };

  // The pages are drawn, and drawn again when the zoom changes - and for no
  // other reason (D-307): drawing them replaces every page, which sends the
  // viewer back to the top and loses the selection, so nothing the host passes
  // in may be a dependency here.
  useEffect(() => {
    const container = containerRef.current;
    const doc = documentRef.current;
    const pdfjs = jsRef.current;

    if (status.state !== "ready" || !container || !doc || !pdfjs) {
      return;
    }

    let cancelled = false;

    container.replaceChildren();
    // the pages are new, so a box on the old ones has nothing under it
    setRegion(null);

    (async () => {
      for (let index = 1; index <= status.shown; index++) {
        if (cancelled) {
          return;
        }

        const page = await doc.getPage(index);
        const viewport = page.getViewport({ scale: BASE_SCALE * zoom });
        const ratio = window.devicePixelRatio || 1;

        const sheet = document.createElement("div");

        sheet.className = "app-doc-pdf-page";
        sheet.dataset.page = String(index);
        sheet.style.width = `${viewport.width}px`;
        sheet.style.height = `${viewport.height}px`;

        const canvas = document.createElement("canvas");

        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const text = document.createElement("div");

        text.className = "app-doc-pdf-text";
        text.style.setProperty("--scale-factor", String(viewport.scale));

        sheet.append(canvas, text);
        container.append(sheet);

        const context = canvas.getContext("2d");

        if (context) {
          await page.render({
            canvasContext: context,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          }).promise;
        }

        // the text on top of the picture is real text: it can be selected
        await new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: text,
          viewport,
        }).render();

        // a page with no text on it (a scan) cannot be selected from: it says
        // so, and the way to read it is not hidden (D-287)
        const scanned = !text.querySelector("span");

        if (scanned) {
          sheet.classList.add("app-doc-pdf-page--scan");

          const note = document.createElement("div");

          note.className = "app-doc-pdf-scan";
          note.dataset.testid = "pdf-scan-note";
          note.textContent =
            "No text to select on this page - it looks scanned. Read it with the toolbar's Read this page.";
          sheet.append(note);
        }
      }
    })().catch((error) => {
      if (!cancelled) {
        setStatus({
          state: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [status, zoom, containerRef]);

  const toolbar = (
    <div className="app-doc-pdf-tools" data-testid="pdf-tools">
      <button
        type="button"
        className="app-sidebar-icon"
        data-testid="pdf-fit-width"
        title="Fit width"
        aria-label="Fit width"
        onClick={() => fit("width")}
      >
        <SidebarIcon name="fitWidth" />
      </button>
      <button
        type="button"
        className="app-sidebar-icon"
        data-testid="pdf-fit-page"
        title="Fit page"
        aria-label="Fit page"
        onClick={() => fit("page")}
      >
        <SidebarIcon name="fitPage" />
      </button>
      {onReadPage ? (
        <>
          <button
            type="button"
            className="app-sidebar-icon"
            data-testid="pdf-read-page"
            title="Read this page (the text of the page you are on, with OCR)"
            aria-label="Read this page"
            onClick={readCurrentPage}
          >
            <SidebarIcon name="readPage" />
          </button>
          <OcrEnginePicker />
        </>
      ) : null}
    </div>
  );

  // where the choices under the box go (D-314): under it, on the pages, and
  // above it when there is no room below
  const stage = stageRef.current;
  const shown = draft ?? region?.box ?? null;
  const bar = (() => {
    if (!region) {
      return null;
    }

    // a viewer that has no size yet has room for everything
    const room = stage?.clientHeight || Infinity;
    const below = region.box.y + region.box.height + REGION_BAR_GAP;

    return {
      left: clamp(
        region.box.x,
        0,
        Math.max(0, (stage?.clientWidth || Infinity) - REGION_BAR_WIDTH),
      ),
      top:
        below + REGION_BAR_HEIGHT <= room
          ? below
          : Math.max(0, region.box.y - REGION_BAR_HEIGHT - REGION_BAR_GAP),
    };
  })();

  return (
    <div
      ref={viewerRef}
      className="app-doc-pdf-viewer"
      data-testid="pdf-viewer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {toolbarHost === undefined
        ? toolbar
        : toolbarHost
        ? createPortal(toolbar, toolbarHost)
        : null}
      {status.state === "loading" ? (
        <div className="app-doc-fallback" data-testid="pdf-loading">
          Opening the PDF…
        </div>
      ) : null}
      {status.state === "failed" ? (
        <div className="app-doc-fallback" data-testid="pdf-failed">
          The PDF could not be opened: {status.reason}
        </div>
      ) : null}
      {status.state === "ready" && status.pages > status.shown ? (
        <div className="app-doc-note" data-testid="pdf-capped">
          Only the first {status.shown} of {status.pages} pages are shown.
        </div>
      ) : null}
      <div ref={stageRef} className="app-doc-pdf-stage">
        <div
          ref={containerRef}
          className="app-doc-pdf-pages"
          data-testid="pdf-pages"
        />
        {shown ? (
          <div
            className="app-doc-pdf-box"
            data-testid="pdf-box"
            style={{
              left: shown.x,
              top: shown.y,
              width: shown.width,
              height: shown.height,
            }}
          />
        ) : null}
        {region && bar && renderRegionBar ? (
          <div
            className="app-doc-pdf-regionbar"
            data-testid="pdf-region-bar"
            style={{ left: bar.left, top: bar.top }}
          >
            {renderRegionBar(region, () => setRegion(null))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
