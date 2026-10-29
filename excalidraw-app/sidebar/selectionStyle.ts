import { normalizeStyleRuns } from "@excalidraw/element";

import type { TextStyleRun } from "@excalidraw/element/types";

/**
 * The bold and italic parts of a text that was selected in a document (D-321).
 *
 * A text box made of the selection has them too, so a selected heading, a
 * **bold** phrase or an *emphasised* word is bold or italic on the page as it
 * was in the document. Where the style is the document's own - headings, the
 * heads of a table, the comments of highlighted code - it is read from how the
 * browser draws the text, and not only from the tags.
 */

const BOLD = 1;
const ITALIC = 2;

const BOLD_TAGS = "b, strong, th, h1, h2, h3, h4, h5, h6";
const ITALIC_TAGS = "i, em, cite, dfn, var";

/** is the text inside this element bold, italic, or both? */
const styleOf = (element: Element | null): number => {
  if (!element) {
    return 0;
  }

  let code = 0;

  if (element.closest(BOLD_TAGS)) {
    code |= BOLD;
  }

  if (element.closest(ITALIC_TAGS)) {
    code |= ITALIC;
  }

  if (code !== (BOLD | ITALIC)) {
    const drawn = element.ownerDocument.defaultView?.getComputedStyle(element);
    const weight = drawn?.fontWeight;

    if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) {
      code |= BOLD;
    }

    if (drawn?.fontStyle === "italic" || drawn?.fontStyle === "oblique") {
      code |= ITALIC;
    }
  }

  return code;
};

const isSpace = (char: string) => /\s/.test(char);

/**
 * The bold and italic parts of `text`, which is what the selection `range`
 * says when it is turned into a string.
 *
 * The string is not the text of the document as it is: the browser collapses
 * its spaces, and puts line breaks between blocks and tabs between the cells of
 * a table. So each character of the string is found, in order, in the
 * characters the range covers, and has the style it has there; a space that
 * was only put in has none.
 */
export const selectionStyleRuns = (
  range: Range,
  text: string,
): TextStyleRun[] => {
  const root = range.commonAncestorContainer;
  const stream: Array<{ char: string; code: number }> = [];

  const take = (node: Text) => {
    if (!range.intersectsNode(node)) {
      return;
    }

    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    const code = styleOf(node.parentElement);

    for (const char of node.data.slice(from, to)) {
      stream.push({ char, code });
    }
  };

  if (root.nodeType === Node.TEXT_NODE) {
    take(root as Text);
  } else {
    const walker = root.ownerDocument!.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      take(node as Text);
    }
  }

  const codes = new Uint8Array(text.length);
  let cursor = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (isSpace(char)) {
      // a space of the document, which the browser may have made one of many
      if (cursor < stream.length && isSpace(stream[cursor].char)) {
        codes[index] = stream[cursor].code;

        while (cursor < stream.length && isSpace(stream[cursor].char)) {
          cursor++;
        }
      }

      continue;
    }

    let found = cursor;

    while (found < stream.length && stream[found].char !== char) {
      found++;
    }

    if (found < stream.length) {
      codes[index] = stream[found].code;
      cursor = found + 1;
    }
  }

  const runs: TextStyleRun[] = [];
  let start = 0;

  for (let index = 1; index <= codes.length; index++) {
    if (index < codes.length && codes[index] === codes[start]) {
      continue;
    }

    const code = codes[start];

    if (code) {
      runs.push({
        start,
        end: index,
        ...(code & BOLD ? { bold: true as const } : {}),
        ...(code & ITALIC ? { italic: true as const } : {}),
      });
    }

    start = index;
  }

  return normalizeStyleRuns(runs, text.length);
};
