/**
 * The page's half of the documents (D-411 to D-414): markdown laid out as the
 * things a page is made of, a PDF read and drawn, and the words in a picture.
 * The PDF reader, the drawing of a page and the reader of pictures are
 * stand-ins that record what they were asked.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { Excalidraw, useExcalidrawAPI } from "@excalidraw/excalidraw";
import { runMcpTool } from "@excalidraw/excalidraw/mcp/runner";
import { clearUploads } from "@excalidraw/excalidraw/mcp/uploads";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { McpRunContext } from "@excalidraw/excalidraw/mcp/runner";

import { createAppTools } from "../assistant/appTools";
import { parseMarkdown } from "../assistant/markdownBlocks";
import { parsePageRange } from "../assistant/documentTools";

import type { AppToolDeps } from "../assistant/appTools";
import type { DocumentDeps } from "../assistant/documentTools";

const { h } = window;

/** the bytes of a PNG that says it is this wide and this tall */
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);

  return bytes;
};

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");

/** a PDF page is 600 by 800 at a scale of one, and says its words */
const fakePage = (number: number) => ({
  getViewport: ({ scale }: { scale: number }) => ({
    width: 600 * scale,
    height: 800 * scale,
    scale,
  }),
  render: () => ({ promise: Promise.resolve() }),
  streamTextContent: () => null,
  getTextContent: async () => ({
    items: [
      { str: `Page ${number} ` },
      { str: "words", hasEOL: true },
      { str: "and more" },
    ],
  }),
});

const destroyed = vi.fn();
const asked = { pages: [] as number[] };

const documents = {
  pages: 4,
  loadPdf: vi.fn(async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: documents.pages,
        getPage: async (number: number) => {
          asked.pages.push(number);

          return fakePage(number);
        },
        destroy: destroyed,
      }),
    }),
    GlobalWorkerOptions: { workerSrc: "" },
    TextLayer: class {},
  })),
  renderPage: vi.fn(async (_page: unknown, scale: number, crop?: any) => ({
    bytes: png(
      Math.round(600 * scale * (crop?.width ?? 1)),
      Math.round(800 * scale * (crop?.height ?? 1)),
    ),
    width: Math.round(600 * scale * (crop?.width ?? 1)),
    height: Math.round(800 * scale * (crop?.height ?? 1)),
  })),
  ocr: vi.fn(async (_dataURL: string, _region?: object) => ({
    id: "ocr-1",
    text: "Hello world\nSecond line\n",
    confidence: 91,
    engine: "tesseract" as const,
    durationMs: 5,
    lines: [
      { text: "Hello world", x: 100, y: 50, width: 400, height: 40 },
      { text: "Second line", x: 100, y: 150, width: 200, height: 40 },
    ],
  })),
  // a letter is half a size wide and a line a size and a quarter tall; a line
  // breaks at the last space that keeps it inside the width
  text: {
    size: (text: string, fontSize: number) => {
      const lines = text.split("\n");

      return {
        width: Math.max(...lines.map((line) => line.length)) * fontSize * 0.5,
        height: lines.length * fontSize * 1.25,
      };
    },
    wrap: (text: string, fontSize: number, width: number) => {
      const room = Math.max(1, Math.floor(width / (fontSize * 0.5)));
      const out: string[] = [];

      for (const paragraph of text.split("\n")) {
        let line = "";

        for (const word of paragraph.split(" ")) {
          if (line && `${line} ${word}`.length > room) {
            out.push(line);
            line = word;
          } else {
            line = line ? `${line} ${word}` : word;
          }
        }

        out.push(line);
      }

      return out.join("\n");
    },
  },
};

