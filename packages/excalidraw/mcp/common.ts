/**
 * What every tool handler shares (D-397 to D-406): the error it ends with, the
 * app it works on, the pages and their rectangles, the reading of its arguments,
 * and the short summary of an element.
 */

import { isTextElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getPageRectAtIndex, normalizePage } from "../scene/pages";

import { MCP_MAX_ELEMENTS_PER_CALL } from "./toolSpecs";

import type { McpErrorCode } from "./protocol";
import type { ExcalidrawPage, PageRect } from "../types";
import type App from "../components/App";

/** the app a tool works on */
export type McpApp = InstanceType<typeof App>;

/** a tool that ends with one of the errors the protocol names */
export class McpToolError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export const fail = (code: McpErrorCode, message: string): never => {
  throw new McpToolError(code, message);
};

/* ----------------------------------------------------------- reading arguments */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** the arguments as an object: a call with none is an empty one */
export const argsOf = (args: unknown): Record<string, unknown> => {
  if (args === undefined || args === null) {
    return {};
  }

  if (!isRecord(args)) {
    return fail("bad-arguments", "The arguments must be an object.");
  }

  return args;
};

export const readString = (
  args: Record<string, unknown>,
  key: string,
  { required = false }: { required?: boolean } = {},
): string | undefined => {
  const value = args[key];

  if (value === undefined || value === null) {
    return required ? fail("bad-arguments", `${key} is required.`) : undefined;
  }

  return typeof value === "string"
    ? value
    : fail("bad-arguments", `${key} must be a string.`);
};

export const readBoolean = (
  args: Record<string, unknown>,
  key: string,
): boolean | undefined => {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "boolean"
    ? value
    : fail("bad-arguments", `${key} must be true or false.`);
};

export const readInteger = (
  args: Record<string, unknown>,
  key: string,
  { min, max }: { min?: number; max?: number } = {},
): number | undefined => {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fail("bad-arguments", `${key} must be a whole number.`);
  }

  if (min !== undefined && value < min) {
    return fail("bad-arguments", `${key} must be at least ${min}.`);
  }

  if (max !== undefined && value > max) {
    return fail("bad-arguments", `${key} must be at most ${max}.`);
  }

  return value;
};

/** a list of ids, never longer than a call may take */
export const readIds = (
  args: Record<string, unknown>,
  key: string,
  { required = false }: { required?: boolean } = {},
): string[] | undefined => {
  const value = args[key];

  if (value === undefined || value === null) {
    return required ? fail("bad-arguments", `${key} is required.`) : undefined;
  }

  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
    return fail("bad-arguments", `${key} must be a list of element ids.`);
  }

  if (value.length > MCP_MAX_ELEMENTS_PER_CALL) {
    return fail(
      "too-large",
      `${key} has ${value.length} ids; a call takes at most ${MCP_MAX_ELEMENTS_PER_CALL}.`,
    );
  }

  return value;
};

export const readNumber = (
  value: unknown,
  name: string,
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail("bad-arguments", `${name} must be a number.`);
};

/* ------------------------------------------------------------------- pages */

export type McpPage = {
  page: ExcalidrawPage;
  /** from 1, as the person sees it */
  number: number;
  rect: PageRect;
};

const pagesOf = (app: McpApp): readonly ExcalidrawPage[] => app.state.pages;

/** the pages with their numbers and where they are in the scene */
export const allPages = (app: McpApp): McpPage[] =>
  pagesOf(app).map((page, index) => ({
    page,
    number: index + 1,
    rect: getPageRectAtIndex(pagesOf(app), index),
  }));

/** the page a tool names, or the one that is open */
export const resolvePage = (
  app: McpApp,
  number: number | undefined,
): McpPage => {
  const pages = allPages(app);

  if (number === undefined) {
    return (
      pages.find((entry) => entry.page.id === app.state.currentPageId) ??
      pages[0]
    );
  }

  return (
    pages[number - 1] ??
    fail(
      "not-found",
      `There is no page ${number}; the document has ${pages.length}.`,
    )
  );
};

/** the page an element is on, by its stamp */
export const pageOfElement = (
  app: McpApp,
  element: ExcalidrawElement,
): McpPage | undefined =>
  allPages(app).find((entry) => entry.page.id === element.pageId);

export const pageSizeOf = (page: ExcalidrawPage) => {
  const { width, height } = normalizePage(page);

  return { width, height };
};

/* ---------------------------------------------------------------- elements */

/** the elements that are in the document, by id (not the deleted ones) */
export const liveElementsById = (app: McpApp) =>
  app.scene.getNonDeletedElementsMap();

/** the elements the ids name; an id that is not there ends the call */
export const elementsFor = (
  app: McpApp,
  ids: readonly string[],
): ExcalidrawElement[] => {
  const map = liveElementsById(app);
  const missing = ids.filter((id) => !map.has(id));

  if (missing.length) {
    return fail(
      "not-found",
      `No element with id ${missing.slice(0, 5).join(", ")}${
        missing.length > 5 ? ` and ${missing.length - 5} more` : ""
      }.`,
    );
  }

  return ids.map((id) => map.get(id)!);
};

const round = (value: number) => Math.round(value * 100) / 100;

/** a position in a page's own terms: (0, 0) is the page's top-left */
export const toPageSpace = (rect: PageRect, x: number, y: number) => ({
  x: round(x - rect.x),
  y: round(y - rect.y),
});

/** the short summary of an element that list_elements gives */
export const summarize = (
  app: McpApp,
  element: ExcalidrawElement,
  { absolute = false }: { absolute?: boolean } = {},
) => {
  const entry = pageOfElement(app, element);
  const at =
    absolute || !entry
      ? { x: round(element.x), y: round(element.y) }
      : toPageSpace(entry.rect, element.x, element.y);
  const map = liveElementsById(app);
  const boundText = (element.boundElements ?? [])
    .map((bound) => (bound.type === "text" ? map.get(bound.id) : undefined))
    .find(Boolean);

  return {
    id: element.id,
    type: element.type,
    page: entry?.number ?? null,
    ...at,
    width: round(element.width),
    height: round(element.height),
    angle: round(element.angle),
    ...(isTextElement(element)
      ? {
          text: element.text,
          fontSize: element.fontSize,
          containerId: element.containerId,
        }
      : boundText && isTextElement(boundText)
      ? { text: boundText.text }
      : {}),
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    locked: element.locked,
    ...(element.groupIds.length ? { groupIds: [...element.groupIds] } : {}),
    ...(element.frameId ? { frameId: element.frameId } : {}),
    ...(element.link ? { link: element.link } : {}),
  };
};
