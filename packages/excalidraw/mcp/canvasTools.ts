/**
 * The tools of the canvas itself (D-405): its background, grid and snapping, the
 * view, the active tool, the search, the numbers of the stats panel, export, and
 * putting a saved document on a page.
 */

import { MAX_ZOOM } from "@excalidraw/common";
import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { actionChangeViewBackgroundColor } from "../actions/actionCanvas";
import { getPapersForExport } from "../data";
import { restoreElements } from "../data/restore";
import { isValidExcalidrawData, serializeAsJSON } from "../data/json";
import { exportToCanvas, exportToSvg } from "../scene/export";
import { insertDocumentIntoScene } from "../scene/insertDocument";
import { getCameraForPage, getPageDecoration } from "../scene/pages";

import { applyActions } from "./actionRunner";
import {
  argsOf,
  elementsFor,
  fail,
  isRecord,
  pageOfElement,
  readBoolean,
  readIds,
  readInteger,
  readNumber,
  readString,
  resolvePage,
  textsOf,
  toPageSpace,
  allPages,
} from "./common";

import type { McpApp } from "./common";

const THEMES = ["light", "dark"] as const;

/** a colour as the canvas takes it: a hex or a CSS name, kept short */
const COLOR = /^(#[0-9a-f]{3,8}|transparent|[a-z]{3,30})$/i;

export const setCanvas = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const state: Record<string, unknown> = {};
  const changed: string[] = [];
  const background = readString(args, "backgroundColor");
  const grid = readBoolean(args, "grid");
  const gridSize = readNumber(args.gridSize, "gridSize");
  const snapToObjects = readBoolean(args, "snapToObjects");
  const snapToMidpoints = readBoolean(args, "snapToMidpoints");
  const zen = readBoolean(args, "zen");
  const viewOnly = readBoolean(args, "viewOnly");
  const stats = readBoolean(args, "stats");
  const name = readString(args, "name");
  const theme = args.theme;

  if (background !== undefined) {
    if (!COLOR.test(background.trim())) {
      return fail(
        "bad-arguments",
        "backgroundColor must be a colour: a hex such as #ffffff.",
      );
    }

    await applyActions(
      app,
      [
        {
          action: actionChangeViewBackgroundColor,
          value: { viewBackgroundColor: background.trim() },
        },
      ],
      {},
    );
    changed.push("backgroundColor");
  }

  if (grid !== undefined) {
    state.gridModeEnabled = grid;
    changed.push("grid");
  }

  if (gridSize !== undefined) {
    if (gridSize < 2 || gridSize > 200) {
      return fail("bad-arguments", "gridSize must be a number from 2 to 200.");
    }

    state.gridSize = gridSize;
    changed.push("gridSize");
  }

  if (snapToObjects !== undefined) {
    state.objectsSnapModeEnabled = snapToObjects;
    changed.push("snapToObjects");
  }

  if (snapToMidpoints !== undefined) {
    state.isMidpointSnappingEnabled = snapToMidpoints;
    changed.push("snapToMidpoints");
  }

  if (theme !== undefined) {
    if (!(THEMES as readonly unknown[]).includes(theme)) {
      return fail("bad-arguments", "theme must be light or dark.");
    }

    state.theme = theme;
    changed.push("theme");
  }

  if (zen !== undefined) {
    state.zenModeEnabled = zen;
    changed.push("zen");
  }

  if (viewOnly !== undefined) {
    state.viewModeEnabled = viewOnly;
    changed.push("viewOnly");
  }

  if (stats !== undefined) {
    state.stats = { ...app.state.stats, open: stats };
    changed.push("stats");
  }

  if (name !== undefined) {
    if (name.length > 120) {
      return fail("bad-arguments", "name must be at most 120 characters.");
    }

    state.name = name;
    changed.push("name");
  }

  if (!changed.length) {
    return fail(
      "bad-arguments",
      "Say what to change: backgroundColor, grid, gridSize, snapToObjects, snapToMidpoints, theme, zen, viewOnly, stats or name.",
    );
  }

  if (Object.keys(state).length) {
    app.setState(state as never);
  }

  return { changed };
};

const TOOLS = [
  "selection",
  "lasso",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "eraser",
  "hand",
  "frame",
  "embeddable",
  "laser",
] as const;

export const setTool = (app: McpApp, rawArgs: unknown) => {
  const tool = argsOf(rawArgs).tool;

  if (!(TOOLS as readonly unknown[]).includes(tool)) {
    return fail("bad-arguments", `tool must be one of ${TOOLS.join(", ")}.`);
  }

  app.setActiveTool({ type: tool } as never);

  return { tool };
};

