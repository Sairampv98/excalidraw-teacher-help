import {
  exportToCanvas,
  getOrderedElementsForPage,
  getPageRect,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { buildPdf, encodeCanvasForPdf } from "./pdf";

import type { PdfPageImage } from "./pdf";

/**
 * Multi-page export.
 *
 * Every page is rendered at exactly PAGE_WIDTH x PAGE_HEIGHT (scale 1) using
 * only that page's elements, and the rasters are stitched into a **single
 * multi-page PDF** — one file, one page each, in page order.
 *
 * The PDF is assembled by `pages/pdf.ts` rather than by a PDF library: a page
 * here is a flat raster, so a PDF page is just an image, and a small hand-written
 * writer avoids adding a dependency for the sake of a feature this narrow.
 */

const PAGE_EXPORT_SCALE = 1;

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // give the browser a tick to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** filesystem-safe slug for the file name */
const slugify = (value: string) =>
  value
    .trim()
    .replace(/[^\w\d\-. ]+/g, "")
    .replace(/\s+/g, "-") || "excalidraw";

export const exportAllPages = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  { baseName = "excalidraw" }: { baseName?: string } = {},
) => {
  const appState = excalidrawAPI.getAppState();
  const files = excalidrawAPI.getFiles();
  const allElements = excalidrawAPI.getSceneElements();

  if (!appState.pages.length) {
    return;
  }

  // scale 1 so every page comes out at exactly PAGE_WIDTH x PAGE_HEIGHT
  const exportAppState = { ...appState, exportScale: PAGE_EXPORT_SCALE };

  const images: PdfPageImage[] = [];

  for (const page of appState.pages) {
    const pageElements = getOrderedElementsForPage(allElements, page.id);

    const canvas = await exportToCanvas({
      elements: pageElements,
      appState: exportAppState,
      files,
      // the page's own rect — pages may differ in size, so the index alone
      // does not tell us where the page sits
      pageRect: getPageRect(appState.pages, page.id),
    });

    images.push(await encodeCanvasForPdf(canvas));
  }

  const pdf = buildPdf({ pages: images });

  downloadBlob(
    new Blob([pdf as BlobPart], { type: "application/pdf" }),
    `${slugify(baseName)}.pdf`,
  );
};
