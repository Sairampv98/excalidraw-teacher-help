/**
 * The blocks of a markdown document laid out as elements (D-412): top to bottom
 * from a corner, in a width. Text wraps in the width, a code block is a code card,
 * a table is a table (both the ones D-407 puts), a quote has a line down its
 * side and a rule is a line.
 *
 * Nothing is put on the scene here: this makes the elements, and the tool puts them.
 */

import {
  DEFAULT_FONT_FAMILY,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";
import {
  measureText,
  newLinearElement,
  newTextElement,
  wrapText,
} from "@excalidraw/element";

import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import {
  buildTableElements,
  layoutTable,
  normaliseRows,
} from "../sidebar/table";

import type { buildCodeCard } from "../sidebar/insertIntoScene";
import type { TableText } from "../sidebar/table";
import type { Block, Inline } from "./markdownBlocks";

/** how text is wrapped and measured; a test hands in its own */
export type MarkdownText = {
  wrap: (text: string, fontSize: number, width: number) => string;
  size: (text: string, fontSize: number) => { width: number; height: number };
};

const font = (fontSize: number) =>
  getFontString({ fontFamily: DEFAULT_FONT_FAMILY, fontSize });

const REAL_TEXT: MarkdownText = {
  wrap: (text, fontSize, width) => wrapText(text, font(fontSize), width),
  size: (text, fontSize) =>
    measureText(text, font(fontSize), getLineHeight(DEFAULT_FONT_FAMILY)),
};

export const MARKDOWN_MAX_TABLE_ROWS = 60;
export const MARKDOWN_MAX_TABLE_COLUMNS = 12;

const HEADING_SIZES = [36, 30, 26, 22];
const PARAGRAPH_SIZE = 20;
const BLOCK_GAP = 14;
const ITEM_GAP = 6;
const LIST_INDENT = 28;
const QUOTE_INDENT = 24;

export type MarkdownLayout = {
  elements: ExcalidrawElement[];
  width: number;
  height: number;
  skipped: string[];
};

export const layoutMarkdown = async (
  blocks: readonly Block[],
  {
    x,
    y,
    width,
    strokeColor,
    buildCard,
    tableText,
    text = REAL_TEXT,
  }: {
    x: number;
    y: number;
    width: number;
    strokeColor?: string;
    buildCard: typeof buildCodeCard;
    tableText?: TableText;
    text?: MarkdownText;
  },
): Promise<MarkdownLayout> => {
  const elements: ExcalidrawElement[] = [];
  const skipped: string[] = [];
  let cursor = y;
  let widest = 0;

  const putText = (
    inline: Inline,
    fontSize: number,
    at: number,
    room: number,
    bold = false,
  ) => {
    const wrapped = text.wrap(inline.text, fontSize, room);
    const size = text.size(wrapped, fontSize);
    const runs = bold
      ? [{ start: 0, end: inline.text.length, bold: true as const }]
      : inline.runs;
    const element = newTextElement({
      text: wrapped,
      originalText: inline.text,
      ...(runs.length ? { styleRuns: runs } : {}),
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize,
      lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
      autoResize: false,
      textAlign: "left",
      verticalAlign: "top",
      ...(strokeColor ? { strokeColor } : {}),
      x: at,
      y: cursor,
    });
    const placed = {
      ...element,
      width: Math.min(size.width, room),
      height: size.height,
    };

    elements.push(placed);
    widest = Math.max(widest, at - x + placed.width);
    cursor += placed.height;
  };

  const lay = async (list: readonly Block[], at: number, room: number) => {
    let first = true;

    for (const block of list) {
      if (block.type === "table") {
        const columns = block.rows.reduce(
          (most, row) => Math.max(most, row.length),
          0,
        );

        // a table that is too large is not put, and it takes no room
        if (
          block.rows.length > MARKDOWN_MAX_TABLE_ROWS ||
          columns > MARKDOWN_MAX_TABLE_COLUMNS
        ) {
          skipped.push(
            `a table of ${block.rows.length} rows and ${columns} columns (at most ${MARKDOWN_MAX_TABLE_ROWS} and ${MARKDOWN_MAX_TABLE_COLUMNS})`,
          );
          continue;
        }
      }

      if (!first) {
        cursor += block.type === "heading" ? BLOCK_GAP + 10 : BLOCK_GAP;
      }

      first = false;

      switch (block.type) {
        case "heading":
          putText(
            block.inline,
            HEADING_SIZES[Math.min(block.depth, 4) - 1],
            at,
            room,
            true,
          );
          break;

        case "paragraph":
          putText(block.inline, PARAGRAPH_SIZE, at, room);
          break;

        case "list": {
          for (let index = 0; index < block.items.length; index++) {
            const item = block.items[index];
            const marker = block.ordered ? `${block.start + index}. ` : "• ";

            if (index) {
              cursor += ITEM_GAP;
            }

            const [head, ...rest] = item;

            if (head?.type === "paragraph") {
              putText(
                {
                  text: marker + head.inline.text,
                  runs: head.inline.runs.map((run) => ({
                    ...run,
                    start: run.start + marker.length,
                    end: run.end + marker.length,
                  })),
                },
                PARAGRAPH_SIZE,
                at,
                room,
              );

              if (rest.length) {
                cursor += ITEM_GAP;
                await lay(rest, at + LIST_INDENT, room - LIST_INDENT);
              }
            } else {
              putText(
                { text: marker.trim(), runs: [] },
                PARAGRAPH_SIZE,
                at,
                room,
              );

              if (item.length) {
                cursor += ITEM_GAP;
                await lay(item, at + LIST_INDENT, room - LIST_INDENT);
              }
            }
          }

          break;
        }

        case "code": {
          const card = await buildCard(block.code, block.language);

          for (const element of card.elements) {
            elements.push({
              ...element,
              x: element.x + at,
              y: element.y + cursor,
            } as ExcalidrawElement);
          }

          widest = Math.max(widest, at - x + card.width);
          cursor += card.height;
          break;
        }

        case "table": {
          const columns = block.rows.reduce(
            (most, row) => Math.max(most, row.length),
            0,
          );
          const even = normaliseRows(block.rows, columns);
          const layout = layoutTable(even, {
            maxWidth: Math.max(200, room),
            ...(tableText ? { text: tableText } : {}),
          });

          elements.push(
            ...buildTableElements(
              even,
              layout,
              { x: at, y: cursor },
              randomId(),
              strokeColor ?? "#1e1e1e",
            ),
          );
          widest = Math.max(widest, at - x + layout.width);
          cursor += layout.height;
          break;
        }

        case "quote": {
          const began = cursor;

          await lay(block.blocks, at + QUOTE_INDENT, room - QUOTE_INDENT);

          elements.push(
            newLinearElement({
              type: "line",
              x: at + 6,
              y: began,
              points: [
                pointFrom<LocalPoint>(0, 0),
                pointFrom<LocalPoint>(0, Math.max(1, cursor - began)),
              ],
              strokeColor: "#868e96",
              strokeWidth: 2,
            }),
          );
          break;
        }

        case "rule":
          elements.push(
            newLinearElement({
              type: "line",
              x: at,
              y: cursor + 6,
              points: [
                pointFrom<LocalPoint>(0, 0),
                pointFrom<LocalPoint>(room, 0),
              ],
              strokeColor: "#868e96",
              strokeWidth: 1,
            }),
          );
          widest = Math.max(widest, at - x + room);
          cursor += 12;
          break;
      }
    }
  };

  await lay(blocks, x, width);

  return {
    elements,
    width: Math.round(widest),
    height: Math.round(cursor - y),
    skipped,
  };
};
