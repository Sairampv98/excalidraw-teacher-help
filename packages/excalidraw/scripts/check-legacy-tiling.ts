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
const { getPageRect, paginateContentIntoPages } = await import(
  "../scene/pages"
);
const { DEFAULT_PAGE_ID } = await import("../types");
const { getCommonBounds } = await import("@excalidraw/element");

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
    tiled.filter((element) => element.pageId === page.id && !element.isDeleted)
      .length,
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

// an element whose box sticks out of its page's rect. The box is the
// library's own bounds — what the renderer draws and what the camera clamp
// has to cover — not the element's stored `x`/`y`/`width`/`height`, which for
// a free-draw stroke is not the same thing.
const TOLERANCE = 1e-6;

const overflow = tiled.map((element) => {
  if (element.isDeleted || element.floating) {
    return 0;
  }

  const rect = getPageRect(pages, element.pageId);
  const [minX, minY, maxX, maxY] = getCommonBounds([element]);

  return Math.max(
    rect.x - minX,
    rect.y - minY,
    maxX - (rect.x + rect.width),
    maxY - (rect.y + rect.height),
    0,
  );
});

const offPage = overflow.filter((over) => over > TOLERANCE);

console.info(
  `off-page:        ${offPage.length} (worst ${Math.max(...offPage)}px)`,
);

// the page sizes, so a page that had to grow for its content is visible
console.info(
  `page sizes:      ${pages
    .map(
      (page) =>
        `${Math.round(page.width ?? 0)}x${Math.round(page.height ?? 0)}`,
    )
    .join(", ")}`,
);

// the offenders, with the detail that explains them
const offenders = tiled
  .map((element, index) => ({ element, over: overflow[index] }))
  .filter((entry) => entry.over > 0)
  .slice(0, 5);

for (const { element, over } of offenders) {
  const rect = getPageRect(pages, element.pageId);
  const bounds = getCommonBounds([element]);

  console.info(
    `  ${element.type} x=${element.x} y=${element.y} w=${element.width} h=${
      element.height
    } bounds=${bounds.join(",")} page=${element.pageId} rect=${rect.x},${
      rect.y
    },${rect.width},${rect.height} over=${over}`,
  );
}
