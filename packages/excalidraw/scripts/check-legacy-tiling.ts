/**
 * A one-off check, not a test: it runs `paginateContentIntoPages` against a
 * real legacy `.excalidraw` file and reports what came out.
 *
 * The file lives outside the repository (it is the user's own board), so it
 * cannot be part of the suite — loading 10 MB of JSON on every gate run is
 * not an option. The numbers it prints are the ones to compare the tiling
 * against reality with:
 *
 *     vite-node --config vitest.config.mts \
 *       packages/excalidraw/scripts/check-legacy-tiling.ts <file.excalidraw>
 *
 * The file defaults to the board the report was made on
 * (`C:/Users/user/projects/day-1.excalidraw`).
 */

import { readFileSync } from "node:fs";

import type { ExcalidrawElement } from "@excalidraw/element/types";

// the library reads `devicePixelRatio` when it loads; this script runs in
// node, not in a browser
globalThis.devicePixelRatio = 1;

const { restoreElements } = await import("../data/restore");
const { getPageRect, paginateContentIntoPages } = await import("../scene/pages");
const { DEFAULT_PAGE_ID } = await import("../types");

const file = process.argv[2] ?? "C:/Users/user/projects/day-1.excalidraw";

const data = JSON.parse(readFileSync(file, "utf8")) as {
  elements: ExcalidrawElement[];
};

// the import path's own restore — the elements come out stamped on the first
// page, exactly as they do when the file is opened
const elements = restoreElements(data.elements, null, {
  defaultPageId: DEFAULT_PAGE_ID,
});

const { elements: tiled, pages } = paginateContentIntoPages(elements);

const perPage = pages.map(
  (page) =>
    tiled.filter(
      (element) => element.pageId === page.id && !element.isDeleted,
    ).length,
);

const sorted = [...perPage].sort((a, b) => a - b);
const median = sorted.length
  ? sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  : 0;

const live = elements.filter((element) => !element.isDeleted).length;

console.info(`file:            ${file}`);
console.info(`elements:        ${elements.length} (${live} live)`);
console.info(`pages:           ${pages.length}`);
console.info(`per page:        max ${Math.max(...perPage)}, median ${median}`);
console.info(`counts:          ${perPage.join(", ")}`);

// an element whose origin is inside its page, but whose box sticks out of
// it (an element wider than the page, or one that straddles a cell border)
const overflow = tiled.map((element) => {
  if (element.isDeleted || element.floating) {
    return 0;
  }

  const rect = getPageRect(pages, element.pageId);

  return Math.max(
    rect.x - element.x,
    rect.y - element.y,
    element.x + element.width - (rect.x + rect.width),
    element.y + element.height - (rect.y + rect.height),
    0,
  );
});

const offPage = overflow.filter((over) => over > 0);

console.info(`off-page:        ${offPage.length} (worst ${Math.max(...offPage)}px)`);
