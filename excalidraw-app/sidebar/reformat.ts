import { getCommonBounds, newElementWith } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { insertCodeIntoScene } from "./insertIntoScene";
import {
  insertTableIntoScene,
  normaliseRows,
  readTableCells,
  tableColumnCount,
} from "./table";

/** the formats a selection can be reformatted into */
export type ReformatFormat = "codeCard" | "table";

export const REFORMATS: { id: ReformatFormat; label: string }[] = [
  { id: "codeCard", label: "Code card" },
  { id: "table", label: "Table" },
];

/**
 * The text of the selection: the text of its text elements, in scene order,
 * one per line.
 */
export const selectionText = (elements: readonly ExcalidrawElement[]): string =>
  elements
    .filter(
      (element): element is ExcalidrawTextElement => element.type === "text",
    )
    .map((element) => element.text)
    .join("\n");

/**
 * Where the reformatted content goes: the selection's own top-left corner,
 * measured with the library's own bounds helper.
 */
export const selectionTopLeft = (
  elements: readonly ExcalidrawElement[],
): { x: number; y: number } => {
  const [x, y] = getCommonBounds(elements);

  return { x, y };
};

/**
 * Removes the elements the reformat replaced.
 *
 * They are marked deleted rather than dropped, the way the editor's own delete
 * does it, so the scene keeps them (and the undo stack can bring them back).
 */
const deleteElements = (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
) => {
  const ids = new Set(elements.map((element) => element.id));

  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((element) =>
        ids.has(element.id)
          ? newElementWith(element, { isDeleted: true })
          : element,
      ),
  });
};

/**
 * Reformats the selection into a code card — the very same card the sidebar's
 * Insert button builds, with the app's own highlighter.
 *
 * A selection carries no filename, so there is no language to read: the
 * app's plain-text language is used, which is what the app's own plain-text
 * inserts use.
 */
export const reformatSelectionAsCodeCard = async (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
) => {
  const code = selectionText(elements);

  if (!code.trim()) {
    return false;
  }

  await insertCodeIntoScene(api, code, {
    language: "text",
    topLeft: selectionTopLeft(elements),
  });

  // the reformatted content replaces the selection
  deleteElements(api, elements);

  return true;
};

/**
 * Reformats the selection into a table: the cells are recovered from the
 * lines of the selection, laid out on a grid and drawn — a rectangle per cell,
 * with ordinary, selectable text on top of it.
 */
export const reformatSelectionAsTable = (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
) => {
  const text = selectionText(elements);

  if (!text.trim()) {
    return false;
  }

  const { rows, markdown } = readTableCells(text.split("\n"));
  const columns = tableColumnCount(rows, markdown);

  if (!columns) {
    return false;
  }

  const table = insertTableIntoScene(
    api,
    normaliseRows(rows, columns),
    selectionTopLeft(elements),
  );

  if (!table) {
    return false;
  }

  // the reformatted content replaces the selection
  deleteElements(api, elements);

  return true;
};

/**
 * Reformats the selection into the chosen format.
 */
export const reformatSelection = async (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
  format: ReformatFormat,
) => {
  if (format === "table") {
    return reformatSelectionAsTable(api, elements);
  }

  return reformatSelectionAsCodeCard(api, elements);
};
