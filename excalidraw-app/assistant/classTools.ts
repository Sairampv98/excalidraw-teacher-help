/**
 * The tools of a class (D-422, D-423): **slides from a script**, and **a lesson
 * page made of blocks**.
 *
 * A teacher writes the class before the class: the script, with a line of three
 * dashes between two slides. The deck is made of the whiteboard's own pages,
 * and each slide is laid out with the very blocks a markdown document is laid
 * out with (D-412) - so what the assistant writes is what the teacher would
 * have drawn, and the teacher can go on with it.
 *
 * A playbook page is the same thing on one page: a list of blocks - a title, a
 * heading, a paragraph, bullets, a quote, a rule, a table, a piece of code and
 * a flow chart - laid out one under the other.
 */

import { randomId, randomInteger } from "@excalidraw/common";
import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/element";
import { reconcileElements } from "@excalidraw/excalidraw";
import {
  getPageRectAtIndex,
  stampCurrentPage,
  translateContentForPageLayout,
} from "@excalidraw/excalidraw/scene/pages";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { checkFlowScript } from "@excalidraw/excalidraw/scene/flowCheck";
import { buildSettingsOfCustom } from "@excalidraw/excalidraw/scene/flowCustomPresets";
import { kindOf } from "@excalidraw/excalidraw/mcp/flowTools";
import { MCP_MAX_ELEMENTS_PER_CALL } from "@excalidraw/excalidraw/mcp/toolSpecs";
import {
  argsOf,
  fail,
  readBoolean,
  readInteger,
  readNumber,
  readString,
  resolvePage,
} from "@excalidraw/excalidraw/mcp/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { McpApp } from "@excalidraw/excalidraw/mcp/common";
import type { McpAppTools } from "@excalidraw/excalidraw/mcp/readTools";
import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";

import { parseMarkdown } from "./markdownBlocks";

import { layoutMarkdown } from "./markdownLayout";

import type { buildCodeCard } from "../sidebar/insertIntoScene";
import type { TableText } from "../sidebar/table";
import type { MarkdownText } from "./markdownLayout";
import type { Block } from "./markdownBlocks";

/** what the tools lean on, so a test can hand in its own */
export type ClassToolDeps = {
  buildCodeCard: typeof buildCodeCard;
  tableText?: TableText;
  /** how text is wrapped and measured; a test hands in its own */
  text?: MarkdownText;
};

/** the longest script that is made into a deck */
export const SLIDES_MAX_SCRIPT = 200_000;

/** the most slides one call makes */
export const SLIDES_MAX = 60;

/** the margin kept between a page's edge and what is put on it */
export const CLASS_PAGE_MARGIN = 100;

/** the gap between two blocks of a lesson page */
export const CLASS_BLOCK_GAP = 18;

/** the most rows and columns of a table, and the most characters in a cell */
const MAX_ROWS = 60;
const MAX_COLUMNS = 12;
const MAX_CELL = 500;

/** the most characters of a piece of code on a page */
const MAX_CODE = 20_000;

/** the longest script that is made into a chart */
const MAX_CHART_SCRIPT = 20_000;

/** the longest a page's name may be */
const MAX_NAME = 80;

/** a line of three dashes alone: the boundary between two slides */
const SLIDE_SEPARATOR = /^-{3,}\s*$/;

/** the pages that carry the default name are numbered again, as the page bar does */
const DEFAULT_NAME = /^Page \d+$/;

const renumbered = (pages: readonly ExcalidrawPage[]) =>
  pages.map((page, index) =>
    DEFAULT_NAME.test(page.name)
      ? { ...page, name: `Page ${index + 1}` }
      : page,
  );

/**
 * The slides of a script: the text between the lines of three dashes.
 *
 * A slide that is empty is kept, so the caller can say **which** slide has
 * nothing in it; only the empties at the end of the script are dropped, because
 * a script that ends with a separator is a script whose last slide was closed.
 */
export const splitSlides = (script: string): string[] => {
  const slides: string[] = [];
  let current: string[] = [];

  for (const line of script.split(/\r?\n/)) {
    if (SLIDE_SEPARATOR.test(line)) {
      slides.push(current.join("\n").trim());
      current = [];
    } else {
      current.push(line);
    }
  }

  slides.push(current.join("\n").trim());

  while (slides.length && !slides[slides.length - 1]) {
    slides.pop();
  }

  return slides;
};

/** the name of a slide: its first heading, or the number it is */
const slideName = (blocks: readonly Block[], index: number) => {
  const heading = blocks.find((block) => block.type === "heading");
  const text = heading?.type === "heading" ? heading.inline.text.trim() : "";

  return text ? text.slice(0, MAX_NAME) : `Slide ${index + 1}`;
};