const deps: AppToolDeps = {
  stickerFile: vi.fn(),
  getImageSize: vi.fn(),
  // a letter is 10 wide and a line 20 tall
  tableText: {
    width: (text) => text.length * 10,
    height: (text) => (text.split("\n").length || 1) * 20,
    wrap: (text) => text,
  },
  buildCodeCard: vi.fn(async () => ({
    elements: [
      API.createElement({
        type: "rectangle",
        id: "card",
        x: 0,
        y: 0,
        width: 300,
        height: 120,
      }),
      API.createElement({
        type: "text",
        id: "run",
        x: 18,
        y: 18,
        text: "print(1)",
      }),
    ] as never,
    width: 300,
    height: 120,
    highlighted: true,
  })),
  documents: documents as unknown as Partial<DocumentDeps>,
};

let api: any = null;

const GrabApi = () => {
  api = useExcalidrawAPI();

  return null;
};

const context = (allowChanges = true): McpRunContext => ({
  allowChanges,
  app: "test",
  features: [],
  appTools: createAppTools(() => api, deps),
});

const run = async (name: string, args: unknown = {}, ctx = context()) => {
  let outcome: Awaited<ReturnType<typeof runMcpTool>> | undefined;

  await act(async () => {
    outcome = await runMcpTool(h.app, name, args, ctx);
  });

  return outcome!;
};

const ok = async (name: string, args: unknown = {}) => {
  const outcome = await run(name, args);

  if (!outcome.ok) {
    throw new Error(`${name}: ${outcome.error.code}: ${outcome.error.message}`);
  }

  return outcome.result as any;
};

const live = () => h.elements.filter((element) => !element.isDeleted);
const texts = () =>
  live().filter((element) => element.type === "text") as any[];
const textOf = (original: string) =>
  texts().find((element) => element.originalText === original);

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

/** a file that comes to the page in one piece */
const send = async (id: string, bytes: Uint8Array, name = "book.pdf") => {
  await ok("upload_chunk", {
    id,
    index: 0,
    total: 1,
    data: b64(bytes),
    name,
    mimeType: "application/pdf",
  });
};

beforeEach(async () => {
  clearUploads();
  destroyed.mockClear();
  asked.pages.length = 0;
  documents.pages = 4;
  documents.loadPdf.mockClear();
  documents.renderPage.mockClear();
  documents.ocr.mockClear();
  vi.mocked(deps.buildCodeCard).mockClear();
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <GrabApi />
    </Excalidraw>,
  );
});

const DOCUMENT = [
  "# Title",
  "",
  "Some **bold** and *slanted* and `code` & a < b words.",
  "",
  "- one",
  "- two",
  "  - nested",
  "",
  "1. first",
  "2. second",
  "",
  "> quoted words",
  "",
  "---",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```python",
  "print(1)",
  "```",
  "",
  "![a picture](pic.png)",
].join("\n");

describe("markdown read into blocks", () => {
  it("AC-497 makes headings, paragraphs with the parts that are bold or italic, lists, code, tables, quotes and rules, and names what it does not put", () => {
    const { blocks, skipped } = parseMarkdown(DOCUMENT);

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "rule",
      "table",
      "code",
    ]);
    expect(blocks[0]).toMatchObject({
      depth: 1,
      inline: { text: "Title", runs: [] },
    });

    const paragraph = blocks[1] as any;

    // the characters html escapes are the characters that were written
    expect(paragraph.inline.text).toBe(
      "Some bold and slanted and code & a < b words.",
    );
    expect(paragraph.inline.runs).toEqual([
      { start: 5, end: 9, bold: true },
      { start: 14, end: 21, italic: true },
    ]);

    expect(blocks[2]).toMatchObject({ ordered: false });
    expect((blocks[2] as any).items).toHaveLength(2);
    expect((blocks[2] as any).items[1][1]).toMatchObject({ type: "list" });
    expect(blocks[3]).toMatchObject({ ordered: true, start: 1 });
    expect(blocks[6]).toEqual({
      type: "table",
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
    });
    expect(blocks[7]).toEqual({
      type: "code",
      code: "print(1)",
      language: "python",
    });
    // the paragraph that was only a picture is nothing once it is not put
    expect(skipped).toEqual(["picture pic.png"]);
  });

  it("AC-497 keeps bold inside italic as both, joins neighbours that are alike, and marks a task", () => {
    const { blocks } = parseMarkdown(
      "*one **two** three* **a***b*\n\n- [x] done\n- [ ] todo\n\n<div>x</div>",
    );
    const first = blocks[0] as any;

    expect(first.inline.text).toBe("one two three ab");
    expect(first.inline.runs).toEqual([
      { start: 0, end: 4, italic: true },
      { start: 4, end: 7, bold: true, italic: true },
      { start: 7, end: 13, italic: true },
      { start: 14, end: 15, bold: true },
      { start: 15, end: 16, italic: true },
    ]);

    const list = blocks[1] as any;

    expect(list.items[0][0].inline.text).toBe("☑ done");
    expect(list.items[1][0].inline.text).toBe("☐ todo");
  });
});

