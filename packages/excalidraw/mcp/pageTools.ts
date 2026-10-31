/**
 * The tools of pages, their paper and their look (D-403, D-404).
 *
 * A page's place is positional - it is the sum of the widths of the pages before
 * it - and what is on it lives in scene coordinates, so every change of the page
 * list moves the content of the pages that moved (`translateContentForPageLayout`),
 * exactly as the page bar does. A deleted page's elements are soft-deleted, so one
 * undo brings the page and its content back together.
 */

import {
  CaptureUpdateAction,
  INK_LOOKS,
  canHaveInk,
  clampInkAmount,
} from "@excalidraw/element";
import { randomId } from "@excalidraw/common";

import type { InkLookName } from "@excalidraw/element";

import { actionChangeInkLook } from "../actions/actionInk";
import { getCurrentInk, setCurrentInk } from "../inkDefault";
import {
  CANVAS_PAPER_COLOR,
  PAPER_COLORS,
  PAPER_LOOKS,
  PAPER_TYPES,
  PAPER_TYPE_LABELS,
  isPaperType,
  paperOf,
} from "../scene/paper";
import {
  PAGE_SIZE_PRESETS,
  deletePage,
  deletePageElements,
  getPageSizeForPreset,
  getPageSizePresetForPage,
  scalePageContent,
  translateContentForPageLayout,
  updatePage,
} from "../scene/pages";

import { applyActionsToIds } from "./actionRunner";
import {
  argsOf,
  elementsFor,
  fail,
  isRecord,
  pageSizeOf,
  readBoolean,
  readIds,
  readInteger,
  readNumber,
  readString,
  resolvePage,
} from "./common";

import type { ExcalidrawPage } from "../types";
import type { McpApp } from "./common";
import type { McpRunContext } from "./readTools";

const summaryOf = (number: number, page: ExcalidrawPage) => ({
  page: number,
  id: page.id,
  name: page.name,
});

