/**
 * The tools that need what only the app has (D-407): its sticker catalogue, its
 * table builder and its code card. The library's runner gives each of these the
 * editor and its arguments; they put the result on the page the assistant names,
 * in one undo step, and leave the person's selection and view where they were.
 */

import { randomId } from "@excalidraw/common";
import { CaptureUpdateAction, newImageElement } from "@excalidraw/element";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";
import {
  argsOf,
  fail,
  readInteger,
  readNumber,
  readString,
  resolvePage,
  summarize,
} from "@excalidraw/excalidraw/mcp/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { McpApp } from "@excalidraw/excalidraw/mcp/common";

import type { McpAppTools } from "@excalidraw/excalidraw/mcp/readTools";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { STICKERS } from "../emoji/catalog";
import { stickerFile } from "../emoji/insertSticker";
import { searchStickers } from "../emoji/search";
import {
  appendElements,
  buildCodeCard,
  getImageSize,
} from "../sidebar/insertIntoScene";
import {
  buildTableElements,
  layoutTable,
  normaliseRows,
} from "../sidebar/table";

import type { Sticker } from "../emoji/catalog";
import type { TableText } from "../sidebar/table";

/** what the tools lean on, so a test can hand in its own */
export type AppToolDeps = {
  stickerFile: (sticker: Sticker) => Promise<File>;
  getImageSize: (src: string) => Promise<{ width: number; height: number }>;
  tableText?: TableText;
  buildCodeCard: typeof buildCodeCard;
};

const REAL: AppToolDeps = { stickerFile, getImageSize, buildCodeCard };

const MAX_ROWS = 60;
const MAX_COLUMNS = 12;
const MAX_CELL = 500;
const MAX_CODE = 20_000;

const stickerEntry = (sticker: Sticker) => ({
  id: sticker.id,
  kind: sticker.kind,
  label: sticker.label,
  tags: sticker.tags,
});

export const createAppTools = (
  getApi: () => ExcalidrawImperativeAPI | null,
  deps: AppToolDeps = REAL,
): McpAppTools => {
  const apiOrFail = () =>
    getApi() ?? fail("failed", "The editor is not ready yet.");

  /** the elements are put on the page, in one undo step, without moving the view */
  const put = (
    api: ExcalidrawImperativeAPI,
    pageId: string,
    elements: readonly ExcalidrawElement[],
  ) =>
    appendElements(
      api,
      elements,
      undefined,
      pageId,
      CaptureUpdateAction.IMMEDIATELY,
    );

  return {
    list_stickers: (rawArgs) => {
      const args = argsOf(rawArgs);
      const query = readString(args, "query") ?? "";
      const kind = args.kind;

      if (kind !== undefined && kind !== "emoji" && kind !== "gif") {
        return fail("bad-arguments", "kind must be emoji or gif.");
      }

      const found = searchStickers(STICKERS, query, kind);

      return {
        total: found.length,
        stickers: found.slice(0, 100).map(stickerEntry),
      };
    },

    insert_sticker: async (rawArgs, app: McpApp) => {
      const args = argsOf(rawArgs);
      const id = readString(args, "id", { required: true })!;
      const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
      const size = readNumber(args.size, "size") ?? 200;
      const sticker = STICKERS.find((candidate) => candidate.id === id);

      if (!sticker) {
        const near = searchStickers(STICKERS, id)
          .slice(0, 5)
          .map((each) => each.id);

        return fail(
          "not-found",
          `No sticker ${id}.${
            near.length ? ` Near it: ${near.join(", ")}.` : ""
          } list_stickers finds them.`,
        );
      }

      if (size < 24 || size > 1000) {
        return fail("bad-arguments", "size must be a number from 24 to 1000.");
      }

      const api = apiOrFail();
      const file = await deps.stickerFile(sticker);
      const dataURL = await getDataURL(file);
      const fileId = await generateIdFromFile(file);
      const natural = await deps.getImageSize(dataURL);
      const ratio = size / Math.max(natural.width, natural.height);
      const width = Math.max(1, natural.width * ratio);
      const height = Math.max(1, natural.height * ratio);
      // the top-left, or the middle of the page
      const x =
        entry.rect.x +
        (readNumber(args.x, "x") ?? (entry.rect.width - width) / 2);
      const y =
        entry.rect.y +
        (readNumber(args.y, "y") ?? (entry.rect.height - height) / 2);
      const image = newImageElement({
        type: "image",
        x,
        y,
        width,
        height,
        fileId,
      });
      const now = Date.now();

      api.addFiles([
        {
          id: fileId,
          mimeType: (file.type || "image/png") as never,
          dataURL,
          created: now,
          lastRetrieved: now,
          version: 1,
        },
      ]);
      put(api, entry.page.id, [image]);

      return {
        page: entry.number,
        created: [summarize(app, image)],
      };
    },

    insert_table: (rawArgs, app: McpApp) => {
      const args = argsOf(rawArgs);
      const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
      const given = args.rows;

      if (
        !Array.isArray(given) ||
        !given.length ||
        !given.every(
          (row) =>
            Array.isArray(row) && row.every((cell) => typeof cell === "string"),
        )
      ) {
        return fail(
          "bad-arguments",
          "rows must be a list of rows, each a list of cell texts.",
        );
      }

      const rows = given as string[][];
      const columns = rows.reduce((most, row) => Math.max(most, row.length), 0);

      if (rows.length > MAX_ROWS || columns > MAX_COLUMNS) {
        return fail(
          "too-large",
          `A table has at most ${MAX_ROWS} rows and ${MAX_COLUMNS} columns.`,
        );
      }

      if (rows.some((row) => row.some((cell) => cell.length > MAX_CELL))) {
        return fail("too-large", `A cell has at most ${MAX_CELL} characters.`);
      }

      const api = apiOrFail();
      const x = readNumber(args.x, "x") ?? 100;
      const y = readNumber(args.y, "y") ?? 100;
      const even = normaliseRows(rows, columns);
      // never wider than what is left of the page
      const layout = layoutTable(even, {
        maxWidth: Math.max(200, entry.rect.width - x - 40),
        ...(deps.tableText ? { text: deps.tableText } : {}),
      });
      const elements = buildTableElements(
        even,
        layout,
        { x: entry.rect.x + x, y: entry.rect.y + y },
        randomId(),
        api.getAppState().currentItemStrokeColor,
      );

      put(api, entry.page.id, elements);

      return {
        page: entry.number,
        rows: rows.length,
        columns,
        width: Math.round(layout.width),
        height: Math.round(layout.height),
        created: elements.length,
      };
    },

    insert_code_card: async (rawArgs, app: McpApp) => {
      const args = argsOf(rawArgs);
      const code = readString(args, "code", { required: true })!;
      const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));

      if (!code.trim() || code.length > MAX_CODE) {
        return fail(
          "bad-arguments",
          `code must be 1 to ${MAX_CODE} characters.`,
        );
      }

      const api = apiOrFail();
      const card = await deps.buildCodeCard(code, readString(args, "language"));
      const dx = entry.rect.x + (readNumber(args.x, "x") ?? 100);
      const dy = entry.rect.y + (readNumber(args.y, "y") ?? 100);
      const placed = card.elements.map((element) => ({
        ...element,
        x: element.x + dx,
        y: element.y + dy,
      })) as ExcalidrawElement[];

      put(api, entry.page.id, placed);

      return {
        page: entry.number,
        highlighted: card.highlighted,
        width: Math.round(card.width),
        height: Math.round(card.height),
        created: placed.length,
      };
    },
  };
};
