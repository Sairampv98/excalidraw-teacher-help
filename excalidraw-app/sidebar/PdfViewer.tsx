import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TextStyleRun } from "@excalidraw/element/types";

import { OcrEnginePicker } from "../components/OcrEnginePicker";
import { ENGINE_FILES, engineUrl } from "../engines/enginePaths";

import { mergeRuns, pdfRegionRuns, runsStyledText } from "./pdfSelection";

import { SidebarIcon } from "./SidebarIcons";

import type { StyledLine } from "./pdfSelection";

import type { ReactNode } from "react";

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
 * pdf.js is not a dependency of the app. It is a file the app carries beside
 * its own (D-460), loaded the first time a PDF is opened, so a teacher who
 * never opens a PDF never pays for it - and it works with no internet.
 */

/** the version of pdf.js that is fetched, pinned */
export const PDFJS_VERSION = "4.10.38";

/** the engine is carried by the app (D-460), the version it was fetched at is in `scripts/vendor/engines.manifest.json` */

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

/**
 * A page is drawn when it is near the view: a screen's height above it and
 * below it (D-319). Pages further off keep their room but give their pixels
 * back.
 */
const NEAR_VIEW_MARGIN = "100% 0px";

/** a viewer that cannot tell what is near (no IntersectionObserver) draws these */
const FALLBACK_PAGES = 4;

/** the most pixels a page's canvas has; the browser stretches it beyond that */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

/** how long a change of the zoom has to be left alone before pages are drawn */
const ZOOM_SETTLE_MS = 60;

/**
 * The picture of a part of a page is drawn again from the PDF (D-316): at six
 * times the size of the page, or less when its long edge would pass this many
 * pixels.
 */
const PICTURE_SCALE = 6;
const PICTURE_MAX_EDGE = 4096;

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
  }) => { promise: Promise<void>; cancel?: () => void };
  streamTextContent: () => unknown;
  /**
   * The text of the page with the font of each piece (D-321). A stand-in may
   * not have it, and then the text is shown without its styles.
   */
  getTextContent?: () => Promise<PdfTextContent>;
  /** the fonts the page has drawn */
  commonObjs?: {
    has: (id: string) => boolean;
    get: (id: string) => PdfFont | undefined;
  };
};

/** the text of a page: a piece of it is a string in a font */
export type PdfTextContent = {
  items: Array<{ str?: string; fontName?: string; hasEOL?: boolean }>;
  styles?: Record<string, { fontFamily?: string }>;
};

