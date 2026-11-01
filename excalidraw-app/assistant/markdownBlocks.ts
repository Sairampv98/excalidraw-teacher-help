/**
 * Markdown read into the blocks a page is made of (D-412): headings, paragraphs,
 * lists, code, tables, quotes and rules, with the text of each reduced to plain
 * words and the parts that were bold or italic.
 *
 * It is the same `marked` the Files panel renders markdown with. What the
 * whiteboard does not put on a page - a picture, html - is not in the blocks; it
 * is named in `skipped` so the assistant can say so.
 */

import { Marked } from "marked";

import type { Token, Tokens } from "marked";

/** characters `start` up to `end` are bold, italic or both */
export type InlineRun = {
  start: number;
  end: number;
  bold?: true;
  italic?: true;
};

export type Inline = { text: string; runs: InlineRun[] };

export type Block =
  | { type: "heading"; depth: number; inline: Inline }
  | { type: "paragraph"; inline: Inline }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "code"; code: string; language?: string }
  | { type: "table"; rows: string[][] }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" };

/**
 * The entities written in a text mean the characters they name (`&amp;` is an
 * `&`). They are decoded in the words of a text and nowhere else: what is in
 * a code span is what was typed.
 */
const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

export const inlineOf = (
  tokens: readonly Token[] | undefined,
  skipped: string[],
): Inline => {
  let text = "";
  const runs: InlineRun[] = [];

  const add = (value: string, bold: boolean, italic: boolean) => {
    if (!value) {
      return;
    }

    if (bold || italic) {
      const last = runs[runs.length - 1];

      if (
        last &&
        last.end === text.length &&
        !!last.bold === bold &&
        !!last.italic === italic
      ) {
        last.end += value.length;
      } else {
        runs.push({
          start: text.length,
          end: text.length + value.length,
          ...(bold ? { bold: true as const } : {}),
          ...(italic ? { italic: true as const } : {}),
        });
      }
    }

    text += value;
  };

  const walk = (list: readonly Token[], bold: boolean, italic: boolean) => {
    for (const token of list) {
      switch (token.type) {
        case "strong":
          walk((token as Tokens.Strong).tokens ?? [], true, italic);
          break;
        case "em":
          walk((token as Tokens.Em).tokens ?? [], bold, true);
          break;
        case "del":
          walk((token as Tokens.Del).tokens ?? [], bold, italic);
          break;
        case "link":
          walk((token as Tokens.Link).tokens ?? [], bold, italic);
          break;
        case "codespan":
          add((token as Tokens.Codespan).text, bold, italic);
          break;
        case "br":
          add("\n", bold, italic);
          break;
        case "image":
          skipped.push(`picture ${(token as Tokens.Image).href}`);
          break;
        case "html":
          skipped.push("html");
          break;
        case "escape":
          add((token as Tokens.Escape).text, bold, italic);
          break;
        case "text": {
          const nested = (token as Tokens.Text).tokens;

          if (nested?.length) {
            walk(nested, bold, italic);
          } else {
            add(decodeEntities((token as Tokens.Text).text), bold, italic);
          }

          break;
        }
        default:
          add((token as Tokens.Generic).raw ?? "", bold, italic);
      }
    }
  };

  walk(tokens ?? [], false, false);

  return { text: text.replace(/\s+$/, ""), runs };
};

const blocksOf = (tokens: readonly Token[], skipped: string[]): Block[] => {
  const out: Block[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const heading = token as Tokens.Heading;
        const inline = inlineOf(heading.tokens, skipped);

        if (inline.text) {
          out.push({ type: "heading", depth: heading.depth, inline });
        }

        break;
      }
      case "paragraph":
      case "text": {
        const inline = inlineOf(
          (token as Tokens.Paragraph).tokens ?? [token],
          skipped,
        );

        // a paragraph that was only a picture is nothing once the picture is not put
        if (inline.text) {
          out.push({ type: "paragraph", inline });
        }

        break;
      }
      case "list": {
        const list = token as Tokens.List;

        out.push({
          type: "list",
          ordered: list.ordered,
          start: typeof list.start === "number" ? list.start : 1,
          items: list.items.map((item) => {
            const blocks = blocksOf(item.tokens, skipped);

            if (item.task) {
              const first = blocks[0];
              const mark = item.checked ? "☑ " : "☐ ";

              if (first?.type === "paragraph") {
                first.inline = {
                  text: mark + first.inline.text,
                  runs: first.inline.runs.map((run) => ({
                    ...run,
                    start: run.start + mark.length,
                    end: run.end + mark.length,
                  })),
                };
              } else {
                blocks.unshift({
                  type: "paragraph",
                  inline: { text: mark.trim(), runs: [] },
                });
              }
            }

            return blocks;
          }),
        });

        break;
      }
      case "code": {
        const code = token as Tokens.Code;

        if (code.text.trim()) {
          out.push({
            type: "code",
            code: code.text,
            ...(code.lang ? { language: code.lang.split(/\s/)[0] } : {}),
          });
        }

        break;
      }
      case "table": {
        const table = token as Tokens.Table;

        out.push({
          type: "table",
          rows: [
            table.header.map((cell) => inlineOf(cell.tokens, skipped).text),
            ...table.rows.map((row) =>
              row.map((cell) => inlineOf(cell.tokens, skipped).text),
            ),
          ],
        });

        break;
      }
      case "blockquote": {
        const quoted = blocksOf((token as Tokens.Blockquote).tokens, skipped);

        if (quoted.length) {
          out.push({ type: "quote", blocks: quoted });
        }

        break;
      }
      case "hr":
        out.push({ type: "rule" });
        break;
      case "html":
        skipped.push("html");
        break;
      default:
        // space, definitions: nothing to put
        break;
    }
  }

  return out;
};

export const parseMarkdown = (source: string) => {
  const skipped: string[] = [];
  const tokens = new Marked({ gfm: true }).lexer(source);
  const blocks = blocksOf(tokens, skipped);

  return { blocks, skipped: [...new Set(skipped)] };
};
