/**
 * The tools that arrange, style and check (D-406): the editor's actions by name,
 * duplicating where the assistant says, a part of a text in bold or italic,
 * binding an arrow, a diagram from Mermaid, and a check of a page that tells what
 * would not read well.
 */

import {
  CaptureUpdateAction,
  bindBindingElement,
  convertToExcalidrawElements,
  duplicateElements,
  getBoundTextElement,
  getCommonBounds,
  isArrowElement,
  isBindableElement,
  isTextElement,
  newElementWith,
  rangeHasStyle,
  setStyleOnRange,
  unbindBindingElement,
  updateBoundElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  TextStyleRun,
} from "@excalidraw/element/types";

import { stampCurrentPage } from "../scene/pages";
import { CANVAS_PAPER_COLOR, PAPER_COLORS, paperOf } from "../scene/paper";

import { applyActions } from "./actionRunner";
import { MCP_ACTION_CATALOG, mcpActionEntry } from "./actionCatalog";
import {
  argsOf,
  elementsFor,
  fail,
  liveElementsById,
  readBoolean,
  readIds,
  readInteger,
  readNumber,
  readString,
  resolvePage,
  summarize,
  textsOf,
  toPageSpace,
} from "./common";

import type { McpApp } from "./common";
import type { Action } from "../actions/types";
import type { BinaryFiles } from "../types";

/* --------------------------------------------------------------- the actions */

export const listActions = () => ({
  run: MCP_ACTION_CATALOG.filter((entry) => entry.use === "run").map(
    (entry) =>
      entry.use === "run" && {
        name: entry.name,
        does: entry.description,
        needs: entry.needs ?? "elements",
        ...(entry.value ? { value: entry.value } : {}),
      },
  ),
  coveredByATool: MCP_ACTION_CATALOG.filter(
    (entry) => entry.use === "covered",
  ).map(
    (entry) => entry.use === "covered" && { name: entry.name, use: entry.tool },
  ),
  comingLater: MCP_ACTION_CATALOG.filter((entry) => entry.use === "later").map(
    (entry) =>
      entry.use === "later" && {
        name: entry.name,
        use: entry.tool,
        wave: entry.wave,
      },
  ),
  notForTheAssistant: MCP_ACTION_CATALOG.filter(
    (entry) => entry.use === "excluded",
  ).map(
    (entry) => entry.use === "excluded" && { name: entry.name, why: entry.why },
  ),
});

const NEEDS: Record<string, number> = {
  none: 0,
  elements: 1,
  two: 2,
  three: 3,
};

export const runAction = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const name = readString(args, "name", { required: true })!;
  const entry = mcpActionEntry(name);

  if (!entry) {
    return fail(
      "bad-arguments",
      `There is no action called ${name}. list_actions shows them.`,
    );
  }

  if (entry.use === "covered") {
    return fail(
      "bad-arguments",
      `${name} is the tool ${entry.tool}; use that.`,
    );
  }

  if (entry.use === "later") {
    return fail(
      "bad-arguments",
      `${name} comes with the tool ${entry.tool} in wave ${entry.wave} of the server.`,
    );
  }

  if (entry.use === "excluded") {
    return fail(
      "bad-arguments",
      `${name} is not for the assistant: ${entry.why}.`,
    );
  }

  const action = (
    app.actionManager.actions as Record<string, Action | undefined>
  )[name];

  if (!action) {
    return fail("failed", `${name} is not in this editor.`);
  }

  const needs = NEEDS[entry.needs ?? "elements"];
  const ids = readIds(args, "ids");

  if (needs > 0 && (!ids || ids.length < needs)) {
    return fail(
      "bad-arguments",
      `${name} needs ${
        needs === 1 ? "at least one element" : `at least ${needs} elements`
      }: give ids.`,
    );
  }

  if (ids) {
    elementsFor(app, ids);
  }

  await applyActions(app, [{ action, value: args.value ?? null }], {
    ...(needs > 0 && ids ? { ids, groups: name === "ungroup" } : {}),
  });

  return { ran: name, ...(ids && needs > 0 ? { elements: ids.length } : {}) };
};

