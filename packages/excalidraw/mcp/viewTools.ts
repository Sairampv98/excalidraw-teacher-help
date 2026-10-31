/**
 * The tools that move the view and look at the board (D-400): select, go to a
 * page, and a picture of what is there for a model that can see.
 */

import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getPapersForExport } from "../data";
import { exportToCanvas } from "../scene/export";
import { getPageDecoration } from "../scene/pages";

import {
  argsOf,
  elementsFor,
  fail,
  liveElementsById,
  readIds,
  readInteger,
  resolvePage,
} from "./common";

import type { McpApp } from "./common";

export const selectElements = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids", { required: true })!;
  const elements = elementsFor(app, ids);

  app.setState({
    selectedElementIds: Object.fromEntries(
      elements.map((element) => [element.id, true as const]),
    ),
    selectedGroupIds: {},
    editingGroupId: null,
  });

  return { selected: elements.map((element) => element.id) };
};

export const goToPage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const number = readInteger(args, "page", { min: 1 });

  if (number === undefined) {
    return fail("bad-arguments", "page is required.");
  }

  const entry = resolvePage(app, number);

  app.setState({ currentPageId: entry.page.id });

  return { page: entry.number, name: entry.page.name };
};

const DEFAULT_SIZE = 1200;

/** a base64 string of a PNG, without the data: prefix */
const pngOf = (canvas: HTMLCanvasElement) =>
  canvas.toDataURL("image/png").split(",")[1] ?? "";

export const screenshot = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const scope = args.scope ?? "page";
  const maxSize =
    readInteger(args, "maxSize", { min: 200, max: 2400 }) ?? DEFAULT_SIZE;
  const state = {
    ...app.state,
    exportBackground: true,
    exportWithDarkMode: false,
  };
  const files = app.files;
  const live = app.scene.getNonDeletedElements();

  const canvasAt =
    (scale: (width: number, height: number) => number) =>
    (width: number, height: number) => {
      const factor = scale(width, height);
      const canvas = document.createElement("canvas");

      canvas.width = Math.max(1, Math.round(width * factor));
      canvas.height = Math.max(1, Math.round(height * factor));

      return { canvas, scale: factor };
    };

  if (scope === "page") {
    const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
    const onPage = live.filter((element) => element.pageId === entry.page.id);
    const canvas = await exportToCanvas(
      onPage,
      state,
      files,
      {
        exportBackground: true,
        viewBackgroundColor: state.viewBackgroundColor,
        pageRect: entry.rect,
        pageDecoration: getPageDecoration({
          pages: state.pages,
          pageId: entry.page.id,
        }),
        pagePapers: getPapersForExport(onPage, state),
      },
      canvasAt((width, height) => maxSize / Math.max(width, height)),
    );

    return {
      page: entry.number,
      images: [{ data: pngOf(canvas), mimeType: "image/png" }],
    };
  }

  let elements: ExcalidrawElement[];

  if (scope === "selection") {
    const selected = Object.keys(state.selectedElementIds).filter(
      (id) => state.selectedElementIds[id],
    );

    elements = selected.length ? elementsFor(app, selected) : [];

    if (!elements.length) {
      return fail("not-found", "Nothing is selected.");
    }
  } else if (scope === "elements") {
    elements = elementsFor(app, readIds(args, "ids", { required: true })!);
  } else {
    return fail("bad-arguments", "scope must be page, selection or elements.");
  }

  // the text bound to a shape is drawn with it
  const map = liveElementsById(app);
  const withText = new Map<string, ExcalidrawElement>();

  for (const element of elements) {
    withText.set(element.id, element);

    for (const bound of element.boundElements ?? []) {
      const text = bound.type === "text" ? map.get(bound.id) : undefined;

      if (text) {
        withText.set(text.id, text);
      }
    }
  }

  const drawn = [...withText.values()];
  const [minX, minY, maxX, maxY] = getCommonBounds(drawn);
  const canvas = await exportToCanvas(
    drawn as never,
    state,
    files,
    {
      exportBackground: true,
      viewBackgroundColor: state.viewBackgroundColor,
      exportPadding: 20,
    },
    canvasAt(() =>
      Math.min(2, maxSize / Math.max(maxX - minX + 40, maxY - minY + 40)),
    ),
  );

  return { images: [{ data: pngOf(canvas), mimeType: "image/png" }] };
};
