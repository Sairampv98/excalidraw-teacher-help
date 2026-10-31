/**
 * The shape library as tools (D-407): what it holds, and putting an item of it on
 * a page. Adding to it is the editor's own action, `addToLibrary`, through
 * `run_action`.
 */

import {
  CaptureUpdateAction,
  duplicateElements,
  getCommonBounds,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { stampCurrentPage } from "../scene/pages";

import {
  argsOf,
  fail,
  readInteger,
  readNumber,
  readString,
  resolvePage,
  summarize,
} from "./common";

import type { McpApp } from "./common";

export const libraryList = async (app: McpApp) => {
  const items = await app.library.getLatestLibrary();

  return {
    items: items.map((item) => {
      const [minX, minY, maxX, maxY] = getCommonBounds(item.elements);

      return {
        id: item.id,
        name: item.name ?? null,
        elements: item.elements.length,
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
      };
    }),
  };
};

export const libraryInsert = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const id = readString(args, "id", { required: true })!;
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const x = readNumber(args.x, "x") ?? 100;
  const y = readNumber(args.y, "y") ?? 100;
  const items = await app.library.getLatestLibrary();
  const item = items.find((candidate) => candidate.id === id);

  if (!item) {
    return fail(
      "not-found",
      `No library item ${id}. library_list shows what the library holds.`,
    );
  }

  const [minX, minY] = getCommonBounds(item.elements);
  const { duplicatedElements } = duplicateElements({
    elements: item.elements,
    type: "everything",
    randomizeSeed: true,
    overrides: ({ origElement }) => ({
      x: origElement.x - minX + entry.rect.x + x,
      y: origElement.y - minY + entry.rect.y + y,
    }),
  });

  stampCurrentPage(duplicatedElements as ExcalidrawElement[], entry.page.id);

  app.updateScene({
    elements: [
      ...app.scene.getElementsIncludingDeleted(),
      ...duplicatedElements,
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    page: entry.number,
    created: duplicatedElements.map((element) => summarize(app, element)),
  };
};
