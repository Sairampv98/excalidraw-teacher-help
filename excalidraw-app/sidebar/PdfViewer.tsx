import { useCallback, useEffect, useRef, useState } from "react";

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

export const PdfViewer = ({
  file,
  zoom,
  onZoomChange,
  containerRef,
  loader = loadPdfJs,
  onReadPage,
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
}) => {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [hand, setHand] = useState(false);
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

  // the hand tool, and the middle button, drag the page about
  const panRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewer = viewerRef.current;

    if (!viewer || !(hand || event.button === 1)) {
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

    if (!viewer || !start) {
      return;
    }

    viewer.scrollLeft = start.left - (event.clientX - start.x);
    viewer.scrollTop = start.top - (event.clientY - start.y);
  };

  const onPointerUp = () => {
    panRef.current = null;
  };

  const fit = (mode: "width" | "page") => {
    const next = fitZoom(mode);

    fittedRef.current = true;

    if (next) {
      onZoomChange?.(next);
    }
  };

  // the pages are drawn, and drawn again when the zoom changes
  useEffect(() => {
    const container = containerRef.current;
    const doc = documentRef.current;
    const pdfjs = jsRef.current;

    if (status.state !== "ready" || !container || !doc || !pdfjs) {
      return;
    }

    let cancelled = false;

    container.replaceChildren();

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
            "No text to select on this page - it looks scanned.";
          sheet.append(note);
        }

        if (onReadPage) {
          const read = document.createElement("button");

          read.type = "button";
          read.className = "app-doc-pdf-read";
          read.textContent = "Read the text";
          read.title = "Read the text of this page with OCR";
          read.addEventListener("click", () => {
            onReadPage({
              dataURL: canvas.toDataURL("image/png"),
              width: canvas.width,
              height: canvas.height,
            });
          });
          sheet.append(read);
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
  }, [status, zoom, containerRef, onReadPage]);

  return (
    <div
      ref={viewerRef}
      className={`app-doc-pdf-viewer${hand ? " app-doc-pdf-viewer--hand" : ""}`}
      data-testid="pdf-viewer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="app-doc-pdf-tools" data-testid="pdf-tools">
        <button
          type="button"
          className="app-sidebar-secondary"
          data-testid="pdf-fit-width"
          title="Fit the page to the width of the panel"
          onClick={() => fit("width")}
        >
          Fit width
        </button>
        <button
          type="button"
          className="app-sidebar-secondary"
          data-testid="pdf-fit-page"
          title="Fit a whole page in the panel"
          onClick={() => fit("page")}
        >
          Fit page
        </button>
        <button
          type="button"
          className="app-sidebar-secondary"
          data-testid="pdf-hand"
          aria-pressed={hand}
          title="Drag the page about (or hold the middle button)"
          onClick={() => setHand((value) => !value)}
        >
          Hand
        </button>
      </div>
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
      <div
        ref={containerRef}
        className="app-doc-pdf-pages"
        data-testid="pdf-pages"
      />
    </div>
  );
};