/** what the page list becomes, and the content that goes with each page */
const applyPageList = (
  app: McpApp,
  nextPages: readonly ExcalidrawPage[],
  {
    currentPageId,
    elements,
  }: {
    currentPageId?: string;
    elements?: readonly import("@excalidraw/element/types").ExcalidrawElement[];
  } = {},
) => {
  const moved = translateContentForPageLayout({
    elements: elements ?? app.scene.getElementsIncludingDeleted(),
    previousPages: app.state.pages,
    nextPages,
  });

  app.updateScene({
    elements: moved,
    appState: {
      pages: nextPages as ExcalidrawPage[],
      currentPageId: currentPageId ?? app.state.currentPageId,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

const DEFAULT_NAME = /^Page \d+$/;

/** pages that carry the default name are numbered again, as the page bar does */
const renumbered = (pages: readonly ExcalidrawPage[]) =>
  pages.map((page, index) =>
    DEFAULT_NAME.test(page.name)
      ? { ...page, name: `Page ${index + 1}` }
      : page,
  );

export const addPage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const after = readInteger(args, "after", { min: 0 });
  const before = readInteger(args, "before", { min: 1 });
  const name = readString(args, "name");
  const open = readBoolean(args, "open") ?? false;
  const pages = app.state.pages;

  if (after !== undefined && before !== undefined) {
    return fail("bad-arguments", "Give after or before, not both.");
  }

  // the new page goes after the page that is open, unless it is told where
  const index =
    before !== undefined
      ? before - 1
      : after !== undefined
      ? after
      : pages.findIndex((page) => page.id === app.state.currentPageId) + 1;

  if (index < 0 || index > pages.length) {
    return fail(
      "not-found",
      `There is no place ${index + 1}; the document has ${pages.length} pages.`,
    );
  }

  const page: ExcalidrawPage = {
    id: `page-${randomId()}`,
    name: name ?? `Page ${index + 1}`,
  };
  const nextPages = renumbered([
    ...pages.slice(0, index),
    page,
    ...pages.slice(index),
  ]);

  applyPageList(app, nextPages, open ? { currentPageId: page.id } : {});

  return summaryOf(index + 1, nextPages[index]);
};

export const renamePage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const name = readString(args, "name", { required: true })!.trim();

  if (!name || name.length > 80) {
    return fail("bad-arguments", "name must be 1 to 80 characters.");
  }

  app.updateScene({
    appState: {
      pages: app.state.pages.map((page) =>
        page.id === entry.page.id ? { ...page, name } : page,
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { page: entry.number, name };
};

export const movePage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const to = readInteger(args, "to", { min: 1 });

  if (to === undefined) {
    return fail("bad-arguments", "to is required.");
  }

  const pages = app.state.pages;

  if (to > pages.length) {
    return fail(
      "not-found",
      `There is no place ${to}; the document has ${pages.length} pages.`,
    );
  }

  const without = pages.filter((page) => page.id !== entry.page.id);
  const nextPages = renumbered([
    ...without.slice(0, to - 1),
    entry.page,
    ...without.slice(to - 1),
  ]);

  applyPageList(app, nextPages);

  return summaryOf(to, nextPages[to - 1]);
};

export const deletePageTool = async (
  app: McpApp,
  rawArgs: unknown,
  context: McpRunContext,
) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const pages = app.state.pages;

  // kept in the browser's storage before it goes, so it can come back after a
  // reload too (D-280); a failure to keep it never stops the delete
  try {
    await context.hooks?.keepDeletedPage?.(entry.page.id);
  } catch {
    // undo is still there
  }

  const { pages: nextPages, currentPageId } = deletePage({
    pages,
    currentPageId: app.state.currentPageId,
    pageId: entry.page.id,
  });
  const moved = translateContentForPageLayout({
    elements: app.scene.getElementsIncludingDeleted(),
    previousPages: pages,
    nextPages,
  });

  app.updateScene({
    elements: deletePageElements(moved, entry.page.id),
    appState: {
      pages: renumbered(nextPages) as ExcalidrawPage[],
      currentPageId,
      selectedElementIds: {},
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    deleted: entry.number,
    name: entry.page.name,
    pages: nextPages.length,
  };
};

export const clearPage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  let count = 0;
  const elements = app.scene.getElementsIncludingDeleted().map((element) => {
    if (element.pageId === entry.page.id && !element.isDeleted) {
      count += 1;

      return { ...element, isDeleted: true, version: element.version + 1 };
    }

    return element;
  });

  app.updateScene({
    elements,
    appState: { selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { page: entry.number, deleted: count };
};

export const listDeletedPages = async (
  _app: McpApp,
  _args: unknown,
  context: McpRunContext,
) => {
  const list = context.hooks?.listDeletedPages;

  if (!list) {
    return fail("failed", "This whiteboard does not keep deleted pages.");
  }

  return { deleted: await list() };
};

export const restorePage = async (
  _app: McpApp,
  rawArgs: unknown,
  context: McpRunContext,
) => {
  const id = readString(argsOf(rawArgs), "id", { required: true })!;
  const restore = context.hooks?.restoreDeletedPage;

  if (!restore) {
    return fail("failed", "This whiteboard does not keep deleted pages.");
  }

  const restored = await restore(id);

  return restored ?? fail("not-found", `No deleted page ${id}.`);
};

/** a paper, checked: what is not given stays what the page has */
const paperFrom = (page: ExcalidrawPage, raw: unknown) => {
  if (!isRecord(raw)) {
    return fail("bad-arguments", "paper must be an object.");
  }

  const current = paperOf(page);
  const type = raw.type === undefined ? current.type : raw.type;
  const color = raw.color === undefined ? current.color : raw.color;

  if (!isPaperType(type)) {
    return fail(
      "bad-arguments",
      `paper.type must be one of ${PAPER_TYPES.join(", ")}.`,
    );
  }

  if (
    color !== CANVAS_PAPER_COLOR &&
    !PAPER_COLORS.some((candidate) => candidate.id === color)
  ) {
    return fail(
      "bad-arguments",
      `paper.color must be canvas or one of ${PAPER_COLORS.map(
        (c) => c.id,
      ).join(", ")}.`,
    );
  }

  const percent = (value: unknown, key: string, fallback: number) => {
    const n =
      value === undefined ? fallback : readNumber(value, `paper.${key}`);

    return n === undefined || n < 0 || n > 100
      ? fail("bad-arguments", `paper.${key} must be a number from 0 to 100.`)
      : Math.round(n);
  };

  return {
    type,
    color: color as string,
    grain: percent(raw.grain, "grain", current.grain),
    age: percent(raw.age, "age", current.age),
  };
};

export const setPage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const properties: Parameters<typeof updatePage>[0]["properties"] = {};
  const preset = readString(args, "preset");
  const frame = readBoolean(args, "frame");
  const pageNumber = readBoolean(args, "pageNumber");
  const width = readNumber(args.width, "width");
  const height = readNumber(args.height, "height");

  if (frame !== undefined) {
    properties.frame = frame;
  }

  if (pageNumber !== undefined) {
    properties.number = pageNumber;
  }

  if (preset !== undefined) {
    const chosen = PAGE_SIZE_PRESETS.find(
      (candidate) => candidate.id === preset,
    );

    if (!chosen) {
      return fail(
        "bad-arguments",
        `preset must be one of ${PAGE_SIZE_PRESETS.map((each) => each.id).join(
          ", ",
        )}.`,
      );
    }

    Object.assign(properties, getPageSizeForPreset(chosen), {
      sizePreset: chosen.id,
    });
  }

  if (width !== undefined || height !== undefined) {
    if (preset !== undefined) {
      return fail(
        "bad-arguments",
        "Give a preset or a width and height, not both.",
      );
    }

    // a page of its own size has no preset
    Object.assign(properties, {
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      sizePreset: undefined,
    });
  }

  if (args.paper !== undefined) {
    properties.paper = paperFrom(entry.page, args.paper);
  }

  if (!Object.keys(properties).length) {
    return fail(
      "bad-arguments",
      "Say what to change: frame, pageNumber, preset or width and height, paper.",
    );
  }

  const paperOnAllPages = readBoolean(args, "paperOnAllPages") ?? false;
  let nextPages = updatePage({
    pages: app.state.pages,
    pageId: entry.page.id,
    properties,
  });

  if (paperOnAllPages && properties.paper) {
    const { paper } = properties;

    nextPages = nextPages.map((page) => ({ ...page, paper }));
  }

  applyPageList(app, nextPages);

  const page = nextPages.find((each) => each.id === entry.page.id)!;

  return {
    page: entry.number,
    ...pageSizeOf(page),
    sizePreset: getPageSizePresetForPage(page)?.id ?? null,
    frame: page.frame === true,
    pageNumber: page.number === true,
    paper: paperOf(page),
  };
};

export const scalePage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const direction = args.direction;

  if (direction !== "shrink" && direction !== "grow") {
    return fail("bad-arguments", "direction must be shrink or grow.");
  }

  const { pages, elements } = scalePageContent({
    elements: app.scene.getElementsIncludingDeleted(),
    pages: app.state.pages,
    pageId: entry.page.id,
    // the page's content is scaled in steps of one half, and back by two
    factor: direction === "shrink" ? 0.5 : 2,
  });

  app.updateScene({
    elements,
    appState: { pages: pages as ExcalidrawPage[] },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    page: entry.number,
    contentScale: pages.find((p) => p.id === entry.page.id)?.contentScale ?? 1,
  };
};

export const describePageLook = (app: McpApp, rawArgs: unknown) => {
  const entry = resolvePage(
    app,
    readInteger(argsOf(rawArgs), "page", { min: 1 }),
  );

  return {
    page: entry.number,
    now: {
      ...pageSizeOf(entry.page),
      sizePreset: getPageSizePresetForPage(entry.page)?.id ?? null,
      frame: entry.page.frame === true,
      pageNumber: entry.page.number === true,
      paper: paperOf(entry.page),
    },
    paperTypes: PAPER_TYPES.map((type) => ({
      id: type,
      name: PAPER_TYPE_LABELS[type],
    })),
    paperColors: [
      { id: CANVAS_PAPER_COLOR, name: "The canvas shows through" },
      ...PAPER_COLORS.map(({ id, name, color, dark }) => ({
        id,
        name,
        color,
        dark,
      })),
    ],
    paperRanges: { grain: [0, 100], age: [0, 100] },
    sizePresets: PAGE_SIZE_PRESETS.map((preset) => ({
      id: preset.id,
      ...getPageSizeForPreset(preset),
    })),
    looks: PAPER_LOOKS.map((look) => ({
      id: look.id,
      name: look.name,
      paper: look.paper,
      ink: look.ink,
    })),
    inkLooks: INK_LOOKS,
  };
};

export const applyPageLook = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const id = readString(args, "look", { required: true });
  const look = PAPER_LOOKS.find((candidate) => candidate.id === id);

  if (!look) {
    return fail(
      "bad-arguments",
      `look must be one of ${PAPER_LOOKS.map((each) => each.id).join(", ")}.`,
    );
  }

  const nextPages = updatePage({
    pages: app.state.pages,
    pageId: entry.page.id,
    properties: { paper: look.paper },
  });

  applyPageList(app, nextPages);

  // the ink of the next elements goes with the paper, as in the page look dialog;
  // what is drawn already is not recoloured
  setCurrentInk({ look: look.ink.look, amount: look.ink.amount });
  app.setState({ currentItemStrokeColor: look.ink.color });

  return {
    page: entry.number,
    look: look.id,
    paper: look.paper,
    nextElementsInk: look.ink,
  };
};

export const setInk = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids", { required: true })!;
  const look = args.look;
  const amount = readNumber(args.amount, "amount");
  const color = readString(args, "color");

  if (look !== undefined && !(INK_LOOKS as readonly unknown[]).includes(look)) {
    return fail(
      "bad-arguments",
      `look must be one of ${INK_LOOKS.join(", ")}.`,
    );
  }

  if (amount !== undefined && (amount < 1 || amount > 100)) {
    return fail("bad-arguments", "amount must be a number from 1 to 100.");
  }

  if (look === undefined && amount === undefined && color === undefined) {
    return fail("bad-arguments", "Say what to change: look, amount or color.");
  }

  const elements = elementsFor(app, ids);

  if (!elements.some((element) => canHaveInk(element))) {
    return fail(
      "bad-arguments",
      "None of these elements can have an ink look; drawn shapes, lines and text can.",
    );
  }

  // the panel's action also sets the ink the person draws with next: that is put back
  const before = getCurrentInk();

  try {
    await applyActionsToIds(app, ids, [
      {
        action: actionChangeInkLook,
        value: {
          ...(look !== undefined ? { look: look as InkLookName } : {}),
          ...(amount !== undefined ? { amount: clampInkAmount(amount) } : {}),
          ...(color !== undefined ? { color } : {}),
        },
      },
    ]);
  } finally {
    setCurrentInk(before);
  }

  return { elements: ids.length };
};