describe("markdown on a page", () => {
  it("AC-497 puts the blocks top to bottom in the width asked, each as what it is, in one undo step", async () => {
    const result = await ok("place_markdown", {
      markdown: DOCUMENT,
      x: 40,
      y: 50,
      width: 400,
    });

    expect(result).toMatchObject({
      page: 1,
      skipped: ["picture pic.png"],
      belowThePage: false,
    });
    expect(result.created).toBe(live().length);

    const title = textOf("Title");

    expect(title).toMatchObject({ x: 40, y: 50, fontSize: 36 });
    expect(title.styleRuns).toEqual([{ start: 0, end: 5, bold: true }]);

    const paragraph = textOf("Some bold and slanted and code & a < b words.");

    expect(paragraph.styleRuns).toEqual([
      { start: 5, end: 9, bold: true },
      { start: 14, end: 21, italic: true },
    ]);
    expect(paragraph).toMatchObject({ x: 40, fontSize: 20 });
    // the words wrap in the width: 400 wide, a letter 10 wide, 40 letters a line
    expect(paragraph.text.split("\n").length).toBeGreaterThan(1);
    expect(
      Math.max(
        ...paragraph.text.split("\n").map((line: string) => line.length),
      ),
    ).toBeLessThanOrEqual(40);

    const one = textOf("• one");
    const two = textOf("• two");
    const nested = textOf("• nested");
    const first = textOf("1. first");
    const second = textOf("2. second");
    const quoted = textOf("quoted words");

    expect(one.x).toBe(40);
    // a nested list is indented
    expect(nested.x).toBe(40 + 28);
    expect(second.x).toBe(40);
    expect(quoted.x).toBe(40 + 24);

    const lines = live().filter((element) => element.type === "line") as any[];
    const quoteLine = lines.find((line) => line.x === 40 + 6)!;
    const rule = lines.find((line) => line.x === 40 && line !== quoteLine)!;

    expect(lines).toHaveLength(2);
    // the line down the side of a quote is as tall as the quote
    expect(quoteLine.y).toBe(quoted.y);
    expect(quoteLine.points[1][1]).toBeCloseTo(quoted.height, 0);
    // a rule runs across the width
    expect(rule.points[1][0]).toBe(400);

    const rectangles = live().filter((element) => element.type === "rectangle");
    const table = rectangles.filter((element) => element.id !== "card");
    const card = live().find((element) => element.id === "card")!;

    expect(table).toHaveLength(4);
    expect(textOf("b")).toBeTruthy();
    expect(deps.buildCodeCard).toHaveBeenCalledWith("print(1)", "python");

    // top to bottom, in the order of the document
    const tops = [
      title.y,
      paragraph.y,
      one.y,
      two.y,
      nested.y,
      first.y,
      second.y,
      quoted.y,
      rule.y,
      Math.min(...table.map((element) => element.y)),
      card.y,
    ];

    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(new Set(tops).size).toBe(tops.length);
    // nothing runs out to the right of the width
    for (const element of live()) {
      expect(element.x).toBeGreaterThanOrEqual(40);
    }
    expect(
      Math.max(...table.map((element) => element.x + element.width)),
    ).toBeLessThanOrEqual(40 + 400);

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-497 puts it where asked on the page asked for, in the middle of the page's width when not said", async () => {
    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });

    await ok("place_markdown", { markdown: "# Two", page: 2 });

    const two = textOf("Two");

    expect(two.pageId).toBe("p2");
    // the second page starts after the first, and the default corner is 100, 100
    expect(two.x).toBeGreaterThan(1920 + 100 - 1);
    expect(two.y).toBe(100);

    // not said, the width is the page's less the margins: 1920 - 100 - 60
    await ok("place_markdown", {
      markdown: "word ".repeat(400).trim(),
    });

    const wide = live().find(
      (element) => element.pageId !== "p2" && element.type === "text",
    ) as any;

    expect(wide.x).toBe(100);
    expect(wide.width).toBeLessThanOrEqual(1920 - 100 - 60);
    expect(wide.width).toBeGreaterThan(1500);
  });

  it("AC-497 sizes the headings by their depth, gives a heading more room above it than a paragraph, and numbers a list from where it starts", async () => {
    await ok("place_markdown", {
      markdown: [
        "# one",
        "",
        "## two",
        "",
        "### three",
        "",
        "#### four",
        "",
        "##### five",
        "",
        "para",
        "",
        "## after",
        "",
        "3. c",
        "4. d",
      ].join("\n"),
      y: 0,
      width: 600,
    });

    expect(
      ["one", "two", "three", "four", "five"].map((t) => textOf(t).fontSize),
    ).toEqual([36, 30, 26, 22, 22]);
    // every heading is bold, and a paragraph is not
    expect(textOf("five").styleRuns).toEqual([
      { start: 0, end: 4, bold: true },
    ]);
    expect(textOf("para").styleRuns).toBeUndefined();

    const gap = (above: any, below: any) => below.y - (above.y + above.height);

    // a block is 14 below the one above it; a heading has ten more
    expect(gap(textOf("five"), textOf("para"))).toBe(14);
    expect(gap(textOf("para"), textOf("after"))).toBe(24);
    expect(gap(textOf("one"), textOf("two"))).toBe(24);
    expect(textOf("3. c")).toBeTruthy();
    expect(textOf("4. d")).toBeTruthy();
    // an item is 6 below the one above it
    expect(gap(textOf("3. c"), textOf("4. d"))).toBe(6);
  });

  it("AC-497 reads the entities of a text as the characters they name, leaves what is in a code span as typed, and drops html it cannot put", async () => {
    const { blocks, skipped } = parseMarkdown(
      [
        "say \"hi\" & 'bye' > a < b",
        "",
        "x <b>y</b> z",
        "",
        "&amp; &lt;b&gt; &quot;q&quot; &#39;s&#39; a&nbsp;b `&amp;`",
      ].join("\n"),
    );

    expect((blocks[0] as any).inline.text).toBe("say \"hi\" & 'bye' > a < b");
    // an inline tag is html: it is not put, and what is between is kept
    expect((blocks[1] as any).inline.text).toBe("x y z");
    expect((blocks[2] as any).inline.text).toBe("& <b> \"q\" 's' a b &amp;");
    expect(skipped).toEqual(["html"]);
  });

  it("AC-497 wraps what is in a list item or a quote in what is left of the width, and leaves room around a rule", async () => {
    const alpha = "abc ".repeat(60).trim();
    const beta = "beta ".repeat(40).trim();

    await ok("place_markdown", {
      markdown: `- top\n\n  ${alpha}\n\n> ${beta}\n\n---\n\nafter`,
      y: 0,
      width: 400,
    });

    const longest = (text: string) =>
      Math.max(...text.split("\n").map((line) => line.length));
    const inItem = textOf(alpha);
    const inQuote = textOf(beta);

    // a letter is 10 wide: 372 is room for 37 letters, and 376 for 37 as well
    expect(longest(inItem.text)).toBeLessThanOrEqual(37);
    expect(longest(inItem.text)).toBeGreaterThanOrEqual(30);
    expect(longest(inQuote.text)).toBeLessThanOrEqual(37);
    expect(longest(inQuote.text)).toBeGreaterThanOrEqual(30);
    expect(inItem.x).toBe(100 + 28);
    expect(inQuote.x).toBe(100 + 24);

    const rule = live().find(
      (element) => element.type === "line" && element.x === 100,
    )!;
    const after = textOf("after");

    // the rule is 6 below the cursor, takes 12, and a block is 14 below that
    expect(after.y - rule.y).toBe(20);
    expect(rule.y - (inQuote.y + inQuote.height)).toBe(20);
  });

  it("AC-497 fits a table to the width, does not put one that is too large and takes no room for it, and says it", async () => {
    await ok("place_markdown", {
      markdown: `| ${"x".repeat(100)} | ${"y".repeat(
        100,
      )} |\n| - | - |\n| a | b |`,
      x: 100,
      y: 100,
      width: 500,
    });

    const rectangles = live().filter((element) => element.type === "rectangle");

    expect(
      Math.max(...rectangles.map((element) => element.x + element.width)),
    ).toBeLessThanOrEqual(100 + 500);

    const big = [
      "before",
      "",
      `| ${Array.from({ length: 13 }, () => "h").join(" | ")} |`,
      `| ${Array.from({ length: 13 }, () => "-").join(" | ")} |`,
      `| ${Array.from({ length: 13 }, () => "c").join(" | ")} |`,
      "",
      "after",
    ].join("\n");
    const before = live().length;
    const result = await ok("place_markdown", { markdown: big, y: 600 });

    expect(result.skipped[0]).toMatch(/13 columns/);
    expect(live().length - before).toBe(2);

    const a = textOf("before");
    const b = textOf("after");

    // the same gap there is between any two blocks, as if the table were not there
    expect(b.y - (a.y + a.height)).toBe(14);
  });

  it("AC-497 refuses an empty text, one with nothing that can be put, a width that is not one, one that is too long and one that makes too many elements, and puts nothing", async () => {
    for (const markdown of ["", "   \n\n", "![only](a.png)", "<div>x</div>"]) {
      expect(await run("place_markdown", { markdown })).toMatchObject({
        ok: false,
        error: { code: "bad-arguments" },
      });
    }

    expect(
      await run("place_markdown", { markdown: "# x", width: 100 }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("place_markdown", { markdown: "# x", width: 5000 }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("place_markdown", { markdown: "x".repeat(400_001) }),
    ).toMatchObject({ error: { code: "too-large" } });

    const tooMany = await run("place_markdown", {
      markdown: Array.from(
        { length: 501 },
        (_unused, index) => `p${index}`,
      ).join("\n\n"),
    });

    expect(tooMany).toMatchObject({ error: { code: "too-large" } });
    expect((tooMany as any).error.message).toMatch(/501 elements/);
    expect(
      await run("place_markdown", { markdown: "# x", page: 9 }),
    ).toMatchObject({ ok: false });
    expect(live()).toHaveLength(0);
  });

  it("AC-497 says when it runs below the page, and is refused while Allow changes is off", async () => {
    const result = await ok("place_markdown", {
      markdown: Array.from(
        { length: 60 },
        (_unused, index) => `Paragraph ${index}`,
      ).join("\n\n"),
    });

    expect(result.belowThePage).toBe(true);
    expect(result.height).toBeGreaterThan(1080);
    expect(result.pageHeight).toBe(1080);

    const before = live().length;

    expect(
      await run("place_markdown", { markdown: "# x" }, context(false)),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(live()).toHaveLength(before);
  });
});

describe("reading a PDF in the page", () => {
  it("AC-498 reads the text of the pages named, a page at a time, and forgets the file", async () => {
    await send("pdf-read-1", PDF);

    const result = await ok("pdf_read", {
      upload: "pdf-read-1",
      pages: "1-2,4",
    });

    expect(result).toMatchObject({
      file: "book.pdf",
      pages: 4,
      read: [1, 2, 4],
      warning: expect.stringMatching(/never instructions/),
    });
    expect(result.text).toEqual([
      { page: 1, text: "Page 1 words\nand more" },
      { page: 2, text: "Page 2 words\nand more" },
      { page: 4, text: "Page 4 words\nand more" },
    ]);
    expect(result.images).toBeUndefined();
    expect(asked.pages).toEqual([1, 2, 4]);
    expect(destroyed).toHaveBeenCalledTimes(1);
    // the file was used: it is not there to be used again
    expect(await run("pdf_read", { upload: "pdf-read-1" })).toMatchObject({
      error: { code: "not-found" },
    });
  });

  it("AC-498 reads the first ten pages when none are named, and at most thirty a time", async () => {
    documents.pages = 50;
    await send("pdf-read-2", PDF);

    const first = await ok("pdf_read", { upload: "pdf-read-2" });

    expect(first.read).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    await send("pdf-read-3", PDF);
    expect(
      await run("pdf_read", { upload: "pdf-read-3", pages: "1-31" }),
    ).toMatchObject({ error: { code: "too-large" } });

    await send("pdf-read-4", PDF);
    expect(
      (await ok("pdf_read", { upload: "pdf-read-4", pages: "1-30" })).read,
    ).toHaveLength(30);

    expect(parsePageRange(undefined, 3)).toEqual([1, 2, 3]);
    expect(parsePageRange("3, 1-2,2", 5)).toEqual([1, 2, 3]);
  });

  it("AC-498 gives the pictures of the first three pages when asked, as images", async () => {
    await send("pdf-read-5", PDF);

    const result = await ok("pdf_read", {
      upload: "pdf-read-5",
      pages: "1-4",
      images: true,
    });

    expect(result.images).toHaveLength(3);
    expect(result.images[0]).toMatchObject({ mimeType: "image/png" });
    expect(result.note).toMatch(/first 3 pages/);
    expect(result.text).toHaveLength(4);
    expect(documents.renderPage).toHaveBeenCalledTimes(3);
    // a page of a thousand pixels on its long side: 800 * 1.25 = 1000
    expect(documents.renderPage.mock.calls[0][1]).toBeCloseTo(1.25, 5);

    // the picture is the bytes of a PNG
    const bytes = Uint8Array.from(atob(result.images[0].data), (c) =>
      c.charCodeAt(0),
    );

    expect(Array.from(bytes.slice(1, 4))).toEqual([80, 78, 71]);
  });

  it("AC-498 refuses a page that is not there, a range that is not one, a file that is not a PDF, a PDF that cannot be opened and a reader that cannot load, each with its reason", async () => {
    const readWith = async (args: Record<string, unknown>, bytes = PDF) => {
      await send("pdf-bad", bytes);

      return run("pdf_read", { upload: "pdf-bad", ...args });
    };

    expect(await readWith({ pages: "5" })).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/4 pages/),
      },
    });
    expect(await readWith({ pages: "3-2" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await readWith({ pages: "0" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await readWith({ pages: "a" })).toMatchObject({
      error: { code: "bad-arguments", message: expect.stringMatching(/1-3,5/) },
    });
    expect(await readWith({}, png(10, 10))).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a PDF/),
      },
    });

    documents.loadPdf.mockRejectedValueOnce(new Error("offline"));
    expect(await readWith({})).toMatchObject({
      error: {
        code: "failed",
        message: expect.stringMatching(/offline.*needs the internet/),
      },
    });

    destroyed.mockClear();
    documents.pages = 301;
    expect(await readWith({})).toMatchObject({
      error: { code: "too-large", message: expect.stringMatching(/301/) },
    });
    expect(destroyed).toHaveBeenCalledTimes(1);

    documents.pages = 4;
    documents.loadPdf.mockImplementationOnce(async () => ({
      getDocument: () => ({ promise: Promise.reject(new Error("bad xref")) }),
      GlobalWorkerOptions: { workerSrc: "" },
      TextLayer: class {},
    }));
    expect(await readWith({})).toMatchObject({
      error: { code: "failed", message: expect.stringMatching(/bad xref/) },
    });
  });
});