export const createClassTools = (
  getApi: () => ExcalidrawImperativeAPI | null,
  deps: ClassToolDeps,
): McpAppTools => {
  const apiOrFail = () =>
    getApi() ?? fail("failed", "The editor is not ready yet.");

  /**
   * The elements and the pages of a change, put on the scene in **one** undo
   * step (D-422, D-423).
   *
   * The pages that move take their content with them (the page layout is
   * positional), so the content of the pages that moved is moved as well -
   * exactly as the page bar does it.
   */
  const put = (
    api: ExcalidrawImperativeAPI,
    app: McpApp,
    {
      pages,
      elements,
      currentPageId,
    }: {
      pages: readonly ExcalidrawPage[];
      elements: readonly ExcalidrawElement[];
      currentPageId?: string;
    },
  ) => {
    const moved = translateContentForPageLayout({
      elements: app.scene.getElementsIncludingDeleted(),
      previousPages: app.state.pages,
      nextPages: pages,
    });

    api.updateScene({
      elements: reconcileElements(
        moved,
        [...moved, ...elements] as RemoteExcalidrawElement[],
        api.getAppState(),
      ),
      appState: {
        pages: pages as ExcalidrawPage[],
        currentPageId: currentPageId ?? app.state.currentPageId,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  return {
    /* ------------------------------------------------------------ the slides */

    make_slides: async (rawArgs, app: McpApp) => {
      const args = argsOf(rawArgs);
      const script = readString(args, "script", { required: true })!;

      if (script.length > SLIDES_MAX_SCRIPT) {
        return fail(
          "too-large",
          `The script is ${script.length} characters; at most ${SLIDES_MAX_SCRIPT} make a deck in one call.`,
        );
      }

      const slides = splitSlides(script);

      if (!slides.length) {
        return fail(
          "bad-arguments",
          "There is nothing in the script to make slides of.",
        );
      }

      if (slides.length > SLIDES_MAX) {
        return fail(
          "too-large",
          `The script has ${slides.length} slides; at most ${SLIDES_MAX} are made in one call.`,
        );
      }

      // the slides are read before anything is made: a slide with nothing in it
      // is told of, and nothing is made at all
      const read = slides.map((text, index) => {
        const { blocks, skipped } = parseMarkdown(text);

        if (!blocks.length) {
          return fail(
            "bad-arguments",
            `Slide ${index + 1} has nothing in it that can be put on a page.`,
          );
        }

        return { blocks, skipped, name: slideName(blocks, index) };
      });

      const anchor = resolvePage(app, readInteger(args, "page", { min: 1 }));
      const open = readBoolean(args, "open") ?? false;
      const api = apiOrFail();

      // the pages of the deck, made after the page the deck starts at
      const slidePages: ExcalidrawPage[] = read.map((slide) => ({
        id: `page-${randomId()}`,
        name: slide.name,
      }));
      const at =
        app.state.pages.findIndex((page) => page.id === anchor.page.id) + 1;
      const pages = renumbered([
        ...app.state.pages.slice(0, at),
        ...slidePages,
        ...app.state.pages.slice(at),
      ]);

      const elements: ExcalidrawElement[] = [];
      const skipped: string[] = [];
      const made: { slide: number; page: number; name: string }[] = [];

      for (let index = 0; index < read.length; index++) {
        const slide = read[index];
        const rect = getPageRectAtIndex(pages, at + index);
        const laid = await layoutMarkdown(slide.blocks, {
          x: rect.x + CLASS_PAGE_MARGIN,
          y: rect.y + CLASS_PAGE_MARGIN,
          width: rect.width - CLASS_PAGE_MARGIN * 2,
          strokeColor: api.getAppState().currentItemStrokeColor,
          buildCard: deps.buildCodeCard,
          tableText: deps.tableText,
          text: deps.text,
        });

        elements.push(...stampCurrentPage(laid.elements, slidePages[index].id));
        skipped.push(...slide.skipped, ...laid.skipped);
        made.push({
          slide: index + 1,
          page: at + index + 1,
          name: slidePages[index].name,
        });
      }

      if (elements.length > MCP_MAX_ELEMENTS_PER_CALL) {
        return fail(
          "too-large",
          `The deck makes ${elements.length} elements; at most ${MCP_MAX_ELEMENTS_PER_CALL} are made in one call. Make it in parts.`,
        );
      }

      put(api, app, {
        pages,
        elements,
        ...(open ? { currentPageId: slidePages[0].id } : {}),
      });

      return {
        slides: made.length,
        pages: made,
        created: elements.length,
        ...(skipped.length ? { skipped } : {}),
      };
    },

    /* -------------------------------------------------------- the lesson page */

    build_page: async (rawArgs, app: McpApp) => {
      const args = argsOf(rawArgs);
      const given = args.blocks;

      if (
        !Array.isArray(given) ||
        !given.length ||
        !given.every((block) => block && typeof block === "object")
      ) {
        return fail(
          "bad-arguments",
          "blocks must be a list of blocks, each an object with a type.",
        );
      }

      const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
      const x = readNumber(args.x, "x") ?? CLASS_PAGE_MARGIN;
      const y = readNumber(args.y, "y") ?? CLASS_PAGE_MARGIN;
      const wanted = readNumber(args.width, "width");

      if (wanted !== undefined && (wanted < 200 || wanted > 4000)) {
        return fail(
          "bad-arguments",
          "width must be a number from 200 to 4000.",
        );
      }

      const width =
        wanted ?? Math.max(200, entry.rect.width - x - CLASS_PAGE_MARGIN);
      const api = apiOrFail();
      const strokeColor = api.getAppState().currentItemStrokeColor;
      const elements: ExcalidrawElement[] = [];
      const skipped: string[] = [];
      let cursor = entry.rect.y + y;

      for (let index = 0; index < given.length; index++) {
        const block = given[index] as Record<string, unknown>;
        const type = readString(block, "type", { required: true })!;

        if (type === "chart") {
          const chart = readChart(block, index, entry, cursor, width);

          elements.push(...chart.elements);
          cursor = chart.bottom + CLASS_BLOCK_GAP;
          continue;
        }

        const source = blockSource(type, block, index);
        const { blocks, skipped: gone } = parseMarkdown(source);

        if (!blocks.length) {
          return fail(
            "bad-arguments",
            `Block ${index + 1} (${type}) has no words in it.`,
          );
        }

        const laid = await layoutMarkdown(blocks, {
          x: entry.rect.x + x,
          y: cursor,
          width,
          strokeColor,
          buildCard: deps.buildCodeCard,
          tableText: deps.tableText,
          text: deps.text,
        });

        elements.push(...laid.elements);
        skipped.push(...gone, ...laid.skipped);
        cursor += laid.height + CLASS_BLOCK_GAP;
      }

      if (elements.length > MCP_MAX_ELEMENTS_PER_CALL) {
        return fail(
          "too-large",
          `The page makes ${elements.length} elements; at most ${MCP_MAX_ELEMENTS_PER_CALL} are made in one call. Make it in parts.`,
        );
      }

      put(api, app, {
        pages: app.state.pages,
        elements: stampCurrentPage(elements, entry.page.id),
      });

      return {
        page: entry.number,
        created: elements.length,
        width: Math.round(width),
        height: Math.round(cursor - entry.rect.y),
        belowThePage: cursor > entry.rect.y + entry.rect.height,
        ...(skipped.length ? { skipped } : {}),
      };
    },
  };
};

/** the words of a block, as the markdown it is laid out with */
const blockSource = (
  type: string,
  block: Record<string, unknown>,
  index: number,
): string => {
  switch (type) {
    case "title":
    case "heading":
    case "text":
    case "quote": {
      const text = readString(block, "text");

      if (!text || !text.trim()) {
        return fail(
          "bad-arguments",
          `Block ${index + 1} (${type}) must have its words.`,
        );
      }

      if (type === "title") {
        return `# ${text}`;
      }

      if (type === "heading") {
        return `## ${text}`;
      }

      if (type === "quote") {
        return `> ${text}`;
      }

      return text;
    }

    case "bullets": {
      const items = block.items;

      if (
        !Array.isArray(items) ||
        !items.length ||
        !items.every((item) => typeof item === "string")
      ) {
        return fail(
          "bad-arguments",
          `Block ${
            index + 1
          } (bullets) must have a list of items, each a string.`,
        );
      }

      return (items as string[]).map((item) => `- ${item}`).join("\n");
    }

    case "divider":
      return "---";

    case "table": {
      const table = readTable(block, index);
      const columns = table.reduce(
        (most, row) => Math.max(most, row.length),
        0,
      );
      // every row is as long as the longest one, so the table is a table
      const even = table.map((row) =>
        Array.from({ length: columns }, (_unused, at) => row[at] ?? ""),
      );
      // a bar in a cell would end the cell
      const cell = (text: string) => text.replace(/\|/g, "\\|");

      return [
        `| ${even[0].map(cell).join(" | ")} |`,
        `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
        ...even.slice(1).map((row) => `| ${row.map(cell).join(" | ")} |`),
      ].join("\n");
    }

    case "code": {
      const code = readString(block, "code", { required: true })!;

      if (!code.trim() || code.length > MAX_CODE) {
        return fail(
          "bad-arguments",
          `Block ${index + 1} (code) must be 1 to ${MAX_CODE} characters.`,
        );
      }

      const language = readString(block, "language");

      return `\`\`\`${language ?? ""}\n${code}\n\`\`\``;
    }

    default:
      return fail(
        "bad-arguments",
        `Block ${
          index + 1
        } is a ${type}; a block is a title, a heading, a text, bullets, a quote, a divider, a table, a code or a chart.`,
      );
  }
};

/** the rows of a table block */
const readTable = (block: Record<string, unknown>, index: number) => {
  const rows = block.rows;

  if (
    !Array.isArray(rows) ||
    !rows.length ||
    !rows.every(
      (row) =>
        Array.isArray(row) && row.every((cell) => typeof cell === "string"),
    )
  ) {
    return fail(
      "bad-arguments",
      `Block ${index + 1} (table) must have rows, each a list of cell texts.`,
    );
  }

  const table = rows as string[][];
  const columns = table.reduce((most, row) => Math.max(most, row.length), 0);

  if (table.length > MAX_ROWS || columns > MAX_COLUMNS) {
    return fail(
      "too-large",
      `A table has at most ${MAX_ROWS} rows and ${MAX_COLUMNS} columns.`,
    );
  }

  if (table.some((row) => row.some((cell) => cell.length > MAX_CELL))) {
    return fail("too-large", `A cell has at most ${MAX_CELL} characters.`);
  }

  return table;
};

/**
 * A chart on a lesson page: made for the room that is left below the cursor,
 * then moved so its top is where the cursor is.
 */
const readChart = (
  block: Record<string, unknown>,
  index: number,
  entry: {
    page: { id: string };
    number: number;
    rect: { x: number; y: number; width: number; height: number };
  },
  cursor: number,
  width: number,
) => {
  const script = readString(block, "script", { required: true })!;

  if (!script.trim() || script.length > MAX_CHART_SCRIPT) {
    return fail(
      "bad-arguments",
      `Block ${
        index + 1
      } (chart) must have a script of 1 to ${MAX_CHART_SCRIPT} characters.`,
    );
  }

  const kind = kindOf(readString(block, "kind", { required: true })!);
  const fit = readString(block, "fit") ?? "page";

  if (fit !== "page" && fit !== "larger") {
    return fail(
      "bad-arguments",
      "fit must be page or larger; a chart on a page cannot spread over pages.",
    );
  }

  const settings = kind.custom
    ? buildSettingsOfCustom(kind.custom).options
    : {};
  // the chart is made for the whole page, and then moved to where the cursor is:
  // a chart that is made for the little room that is left would be too small to
  // read
  const room = {
    x: entry.rect.x,
    y: entry.rect.y,
    width: entry.rect.width,
    height: entry.rect.height,
  };
  const check = checkFlowScript(kind.builtIn, script, {
    ...settings,
    page: room,
    fit,
    ...(kind.custom ? { custom: kind.custom } : {}),
  });

  if (!check.ok) {
    return fail(
      "bad-arguments",
      check.problems.length
        ? `Block ${index + 1} (chart): the script has problems: ${check.problems
            .map((problem) => `line ${problem.line}: ${problem.message}`)
            .join("; ")}.`
        : `Block ${index + 1} (chart): ${
            check.reason ?? "the script cannot be made into a chart."
          }`,
    );
  }

  const built = buildFlowPreset(kind.builtIn, script, {
    ...settings,
    page: room,
    fit,
    pageId: entry.page.id,
    pageNumber: entry.number,
    chartId: `chart-${randomId()}`,
    seed: randomInteger(),
    ...(kind.custom ? { custom: kind.custom } : {}),
  });

  if (!built.ok) {
    return fail(
      built.tooBig ? "too-large" : "bad-arguments",
      `Block ${index + 1} (chart): ${built.error}`,
    );
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(built.elements);
  // the chart is in the middle of the page, with its top where the cursor is
  const targetX =
    entry.rect.x + Math.max(0, (entry.rect.width - (maxX - minX)) / 2);
  const dx = targetX - minX;
  const dy = cursor - minY;

  return {
    elements: built.elements.map((element) => ({
      ...element,
      x: element.x + dx,
      y: element.y + dy,
    })) as ExcalidrawElement[],
    bottom: cursor + (maxY - minY),
    width,
  };
};