/** what pdf.js knows of a font that has been drawn */
export type PdfFont = {
  name?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
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
  }) => {
    render: () => Promise<void>;
    /** the element of each piece of the text, and what each says */
    textDivs?: HTMLElement[];
    textContentItemsStr?: string[];
  };
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

  loading ??= import(/* @vite-ignore */ engineUrl(ENGINE_FILES.pdfjs.module))
    .then((module: PdfJs) => {
      module.GlobalWorkerOptions.workerSrc = engineUrl(
        ENGINE_FILES.pdfjs.worker,
      );

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

const BOLD_FONT_NAME = /bold|black|heavy|semibold|demi/i;
const ITALIC_FONT_NAME = /italic|oblique/i;

/**
 * Says which pieces of a page's text are bold or italic (D-321): each piece of
 * the text layer is marked with the style of the font it is set in, and a box
 * that covers it carries the mark over to the text it makes.
 *
 * The font is what pdf.js knows of it once the page is drawn; where that says
 * nothing, its name does (`Arial-BoldItalicMT`). The pieces of the layer are the
 * pieces of the text that are not empty, in order; if they do not line up with
 * them, nothing is marked rather than the wrong things.
 */
const markFontStyles = (
  page: PdfPageProxy,
  content: PdfTextContent,
  layer: { textDivs?: HTMLElement[]; textContentItemsStr?: string[] },
) => {
  const divs = layer.textDivs;
  const pieces = content.items.filter((item) => !!item.str);

  if (
    !divs ||
    divs.length !== pieces.length ||
    pieces.some(
      (item, index) => layer.textContentItemsStr?.[index] !== item.str,
    )
  ) {
    return;
  }

  const known = new Map<string, { bold: boolean; italic: boolean }>();

  const styleOfFont = (fontName: string | undefined) => {
    if (!fontName) {
      return { bold: false, italic: false };
    }

    let style = known.get(fontName);

    if (!style) {
      let font: PdfFont | undefined;

      try {
        font = page.commonObjs?.has(fontName)
          ? page.commonObjs.get(fontName)
          : undefined;
      } catch {
        font = undefined;
      }

      const named = `${font?.name ?? ""} ${
        content.styles?.[fontName]?.fontFamily ?? ""
      }`;

      style = {
        bold:
          font?.bold === true ||
          font?.black === true ||
          BOLD_FONT_NAME.test(named),
        italic: font?.italic === true || ITALIC_FONT_NAME.test(named),
      };
      known.set(fontName, style);
    }

    return style;
  };

  pieces.forEach((item, index) => {
    const { bold, italic } = styleOfFont(item.fontName);

    if (bold) {
      divs[index].dataset.bold = "true";
    }

    if (italic) {
      divs[index].dataset.italic = "true";
    }
  });
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
  /** the parts of `text` that are bold or italic in the PDF (D-321) */
  styleRuns: TextStyleRun[];
  /** the same text, a piece to a line, each where it was on its page (D-301) */
  lines: StyledLine[];
  /** the part of the page in the box, as a picture of the best sharpness (D-316) */
  picture: () => Promise<PdfPagePicture | null>;
};

/** a box smaller than this is a click, not a selection */
const MIN_BOX = 6;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/**
 * The part of a drawn page that a box covers, as a picture of the pixels the
 * viewer drew. It is what is taken when the page cannot be drawn again.
 *
 * `box` is from the corner of the sheet, in css pixels, and `size` is the size
 * the sheet had when the box was drawn.
 */
const cropPage = (
  sheet: HTMLElement,
  size: { width: number; height: number },
  box: { left: number; top: number; right: number; bottom: number },
): PdfPagePicture | null => {
  const canvas = sheet.querySelector("canvas");

  if (!canvas || !canvas.width || !size.width || !size.height) {
    return null;
  }

  // the canvas has more pixels than the page has css pixels on a sharp screen
  const scaleX = canvas.width / size.width;
  const scaleY = canvas.height / size.height;
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
    box.left * scaleX,
    box.top * scaleY,
    width,
    height,
    0,
    0,
    width,
    height,
  );

  return { dataURL: cut.toDataURL("image/png"), width, height };
};

/**
 * The part of a page that a box covers, drawn again from the PDF (D-316).
 *
 * The part is found in the page's own units, so the picture is the same at any
 * zoom of the viewer: the page is `size` big on the screen and `unit` big at a
 * scale of 1. Only the part is drawn - the canvas is as big as the part and the
 * page is moved under it - so a big scale costs what the part costs and not
 * what the whole page does.
 */
const drawPicture = async (
  page: PdfPageProxy,
  size: { width: number; height: number },
  box: { left: number; top: number; right: number; bottom: number },
): Promise<PdfPagePicture | null> => {
  const unit = page.getViewport({ scale: 1 });
  const perPixel = unit.width / size.width;

  const left = box.left * perPixel;
  const top = box.top * perPixel;
  const width = (box.right - box.left) * perPixel;
  const height = (box.bottom - box.top) * perPixel;

  const scale = Math.min(
    PICTURE_SCALE,
    PICTURE_MAX_EDGE / Math.max(width, height),
  );
  const pixelsWide = Math.max(1, Math.round(width * scale));
  const pixelsHigh = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");

  canvas.width = pixelsWide;
  canvas.height = pixelsHigh;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  await page.render({
    canvasContext: context,
    viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -left * scale, -top * scale],
  }).promise;

  return {
    dataURL: canvas.toDataURL("image/png"),
    width: pixelsWide,
    height: pixelsHigh,
  };
};

/** the size of the row of choices under a box, in css pixels */
const REGION_BAR = { width: 220, height: 36, gap: 6 };

/**
 * Where the row of choices goes (D-318): under the box when there is room for it
 * in the part of the pages that is shown, else over the box, else at the bottom
 * of what is shown - and never further to the left or to the right than that.
 */
