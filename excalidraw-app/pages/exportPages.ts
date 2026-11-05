import { buildPagesPdf } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Multi-page export.
 *
 * Every page is rendered at **its own** size (scale 1) using only that page's
 * elements, and the rasters are stitched into a **single multi-page PDF** —
 * one file, one page each, in page order.
 *
 * A page's size is a fact about the page (D-144): a page picked a preset comes
 * out in that preset's shape, and the page's frame and number (if it has
 * them) are drawn into the export, so the exported page looks like the page
 * the teacher sees.
 *
 * The PDF is assembled by the library's own writer rather than by a PDF
 * library: a page here is a flat raster, so a PDF page is just an image, and a
 * small hand-written writer avoids adding a dependency for the sake of a
 * feature this narrow. The writer lives in the library (D-438) so that the
 * assistant's handout is this very file.
 */

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

  const pdf = await buildPagesPdf({
    elements: allElements,
    appState,
    files,
    pages: appState.pages,
  });

  downloadBlob(
    new Blob([pdf as BlobPart], { type: "application/pdf" }),
    `${slugify(baseName)}.pdf`,
  );
};