describe("a PDF page as a picture", () => {
  it("AC-499 draws the page and puts it on the page as a picture of its size, with the file and the PDF page as its source, in one undo step", async () => {
    await send("pdf-pic-1", PDF, "lesson.pdf");

    const result = await ok("place_pdf_page", {
      upload: "pdf-pic-1",
      pdfPage: 2,
      x: 30,
      y: 40,
      size: 400,
      source: { file: "lesson.pdf, page 2" },
    });

    expect(result).toMatchObject({ page: 1, pdfPage: 2, of: 4 });
    // a page of 600 by 800 drawn so that its longest side is 1600 pixels
    expect(documents.renderPage.mock.calls[0][1]).toBe(2);
    expect(documents.renderPage.mock.calls[0][2]).toBeUndefined();
    expect(result.natural).toEqual({ width: 1200, height: 1600 });

    const image = live().find((element) => element.type === "image") as any;

    // 400 on the long side, the ratio of the page
    expect(image).toMatchObject({ x: 30, y: 40, width: 300, height: 400 });
    expect(image.customData.source).toMatchObject({
      file: "lesson.pdf, page 2",
    });
    expect(asked.pages).toEqual([2]);
    expect(destroyed).toHaveBeenCalledTimes(1);

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-499 cuts the part asked for at the sharpness of the whole page, so the picture has the part's size", async () => {
    await send("pdf-pic-2", PDF);

    const result = await ok("place_pdf_page", {
      upload: "pdf-pic-2",
      pdfPage: 1,
      region: { left: 0.25, top: 0.5, width: 0.5, height: 0.25 },
      size: 300,
    });

    expect(documents.renderPage.mock.calls[0][2]).toEqual({
      left: 0.25,
      top: 0.5,
      width: 0.5,
      height: 0.25,
    });
    // half the width and a quarter of the height of 1200 by 1600
    expect(result.natural).toEqual({ width: 600, height: 400 });

    const image = live().find((element) => element.type === "image") as any;

    expect(image.width).toBe(300);
    expect(image.height).toBe(200);
  });

  it("AC-499 refuses a part outside the page, a part with no size, a page that is not there and a file that is not a PDF, and puts nothing", async () => {
    const place = async (args: Record<string, unknown>, bytes = PDF) => {
      await send("pdf-pic-bad", bytes);

      return run("place_pdf_page", {
        upload: "pdf-pic-bad",
        pdfPage: 1,
        ...args,
      });
    };

    for (const region of [
      { left: 0.6, top: 0, width: 0.5, height: 0.5 },
      { left: 0, top: 0.9, width: 0.5, height: 0.2 },
      { left: 0, top: 0, width: 0, height: 0.5 },
      { left: -0.1, top: 0, width: 0.5, height: 0.5 },
      { left: 0, top: 0, width: "half", height: 0.5 },
      "all",
    ]) {
      expect(await place({ region })).toMatchObject({
        ok: false,
        error: { code: "bad-arguments" },
      });
    }

    // a part with no width, and a part with no height, are said to need some size
    for (const region of [
      { left: 0, top: 0, width: 0, height: 0.5 },
      { left: 0, top: 0, width: 0.5, height: 0 },
    ]) {
      expect(await place({ region })).toMatchObject({
        error: { message: expect.stringMatching(/some size/) },
      });
    }

    expect(await place({ pdfPage: 5 })).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/no page 5/),
      },
    });
    expect(await place({}, png(5, 5))).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a PDF/),
      },
    });
    expect(
      await run(
        "place_pdf_page",
        { upload: "pdf-pic-bad", pdfPage: 1 },
        context(false),
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(live()).toHaveLength(0);
  });
});