export const placeRegionBar = (
  box: { x: number; y: number; width: number; height: number },
  shown: { left: number; top: number; right: number; bottom: number },
  bar: { width: number; height: number; gap: number } = REGION_BAR,
) => {
  const left = clamp(
    box.x,
    shown.left,
    Math.max(shown.left, shown.right - bar.width),
  );

  const under = box.y + box.height + bar.gap;
  const over = box.y - bar.height - bar.gap;
  let top = under;

  if (under + bar.height > shown.bottom) {
    top = over >= shown.top ? over : shown.bottom - bar.height - bar.gap;
  }

  return { left, top: Math.max(top, shown.top) };
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
  /** where the choices under that box go, from the corner of the pages (D-318) */
  const [barAt, setBarAt] = useState<{ left: number; top: number } | null>(
    null,
  );
  /** the box while it is being drawn */
  const [draft, setDraft] = useState<PdfRegion["box"] | null>(null);
  /** the file the pages were last made for, to keep the view when it is the same */
  const builtFor = useRef<File | null>(null);
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

      // The toolbar is drawn into the row of the zoom, outside the part that
      // scrolls, but React hands this handler its presses too (a portal's
      // events go to the component that made it). A press on a button of it
      // is not a press on a page: with the pages scrolled, one of them lies
      // under the toolbar, and taking the press for the start of a box on it
      // captured the pointer and swallowed the click - so Read this page only
      // worked at the very top (D-346).
      if (target && !viewer.contains(target)) {
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
    const styled = runsStyledText(runs);

    // the box is kept from the corner of its page, so that it is the same part
    // of the page whatever the viewer is scrolled to when its picture is asked
    const page = drawing.sheet.getBoundingClientRect();
    const size = { width: page.width, height: page.height };
    const onPage = {
      left: box.left - page.left,
      top: box.top - page.top,
      right: box.right - page.left,
      bottom: box.bottom - page.top,
    };

    const next: PdfRegion = {
      box: fromStage(box),
      ...styled,
      lines: mergeRuns(runs),
      picture: async () => {
        const doc = documentRef.current;
        const index = Number(drawing.sheet.dataset.page);

        if (doc && index && size.width && size.height) {
          try {
            const sharp = await drawPicture(
              await doc.getPage(index),
              size,
              onPage,
            );

            if (sharp) {
              return sharp;
            }
          } catch (error) {
            console.error(error);
          }
        }

        // the page cannot be drawn again: the pixels the viewer drew are taken
        return cropPage(drawing.sheet, size, onPage);
      },
    };

    // the choices are put against the part of the pages that is shown (D-318)
    const viewer = viewerRef.current;
    const area = viewer?.getBoundingClientRect();
    const stage = stageRef.current?.getBoundingClientRect();
    const left = area && stage ? area.left - stage.left : 0;
    const top = area && stage ? area.top - stage.top : 0;
    const shown =
      viewer?.clientWidth && viewer.clientHeight
        ? {
            left,
            top,
            right: left + viewer.clientWidth,
            bottom: top + viewer.clientHeight,
          }
        : { left: 0, top: 0, right: Infinity, bottom: Infinity };

    setRegion(next);
    setBarAt(placeRegionBar(next.box, shown));
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

    const sheet = best ?? pages.querySelector<HTMLElement>(".app-doc-pdf-page");
    const canvas = sheet?.querySelector("canvas");

    if (canvas) {
      onReadPage({
        dataURL: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
      });

      return;
    }

    // a page that is not drawn (it has not come near the view yet) is drawn
    // for the read, whole, from the PDF (D-319)
    const doc = documentRef.current;
    const index = Number(sheet?.dataset.page);
    const size = sheet?.getBoundingClientRect();

    if (!doc || !index || !size?.width || !size.height) {
      return;
    }

    void doc
      .getPage(index)
      .then((page) =>
        drawPicture(
          page,
          { width: size.width, height: size.height },
          { left: 0, top: 0, right: size.width, bottom: size.height },
        ),
      )
      .then((picture) => picture && onReadPage(picture))
      .catch((error) => console.error(error));
  };

  // The pages (D-319, D-307): every page has its room at once, and only the
  // pages near the view are drawn. They are made again when the zoom changes -
  // and for no other reason: making them again sends the viewer back to the top
  // and loses what was drawn, so nothing the host passes in may be a dependency
  // here.
  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    const doc = documentRef.current;
    const pdfjs = jsRef.current;
    const first = firstPageRef.current;

    if (status.state !== "ready" || !container || !doc || !pdfjs || !first) {
      return;
    }

    let cancelled = false;
    const scale = BASE_SCALE * zoom;

    // the part of this document that is at the middle of the view, to keep it
    // there when the zoom changes (another document starts at its top)
    const middle =
      viewer &&
      viewer.scrollHeight &&
      viewer.scrollWidth &&
      builtFor.current === file
        ? {
            x:
              (viewer.scrollLeft + viewer.clientWidth / 2) / viewer.scrollWidth,
            y:
              (viewer.scrollTop + viewer.clientHeight / 2) /
              viewer.scrollHeight,
          }
        : null;

    builtFor.current = file;

    container.replaceChildren();
    // the pages are new, so a box on the old ones has nothing under it
    setRegion(null);

    // every page has its room at once: as big as the first until it is drawn
    const sheets: HTMLElement[] = [];

    for (let index = 1; index <= status.shown; index++) {
      const sheet = document.createElement("div");

      sheet.className = "app-doc-pdf-page";
      sheet.dataset.page = String(index);
      sheet.style.width = `${first.width * zoom}px`;
      sheet.style.height = `${first.height * zoom}px`;
      sheets.push(sheet);
    }

    container.append(...sheets);

    if (viewer && middle) {
      viewer.scrollTop =
        middle.y * viewer.scrollHeight - viewer.clientHeight / 2;
      viewer.scrollLeft =
        middle.x * viewer.scrollWidth - viewer.clientWidth / 2;
    }

    /** the pages that have their pixels */
    const drawn = new Set<HTMLElement>();
    /** the pages that are near the view */
    const wanted = new Set<HTMLElement>();
    let task: { cancel?: () => void } | null = null;

    const fail = (error: unknown) => {
      if (!cancelled) {
        setStatus({
          state: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    };

    /** a page gives its pixels back; its room stays */
    const release = (sheet: HTMLElement) => {
      for (const canvas of sheet.querySelectorAll("canvas")) {
        canvas.width = 0;
        canvas.height = 0;
      }

      sheet.replaceChildren();
      sheet.classList.remove("app-doc-pdf-page--scan");
      drawn.delete(sheet);
    };

    const draw = async (sheet: HTMLElement) => {
      if (drawn.has(sheet)) {
        return;
      }

      const page = await doc.getPage(Number(sheet.dataset.page));

      // the zoom changed, or the page went far from the view, meanwhile
      if (cancelled || !wanted.has(sheet)) {
        return;
      }

      const viewport = page.getViewport({ scale });

      sheet.style.width = `${viewport.width}px`;
      sheet.style.height = `${viewport.height}px`;

      // a canvas has only so many pixels: beyond them it is stretched
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
      );

      const canvas = document.createElement("canvas");

      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const text = document.createElement("div");

      text.className = "app-doc-pdf-text";
      text.style.setProperty("--scale-factor", String(viewport.scale));

      sheet.append(canvas, text);
      drawn.add(sheet);

      const context = canvas.getContext("2d");

      if (context) {
        const rendering = page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });

        task = rendering;

        try {
          await rendering.promise;
        } catch (error) {
          // a drawing that was stopped is not a failure
          if (cancelled || !wanted.has(sheet)) {
            return;
          }

          throw error;
        }
      }

      if (cancelled || !wanted.has(sheet)) {
        return;
      }

      // the text on top of the picture is real text: the box finds it there.
      // It is given with its fonts, so the pieces that are bold or italic in
      // the PDF are known (D-321)
      const content = page.getTextContent ? await page.getTextContent() : null;
      const layer = new pdfjs.TextLayer({
        textContentSource: content ?? page.streamTextContent(),
        container: text,
        viewport,
      });

      await layer.render();

      if (content) {
        markFontStyles(page, content, layer);
      }

      if (cancelled || !wanted.has(sheet)) {
        return;
      }

      // a page with no text on it (a scan) has nothing for a box to find: it
      // says so, and the way to read it is not hidden (D-287)
      if (!text.querySelector("span")) {
        sheet.classList.add("app-doc-pdf-page--scan");

        const note = document.createElement("div");

        note.className = "app-doc-pdf-scan";
        note.dataset.testid = "pdf-scan-note";
        note.textContent =
          "No text to select on this page - it looks scanned. Read it with the toolbar's Read this page.";
        sheet.append(note);
      }
    };

    // the pages are drawn one at a time, once the zoom has been left alone
    let settle: ReturnType<typeof setTimeout> | undefined;
    let queue = new Promise<void>((resolve) => {
      settle = setTimeout(resolve, ZOOM_SETTLE_MS);
    });

    const want = (sheet: HTMLElement) => {
      if (wanted.has(sheet)) {
        return;
      }

      wanted.add(sheet);
      queue = queue.then(() => draw(sheet)).catch(fail);
    };

    let observer: IntersectionObserver | null = null;

    if (typeof IntersectionObserver === "undefined") {
      sheets.slice(0, FALLBACK_PAGES).forEach(want);
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const sheet = entry.target as HTMLElement;

            if (entry.isIntersecting) {
              want(sheet);
            } else if (wanted.delete(sheet)) {
              release(sheet);
            }
          }
        },
        { root: viewer, rootMargin: NEAR_VIEW_MARGIN },
      );

      sheets.forEach((sheet) => observer?.observe(sheet));
    }

    return () => {
      cancelled = true;
      clearTimeout(settle);
      observer?.disconnect();
      task?.cancel?.();
    };
  }, [status, zoom, containerRef, file]);

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

  const shown = draft ?? region?.box ?? null;

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
        {region && barAt && renderRegionBar ? (
          <div
            className="app-doc-pdf-regionbar"
            data-testid="pdf-region-bar"
            style={{ left: barAt.left, top: barAt.top }}
          >
            {renderRegionBar(region, () => setRegion(null))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