export const duplicateElementsTool = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids", { required: true })!;
  const dx = readNumber(args.dx, "dx") ?? 40;
  const dy = readNumber(args.dy, "dy") ?? 40;
  const originals = elementsFor(app, ids);
  const map = liveElementsById(app);
  // the text bound to a shape is copied with it
  const withText = new Map<string, ExcalidrawElement>();

  for (const element of originals) {
    withText.set(element.id, element);

    const text = getBoundTextElement(element, map);

    if (text) {
      withText.set(text.id, text);
    }
  }

  const { duplicatedElements } = duplicateElements({
    elements: [...withText.values()],
    type: "everything",
    randomizeSeed: true,
    overrides: ({ origElement }) => ({
      x: origElement.x + dx,
      y: origElement.y + dy,
    }),
  });

  app.updateScene({
    elements: [
      ...app.scene.getElementsIncludingDeleted(),
      ...duplicatedElements,
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    created: duplicatedElements.map((element) => summarize(app, element)),
  };
};

/* ------------------------------------------------------------------- styling */

export const styleText = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const id = readString(args, "id", { required: true })!;
  const bold = readBoolean(args, "bold");
  const italic = readBoolean(args, "italic");
  const [element] = elementsFor(app, [id]);
  const text = isTextElement(element)
    ? element
    : getBoundTextElement(element, liveElementsById(app));

  if (!text || !isTextElement(text)) {
    return fail("bad-arguments", "This element has no text.");
  }

  if (bold === undefined && italic === undefined) {
    return fail("bad-arguments", "Say what to change: bold or italic.");
  }

  const length = text.originalText.length;
  const start = readInteger(args, "start", { min: 0 }) ?? 0;
  const end = readInteger(args, "end", { min: 0 }) ?? length;

  if (start > end || end > length) {
    return fail(
      "bad-arguments",
      `start and end must be positions in the text, which has ${length} characters.`,
    );
  }

  let runs: readonly TextStyleRun[] | undefined = text.styleRuns;

  for (const [key, on] of [
    ["bold", bold],
    ["italic", italic],
  ] as const) {
    if (on !== undefined) {
      runs = setStyleOnRange(runs, length, start, end, key, on);
    }
  }

  app.updateScene({
    elements: app.scene
      .getElementsIncludingDeleted()
      .map((each) =>
        each.id === text.id
          ? newElementWith(
              each as typeof text,
              { styleRuns: runs?.length ? runs : undefined },
              true,
            )
          : each,
      ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    id: text.id,
    start,
    end,
    bold: rangeHasStyle(runs, length, start, end, "bold"),
    italic: rangeHasStyle(runs, length, start, end, "italic"),
  };
};

/* ------------------------------------------------------------------- arrows */

export const bindArrow = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const arrowId = readString(args, "arrow", { required: true })!;
  const [arrow] = elementsFor(app, [arrowId]);

  if (!isArrowElement(arrow)) {
    return fail("bad-arguments", "arrow must be the id of an arrow.");
  }

  const result: Record<string, string | null> = {};

  for (const side of ["start", "end"] as const) {
    if (!(side in args)) {
      continue;
    }

    const target = args[side];

    if (target === null) {
      unbindBindingElement(arrow as never, side, app.scene);
      result[side] = null;
      continue;
    }

    if (typeof target !== "string") {
      return fail(
        "bad-arguments",
        `${side} must be an element id, or null to unbind.`,
      );
    }

    const [shape] = elementsFor(app, [target]);

    if (!isBindableElement(shape)) {
      return fail(
        "bad-arguments",
        `${target} is a ${shape.type}; an arrow binds to shapes, text, images and frames.`,
      );
    }

    bindBindingElement(arrow as never, shape, "orbit", side, app.scene);
    updateBoundElements(shape as never, app.scene);
    result[side] = target;
  }

  if (!Object.keys(result).length) {
    return fail(
      "bad-arguments",
      "Say what to bind: start and/or end (an id, or null).",
    );
  }

  app.syncActionResult({
    elements: app.scene.getElementsIncludingDeleted(),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { arrow: arrowId, ...result };
};

/* ------------------------------------------------------------------- mermaid */

export const mermaidToDiagram = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const source = readString(args, "source", { required: true })!;
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const x = readNumber(args.x, "x") ?? 100;
  const y = readNumber(args.y, "y") ?? 100;

  if (!source.trim() || source.length > 20_000) {
    return fail(
      "bad-arguments",
      "source must be Mermaid text of at most 20000 characters.",
    );
  }

  let parsed: { elements: unknown[]; files?: BinaryFiles };

  try {
    const lib = await import("@excalidraw/mermaid-to-excalidraw");

    parsed = await lib.parseMermaidToExcalidraw(source);
  } catch (error) {
    return fail(
      "bad-arguments",
      `That is not Mermaid the editor can draw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const made = convertToExcalidrawElements(parsed.elements as never, {
    regenerateIds: true,
  }) as ExcalidrawElement[];

  if (!made.length) {
    return fail("bad-arguments", "The Mermaid text drew nothing.");
  }

  const [minX, minY] = getCommonBounds(made);
  const dx = entry.rect.x + x - minX;
  const dy = entry.rect.y + y - minY;
  const moved = made.map((element) => ({
    ...element,
    x: element.x + dx,
    y: element.y + dy,
  })) as ExcalidrawElement[];

  stampCurrentPage(moved, entry.page.id);

  if (parsed.files && Object.keys(parsed.files).length) {
    app.addFiles(Object.values(parsed.files));
  }

  app.updateScene({
    elements: [...app.scene.getElementsIncludingDeleted(), ...moved],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    page: entry.number,
    created: moved.map((element) => summarize(app, element)),
  };
};

/* ------------------------------------------------------------------ the check */

const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
};

/** a colour as red, green, blue - or null when it is not one this check reads */
export const rgbOf = (color: string): [number, number, number] | null => {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);

  if (hex) {
    const digits =
      hex[1].length === 3
        ? [...hex[1]].map((digit) => digit + digit).join("")
        : hex[1];

    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
  }

  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);

  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  }

  return NAMED[value] ?? null;
};

/** the WCAG contrast ratio of two colours, from 1 to 21 */
export const contrastRatio = (
  a: [number, number, number],
  b: [number, number, number],
) => {
  const luminance = ([r, g, bl]: [number, number, number]) => {
    const [lr, lg, lb] = [r, g, bl].map((channel) => {
      const c = channel / 255;

      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((p, q) => q - p);

  return (light + 0.05) / (dark + 0.05);
};

/** text under this size is small on a page of the minimum size */
export const SMALL_TEXT = 18;

type Issue = {
  kind: string;
  severity: "problem" | "note";
  ids: string[];
  message: string;
};

export const checkPage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const map = liveElementsById(app);
  const onPage = app.scene
    .getNonDeletedElements()
    .filter((element) => element.pageId === entry.page.id);
  const issues: Issue[] = [];
  const { rect } = entry;

  if (!onPage.length) {
    issues.push({
      kind: "empty",
      severity: "note",
      ids: [],
      message: "The page has nothing on it.",
    });
  }

  // what is drawn: the text bound to a shape is part of the shape
  const things = onPage.filter(
    (element) =>
      !(isTextElement(element) && element.containerId) &&
      element.type !== "arrow" &&
      element.type !== "line" &&
      element.type !== "freedraw" &&
      element.type !== "frame",
  );

  for (const element of onPage) {
    const [x1, y1, x2, y2] = getCommonBounds([element]);

    if (
      x1 < rect.x - 1 ||
      y1 < rect.y - 1 ||
      x2 > rect.x + rect.width + 1 ||
      y2 > rect.y + rect.height + 1
    ) {
      issues.push({
        kind: "outside-page",
        severity: "problem",
        ids: [element.id],
        message: `${element.type} ${element.id} reaches outside the page.`,
      });
    }
  }

  // two things that lie on each other, when neither is the other's frame or text
  const overlaps: string[][] = [];

  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i];
      const b = things[j];

      if (a.groupIds.some((group) => b.groupIds.includes(group))) {
        continue;
      }

      const ax = a.x + a.width;
      const ay = a.y + a.height;
      const bx = b.x + b.width;
      const by = b.y + b.height;
      const w = Math.min(ax, bx) - Math.max(a.x, b.x);
      const h = Math.min(ay, by) - Math.max(a.y, b.y);

      if (w <= 0 || h <= 0) {
        continue;
      }

      const smaller = Math.min(a.width * a.height, b.width * b.height) || 1;

      if ((w * h) / smaller > 0.3) {
        overlaps.push([a.id, b.id]);
      }
    }
  }

  for (const ids of overlaps.slice(0, 20)) {
    issues.push({
      kind: "overlap",
      severity: "problem",
      ids,
      message: `${ids[0]} and ${ids[1]} lie on each other.`,
    });
  }

  const paperId = paperOf(entry.page).color;
  const paper =
    paperId === CANVAS_PAPER_COLOR
      ? app.state.viewBackgroundColor
      : PAPER_COLORS.find((candidate) => candidate.id === paperId)?.color ??
        app.state.viewBackgroundColor;

  for (const text of textsOf(onPage)) {
    if (text.fontSize < SMALL_TEXT) {
      issues.push({
        kind: "small-text",
        severity: "problem",
        ids: [text.id],
        message: `The text ${text.id} is ${text.fontSize} tall; under ${SMALL_TEXT} is small to read on a page.`,
      });
    }

    const container = text.containerId ? map.get(text.containerId) : null;
    const behind =
      container && container.backgroundColor !== "transparent"
        ? container.backgroundColor
        : paper;
    const front = rgbOf(text.strokeColor);
    const back = rgbOf(behind);

    if (front && back) {
      const ratio = contrastRatio(front, back);
      const needed = text.fontSize >= 24 ? 3 : 4.5;

      if (ratio < needed) {
        issues.push({
          kind: "low-contrast",
          severity: "problem",
          ids: [text.id],
          message: `The text ${text.id} (${
            text.strokeColor
          }) on ${behind} has a contrast of ${ratio.toFixed(
            1,
          )}; ${needed} is needed.`,
        });
      }
    }
  }

  if (onPage.length > 80) {
    issues.push({
      kind: "crowded",
      severity: "note",
      ids: [],
      message: `${onPage.length} elements are on the page; it may be crowded.`,
    });
  }

  return {
    page: entry.number,
    elements: onPage.length,
    ok: !issues.some((issue) => issue.severity === "problem"),
    issues,
    ...(onPage.length
      ? {
          contentStartsAt: toPageSpace(
            rect,
            getCommonBounds(onPage)[0],
            getCommonBounds(onPage)[1],
          ),
        }
      : {}),
  };
};
