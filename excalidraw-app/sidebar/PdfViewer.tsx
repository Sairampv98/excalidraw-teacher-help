import { useEffect, useRef, useState } from "react";

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
  containerRef,
  loader = loadPdfJs,
  onReadPage,
}: {
  file: File;
  /** 1 is 100% */
  zoom: number;
  /** the element a selection has to lie in, for the selection bar */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** how pdf.js is fetched; a test hands in its own */
  loader?: () => Promise<PdfJs>;
  /** the teacher asked for the text of a page to be read (OCR) */
  onReadPage?: (picture: PdfPagePicture) => void;
}) => {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const documentRef = useRef<PdfDocumentProxy | null>(null);
  const jsRef = useRef<PdfJs | null>(null);

  // the file is read and opened once
  useEffect(() => {
    let cancelled = false;

    setStatus({ state: "loading" });

    (async () => {
      try {
        const [pdfjs, bytes] = await Promise.all([
          loader(),
          file.arrayBuffer(),
        ]);

        const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) })
          .promise;

        if (cancelled) {
          void doc.destroy?.();
          return;
        }

        jsRef.current = pdfjs;
        documentRef.current = doc;
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
    <div className="app-doc-pdf-viewer" data-testid="pdf-viewer">
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