export const setView = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const fit = args.fit;
  const zoom = readNumber(args.zoom, "zoom");
  const center = args.center;

  if (
    fit !== undefined &&
    fit !== "page" &&
    fit !== "selection" &&
    fit !== "elements"
  ) {
    return fail("bad-arguments", "fit must be page, selection or elements.");
  }

  if (fit === "page") {
    const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
    const {
      zoom: pageZoom,
      scrollX,
      scrollY,
    } = getCameraForPage({
      viewportWidth: app.state.width,
      viewportHeight: app.state.height,
      pageRect: entry.rect,
      maxZoom: MAX_ZOOM,
    });

    app.setState({
      currentPageId: entry.page.id,
      scrollX,
      scrollY,
      zoom: { value: pageZoom },
    } as never);

    return { page: entry.number, zoom: pageZoom };
  }

  if (fit === "selection" || fit === "elements") {
    const ids =
      fit === "elements"
        ? readIds(args, "ids", { required: true })!
        : Object.keys(app.state.selectedElementIds).filter(
            (id) => app.state.selectedElementIds[id],
          );
    const elements = ids.length ? elementsFor(app, ids) : [];

    if (!elements.length) {
      return fail("not-found", "There is nothing to bring into view.");
    }

    app.scrollToContent(elements, { fitToViewport: true, animate: false });

    return { elements: elements.length };
  }

  if (zoom !== undefined) {
    if (zoom < 0.1 || zoom > 30) {
      return fail("bad-arguments", "zoom must be a number from 0.1 to 30.");
    }

    app.setState({ zoom: { value: zoom } } as never);
  }

  if (center !== undefined) {
    if (!isRecord(center)) {
      return fail("bad-arguments", "center must be {x, y} on a page.");
    }

    const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
    const x = readNumber(center.x, "center.x") ?? 0;
    const y = readNumber(center.y, "center.y") ?? 0;
    const value = zoom ?? app.state.zoom.value;

    app.setState({
      currentPageId: entry.page.id,
      scrollX: app.state.width / (2 * value) - (entry.rect.x + x),
      scrollY: app.state.height / (2 * value) - (entry.rect.y + y),
    } as never);
  }

  if (zoom === undefined && center === undefined) {
    return fail("bad-arguments", "Say where to look: fit, zoom or center.");
  }

  return { zoom: zoom ?? app.state.zoom.value };
};

export const findText = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const query = readString(args, "query", { required: true })!;
  const caseSensitive = readBoolean(args, "caseSensitive") ?? false;
  const select = readBoolean(args, "select") ?? false;
  const wanted = caseSensitive ? query : query.toLowerCase();

  if (!query.length || query.length > 200) {
    return fail("bad-arguments", "query must be 1 to 200 characters.");
  }

  const map = app.scene.getNonDeletedElementsMap();
  const matches = textsOf(app.scene.getNonDeletedElements())
    .filter((element) =>
      (caseSensitive ? element.text : element.text.toLowerCase()).includes(
        wanted,
      ),
    )
    .map((element) => {
      const entry = pageOfElement(app, element);
      const container = element.containerId
        ? map.get(element.containerId)
        : null;

      return {
        id: element.id,
        page: entry?.number ?? null,
        text:
          element.text.length > 120
            ? `${element.text.slice(0, 117)}...`
            : element.text,
        ...(container ? { containerId: container.id } : {}),
      };
    });

  if (select) {
    app.setState({
      selectedElementIds: Object.fromEntries(
        matches.map((match) => [match.containerId ?? match.id, true as const]),
      ),
    } as never);
  }

  return { total: matches.length, matches: matches.slice(0, 200) };
};

export const getStats = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids");
  const live = app.scene.getNonDeletedElements();
  const byType: Record<string, number> = {};

  for (const element of live) {
    byType[element.type] = (byType[element.type] ?? 0) + 1;
  }

  const pages = allPages(app).map(({ page, number }) => ({
    page: number,
    name: page.name,
    elements: live.filter((element) => element.pageId === page.id).length,
  }));
  const selected = ids
    ? elementsFor(app, ids)
    : live.filter((element) => app.state.selectedElementIds[element.id]);
  let selection: unknown = null;

  if (selected.length) {
    const [minX, minY, maxX, maxY] = getCommonBounds(selected);
    const entry = pageOfElement(app, selected[0]);
    const at = entry
      ? toPageSpace(entry.rect, minX, minY)
      : { x: Math.round(minX), y: Math.round(minY) };

    selection = {
      count: selected.length,
      page: entry?.number ?? null,
      ...at,
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
      ...(selected.length === 1
        ? {
            angle: selected[0].angle,
            id: selected[0].id,
            type: selected[0].type,
          }
        : {}),
    };
  }

  return {
    document: {
      name: app.state.name ?? "",
      pages: pages.length,
      elements: live.length,
      byType,
    },
    pages,
    selection,
  };
};

const FORMATS = ["png", "svg", "json"] as const;
const SCOPES = ["page", "all", "selection"] as const;
/** the most a text export may be, in characters */
const TEXT_LIMIT = 8_000_000;

