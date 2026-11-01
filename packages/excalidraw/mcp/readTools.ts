/**
 * The tools that only read (D-400): what the assistant sees before it changes
 * anything.
 */

import { getBoundTextElement } from "@excalidraw/element";

import { paperOf } from "../scene/paper";
import { getPageSizePresetForPage } from "../scene/pages";

import {
  allPages,
  argsOf,
  elementsFor,
  fail,
  liveElementsById,
  pageOfElement,
  pageSizeOf,
  readBoolean,
  readIds,
  readInteger,
  resolvePage,
  summarize,
  toPageSpace,
} from "./common";
import { MCP_MAX_ELEMENTS_PER_CALL, mcpPublicTools } from "./toolSpecs";
import { mcpToolGroupListings } from "./toolGroups";

import type { McpApp } from "./common";

/** the handlers of the tools that need what only the app has (D-407) */
export type McpAppTools = Record<
  string,
  (args: unknown, app: McpApp) => unknown | Promise<unknown>
>;

export type McpRunContext = {
  /** the app's own tools: the sticker catalogue, the table and the code card */
  appTools?: McpAppTools;
  /** whether the assistant may change the scene (D-399) */
  allowChanges: boolean;
  /** the app's name and version */
  app: string;
  /** what the page can do besides the canvas tools */
  features: string[];
  /** what only the app can do: the store of deleted pages (D-403) */
  hooks?: {
    keepDeletedPage?: (pageId: string) => Promise<void>;
    listDeletedPages?: () => Promise<
      { id: string; name: string; deletedAt: number; elements: number }[]
    >;
    restoreDeletedPage?: (
      id: string,
    ) => Promise<{ page: number; id: string; name: string } | null>;
  };
};

const LIST_CAP = 2000;

export const describeCapabilities = (app: McpApp, context: McpRunContext) => {
  const pages = allPages(app);
  const current = resolvePage(app, undefined);

  return {
    app: context.app,
    allowChanges: context.allowChanges,
    features: context.features,
    limits: { maxElementsPerCall: MCP_MAX_ELEMENTS_PER_CALL },
    pages: pages.length,
    currentPage: current.number,
    tools: mcpPublicTools().map((tool) => tool.name),
    groups: mcpToolGroupListings(),
    coordinates:
      "Positions are page-relative: (0, 0) is the top-left of the page, in scene units. Pages are numbered from 1.",
  };
};

export const listPages = (app: McpApp) => {
  const elements = app.scene.getNonDeletedElements();

  return {
    pages: allPages(app).map(({ page, number }) => ({
      page: number,
      id: page.id,
      name: page.name,
      ...pageSizeOf(page),
      sizePreset: getPageSizePresetForPage(page)?.id ?? null,
      frame: page.frame === true,
      pageNumber: page.number === true,
      paper: paperOf(page),
      elements: elements.filter((element) => element.pageId === page.id).length,
      open: page.id === app.state.currentPageId,
    })),
  };
};

export const listElements = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const page = readInteger(args, "page", { min: 1 });
  const ids = readIds(args, "ids");
  const absolute = readBoolean(args, "absolute") ?? false;
  const selected = readBoolean(args, "selected") ?? false;
  const types = args.types;

  if (
    types !== undefined &&
    (!Array.isArray(types) || !types.every((type) => typeof type === "string"))
  ) {
    fail("bad-arguments", "types must be a list of element types.");
  }

  let elements = ids
    ? elementsFor(app, ids)
    : [...app.scene.getNonDeletedElements()];

  if (page !== undefined) {
    const { page: wanted } = resolvePage(app, page);

    elements = elements.filter((element) => element.pageId === wanted.id);
  }

  if (selected) {
    elements = elements.filter(
      (element) => app.state.selectedElementIds[element.id],
    );
  }

  if (types) {
    elements = elements.filter((element) =>
      (types as string[]).includes(element.type),
    );
  }

  const total = elements.length;

  return {
    total,
    ...(total > LIST_CAP
      ? {
          truncatedTo: LIST_CAP,
          note: "Narrow the list with page, types or ids.",
        }
      : {}),
    elements: elements
      .slice(0, LIST_CAP)
      .map((element) => summarize(app, element, { absolute })),
  };
};

export const getElement = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const id = args.id;

  if (typeof id !== "string") {
    return fail("bad-arguments", "id is required.");
  }

  const [element] = elementsFor(app, [id]);
  const entry = pageOfElement(app, element);
  const bound = getBoundTextElement(element, liveElementsById(app));

  return {
    page: entry?.number ?? null,
    pageRelative: entry ? toPageSpace(entry.rect, element.x, element.y) : null,
    element: JSON.parse(JSON.stringify(element)),
    ...(bound ? { boundText: JSON.parse(JSON.stringify(bound)) } : {}),
  };
};

export const getSelection = (app: McpApp) => {
  const ids = Object.keys(app.state.selectedElementIds).filter(
    (id) => app.state.selectedElementIds[id],
  );
  const map = liveElementsById(app);
  const pages = new Set(
    ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((element) => pageOfElement(app, element!)?.number),
  );

  return { ids, pages: [...pages].filter((value) => value !== undefined) };
};