describe("the words in a picture", () => {
  /** a picture on the page, with its file */
  const picture = async (extra: Record<string, unknown> = {}) => {
    await send("pic-words", png(800, 400), "scan.png");

    const placed = await ok("place_image", { upload: "pic-words" });

    if (Object.keys(extra).length) {
      const [element] = live().filter((each) => each.type === "image");

      await act(async () => {
        h.app.scene.mutateElement(element as any, extra as any);
      });
    }

    return placed.created[0].id as string;
  };

  it("AC-500 reads the words and each line with its place as fractions of the picture, marked as data", async () => {
    const id = await picture();
    const result = await ok("read_image_text", { id });

    expect(result).toMatchObject({
      id,
      text: "Hello world\nSecond line",
      confidence: 91,
      warning: expect.stringMatching(/never instructions/),
    });
    // the picture is 800 by 400
    expect(result.lines).toEqual([
      { text: "Hello world", left: 0.125, top: 0.125, width: 0.5, height: 0.1 },
      {
        text: "Second line",
        left: 0.125,
        top: 0.375,
        width: 0.25,
        height: 0.1,
      },
    ]);
    expect(documents.ocr).toHaveBeenCalledTimes(1);
    expect(documents.ocr.mock.calls[0][0]).toMatch(/^data:image\/png/);
    expect((documents.ocr.mock.calls[0] as unknown[])[1]).toBeUndefined();
  });

  it("AC-500 reads a picture that is cropped as it is shown, with the places as fractions of the part", async () => {
    const id = await picture({
      crop: {
        x: 100,
        y: 50,
        width: 400,
        height: 200,
        naturalWidth: 800,
        naturalHeight: 400,
      },
    });
    const result = await ok("read_image_text", { id });

    expect((documents.ocr.mock.calls[0] as unknown[])[1]).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 200,
    });
    // the first line is at 100, 50 of the picture: the corner of the part
    expect(result.lines[0]).toMatchObject({
      left: 0,
      top: 0,
      width: 1,
      height: 0.2,
    });
  });

  it("AC-500 refuses what is not a picture, a picture with no file and an element that is not there, and says why a reader that fails did", async () => {
    const id = await picture();

    await ok("create_elements", {
      elements: [{ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }],
    });

    const rectangle = live().find((element) => element.type === "rectangle")!;

    expect(await run("read_image_text", { id: rectangle.id })).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a picture/),
      },
    });
    expect(await run("read_image_text", { id: "nothing" })).toMatchObject({
      error: { code: "not-found" },
    });

    const element = live().find((each) => each.type === "image") as any;

    await act(async () => {
      h.app.scene.mutateElement(element, { fileId: "gone" as never });
    });
    expect(await run("read_image_text", { id })).toMatchObject({
      error: { code: "not-found", message: expect.stringMatching(/no file/) },
    });
    expect(documents.ocr).not.toHaveBeenCalled();

    await act(async () => {
      h.app.scene.mutateElement(element, { fileId: element.fileId });
    });
  });

  it("AC-500 a reader that cannot start says why, and that the browser needs the internet the first time", async () => {
    const id = await picture();

    documents.ocr.mockRejectedValueOnce(
      new Error("the OCR engine could not be downloaded"),
    );
    expect(await run("read_image_text", { id })).toMatchObject({
      error: {
        code: "failed",
        message: expect.stringMatching(
          /could not be downloaded.*needs the internet/,
        ),
      },
    });
  });
});