export const exportScene = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const format = args.format ?? "png";
  const scope = args.scope ?? "page";
  const scale = readNumber(args.scale, "scale") ?? 2;
  const background = readBoolean(args, "background") ?? true;
  const dark = readBoolean(args, "darkMode") ?? false;
  const padding = readNumber(args.padding, "padding") ?? 20;

  if (!(FORMATS as readonly unknown[]).includes(format)) {
    return fail(
      "bad-arguments",
      `format must be one of ${FORMATS.join(", ")}.`,
    );
  }

  if (!(SCOPES as readonly unknown[]).includes(scope)) {
    return fail("bad-arguments", `scope must be one of ${SCOPES.join(", ")}.`);
  }

  if (scale < 0.25 || scale > 4) {
    return fail("bad-arguments", "scale must be a number from 0.25 to 4.");
  }

  const state = {
    ...app.state,
    exportBackground: background,
    exportWithDarkMode: dark,
    exportScale: scale,
    exportPadding: padding,
  };
  const live = app.scene.getNonDeletedElements();
  const entry =
    scope === "page"
      ? resolvePage(app, readInteger(args, "page", { min: 1 }))
      : null;
  let elements: readonly ExcalidrawElement[] = live;

  if (entry) {
    elements = live.filter((element) => element.pageId === entry.page.id);
  } else if (scope === "selection") {
    elements = live.filter(
      (element) => app.state.selectedElementIds[element.id],
    );

    if (!elements.length) {
      return fail("not-found", "Nothing is selected.");
    }
  }

  if (format === "json") {
    const used = new Set(
      elements
        .map((element) => (element as { fileId?: string | null }).fileId)
        .filter(Boolean) as string[],
    );
    const files = Object.fromEntries(
      Object.entries(app.files).filter(([id]) => used.has(id)),
    );
    const text = serializeAsJSON(elements, app.state, files, "local");

    if (text.length > TEXT_LIMIT) {
      return fail("too-large", "The document is too large to give as text.");
    }

    return { format, scope, ...(entry ? { page: entry.number } : {}), text };
  }

  if (format === "svg") {
    const svg = await exportToSvg(
      elements as never,
      {
        exportBackground: background,
        exportPadding: padding,
        exportScale: scale,
        viewBackgroundColor: state.viewBackgroundColor,
        exportWithDarkMode: dark,
        exportEmbedScene: false,
        frameRendering: state.frameRendering,
      },
      app.files,
      { pagePapers: getPapersForExport(elements, state) },
    );
    const text = new XMLSerializer().serializeToString(svg);

    if (text.length > TEXT_LIMIT) {
      return fail("too-large", "The drawing is too large to give as text.");
    }

    return { format, scope, ...(entry ? { page: entry.number } : {}), text };
  }

  const canvas = await exportToCanvas(
    elements as never,
    state,
    app.files,
    {
      exportBackground: background,
      viewBackgroundColor: state.viewBackgroundColor,
      exportPadding: padding,
      ...(entry
        ? {
            pageRect: entry.rect,
            pageDecoration: getPageDecoration({
              pages: state.pages,
              pageId: entry.page.id,
            }),
          }
        : {}),
      pagePapers: getPapersForExport(elements, state),
    },
    (width, height) => {
      const made = document.createElement("canvas");

      made.width = Math.max(1, Math.round(width * scale));
      made.height = Math.max(1, Math.round(height * scale));

      return { canvas: made, scale };
    },
  );

  if (canvas.width * canvas.height > 50_000_000) {
    return fail(
      "too-large",
      "The picture would be too large. Use a smaller scale.",
    );
  }

  return {
    format,
    scope,
    ...(entry ? { page: entry.number } : {}),
    width: canvas.width,
    height: canvas.height,
    images: [
      {
        data: canvas.toDataURL("image/png").split(",")[1] ?? "",
        mimeType: "image/png",
      },
    ],
  };
};

export const insertDocument = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const text = readString(args, "json", { required: true })!;
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return fail("bad-arguments", "json is not a saved whiteboard document.");
  }

  if (!isValidExcalidrawData(data as never)) {
    return fail("bad-arguments", "json is not a saved whiteboard document.");
  }

  const document = data as {
    elements: unknown[];
    files?: Record<string, never>;
  };
  const restored = restoreElements(document.elements as never, null, {
    repairBindings: true,
    deleteInvisibleElements: true,
  });
  const result = insertDocumentIntoScene({
    elements: app.scene.getElementsIncludingDeleted(),
    pages: app.state.pages,
    currentPageId: entry.page.id,
    document: { elements: [...restored], files: document.files ?? {} },
    files: app.files,
  });

  if (Object.keys(result.files).length) {
    app.addFiles(Object.values(result.files));
  }

  app.updateScene({
    elements: result.elements,
    appState: { pages: result.pages as never },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    page: entry.number,
    inserted: Object.keys(result.selectedElementIds),
  };
};
