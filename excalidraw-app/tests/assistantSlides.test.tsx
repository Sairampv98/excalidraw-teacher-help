/**
 * The page's half of the class tools (D-422, D-423): a deck of slides made from
 * a script, and a lesson page made of blocks.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { Excalidraw, useExcalidrawAPI } from "@excalidraw/excalidraw";
import { runMcpTool } from "@excalidraw/excalidraw/mcp/runner";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { McpRunContext } from "@excalidraw/excalidraw/mcp/runner";

import { createAppTools } from "../assistant/appTools";
import { splitSlides } from "../assistant/classTools";

import type { AppToolDeps } from "../assistant/appTools";

const { h } = window;

/** a letter is half a size wide and a line a size and a quarter tall */
const text = {
  size: (words: string, fontSize: number) => {
    const lines = words.split("\n");

    return {
      width: Math.max(...lines.map((line) => line.length)) * fontSize * 0.5,
      height: lines.length * fontSize * 1.25,
    };
  },
  wrap: (words: string, fontSize: number, width: number) => {
    const room = Math.max(1, Math.floor(width / (fontSize * 0.5)));
    const out: string[] = [];

    for (const paragraph of words.split("\n")) {
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
};

const deps: AppToolDeps = {
  stickerFile: vi.fn(),
  getImageSize: vi.fn(),
  // a letter is 10 wide and a line 20 tall
  tableText: {
    width: (words) => words.length * 10,
    height: (words) => (words.split("\n").length || 1) * 20,
    wrap: (words) => words,
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
  text,
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
const words = () => texts().map((element) => element.originalText);
const at = (original: string) =>
  texts().find((element) => element.originalText === original);

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

const pages = () => h.state.pages;
const names = () => pages().map((page) => page.name);

beforeEach(async () => {
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <GrabApi />
    </Excalidraw>,
  );
});

const SCRIPT = [
  "# The plan",
  "",
  "What the class is about.",
  "",
  "---",
  "",
  "# The steps",
  "",
  "- one",
  "- two",
].join("\n");

describe("a deck of slides", () => {
  it("AC-513 splits a script on the lines of three dashes", () => {
    expect(splitSlides("one\n---\ntwo")).toEqual(["one", "two"]);
    // a longer line of dashes is a boundary too
    expect(splitSlides("one\n-----\ntwo")).toEqual(["one", "two"]);
    // a line of dashes with words on it is not a boundary
    expect(splitSlides("one\n--- words\ntwo")).toEqual(["one\n--- words\ntwo"]);
    // the empties at the end of a script are dropped
    expect(splitSlides("one\n---\n\n---")).toEqual(["one"]);
  });

  it("AC-513 makes a deck: a page for each slide, named after its first heading, the slides on their own pages, one undo step takes it all away", async () => {
    const result = await ok("make_slides", { script: SCRIPT });

    expect(result.slides).toBe(2);
    expect(result.pages).toEqual([
      { slide: 1, page: 2, name: "The plan" },
      { slide: 2, page: 3, name: "The steps" },
    ]);
    expect(names()).toEqual(["Page 1", "The plan", "The steps"]);

    // the words of a slide are on that slide's page
    const [first, second] = pages().slice(1);

    expect(
      texts().filter((element) => element.pageId === first.id),
    ).toHaveLength(2);
    expect(
      texts().filter((element) => element.pageId === second.id),
    ).toHaveLength(3);
    expect(words()).toEqual(
      expect.arrayContaining(["The plan", "What the class is about.", "• one"]),
    );

    // a slide is laid out on its own page, from the page's corner
    expect(at("The plan")!.x).toBe(2120 + 100);
    expect(at("The plan")!.y).toBe(100);

    undo();
    expect(pages()).toHaveLength(1);
    expect(live()).toHaveLength(0);
  });

  it("AC-513 opens the first slide when it is told to, and leaves the view where it was when it is not", async () => {
    const before = h.state.currentPageId;
    await ok("make_slides", { script: SCRIPT });

    expect(h.state.currentPageId).toBe(before);

    const second = await ok("make_slides", { script: "only one", open: true });

    expect(h.state.currentPageId).toBe(pages()[second.pages[0].page - 1].id);
  });

  it("AC-513 refuses a script that is not a script, a slide with nothing in it, too many slides, a script too long, and Allow changes off, and makes nothing", async () => {
    const before = pages().length;

    expect(await run("make_slides", { script: "   " })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("make_slides", {
        script: "# Words\n\n---\n\n   \n\n---\n\n# More",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("make_slides", {
        script: Array.from(
          { length: 61 },
          (_unused, index) => `# S${index}`,
        ).join("\n---\n"),
      }),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run("make_slides", { script: "x".repeat(200_001) }),
    ).toMatchObject({ error: { code: "too-large" } });
    // a deck that is too big to be made in one call is refused whole
    expect(
      await run("make_slides", {
        script: Array.from({ length: 60 }, (_unused, slide) =>
          Array.from(
            { length: 9 },
            (_other, line) => `line ${slide}-${line}`,
          ).join("\n\n"),
        ).join("\n\n---\n\n"),
      }),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run(
        "make_slides",
        { script: SCRIPT },
        { ...context(), allowChanges: false },
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });

    expect(pages()).toHaveLength(before);
    expect(live()).toHaveLength(0);
  });
});

describe("a lesson page", () => {
  const BLOCKS = [
    { type: "title", text: "Fractions" },
    { type: "heading", text: "What they are" },
    { type: "text", text: "A part of a whole." },
    { type: "bullets", items: ["half", "third"] },
    { type: "quote", text: "A whole is one." },
    { type: "divider" },
    {
      type: "table",
      rows: [
        ["Name", "Meaning"],
        ["half", "one of two"],
      ],
    },
    { type: "code", code: "print(1)", language: "python" },
    { type: "chart", kind: "process", script: "Plan\nTeach\nCheck" },
  ];

  it("AC-514 builds a page out of blocks, one under the other, and one undo step takes it away", async () => {
    const result = await ok("build_page", { blocks: BLOCKS });

    expect(result.page).toBe(1);
    expect(result.created).toBeGreaterThan(0);

    // the words of every block are there
    expect(words()).toEqual(
      expect.arrayContaining([
        "Fractions",
        "What they are",
        "A part of a whole.",
        "• half",
        "• third",
        "A whole is one.",
        "Name",
        "Meaning",
        "half",
        "one of two",
        "print(1)",
      ]),
    );

    // the blocks are laid out one under the other
    expect(at("Fractions")!.y).toBeLessThan(at("What they are")!.y);
    expect(at("What they are")!.y).toBeLessThan(at("A part of a whole.")!.y);
    expect(at("A part of a whole.")!.y).toBeLessThan(at("• half")!.y);
    expect(at("• half")!.y).toBeLessThan(at("A whole is one.")!.y);

    // the title is a title and the words are words
    expect(at("Fractions")!.fontSize).toBe(36);
    expect(at("What they are")!.fontSize).toBe(30);
    expect(at("A part of a whole.")!.fontSize).toBe(20);

    // the rule, the table and the chart are there
    expect(live().filter((element) => element.type === "line")).toHaveLength(2);
    expect(
      live().filter(
        (element) =>
          (element.customData as any)?.flow?.chartId &&
          element.type !== "text" &&
          element.type !== "arrow",
      ),
    ).toHaveLength(3);

    // everything is on the page it was made for
    expect(live().every((element) => element.pageId === pages()[0].id)).toBe(
      true,
    );

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-514 refuses a page that is not made of blocks, a block that is not a block, a block without its words, a table too large, code too long, a chart with a bad script, a chart that cannot spread, and a width out of range, and makes nothing", async () => {
    expect(await run("build_page", {})).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("build_page", { blocks: [] })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("build_page", { blocks: [{ type: "pizza" }] }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    // and a block that is not a block is refused even when it has words
    expect(
      await run("build_page", { blocks: [{ type: "pizza", text: "words" }] }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("build_page", { blocks: [{ type: "text" }] }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("build_page", { blocks: [{ type: "bullets" }] }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    // bullets that are not words are refused too
    expect(
      await run("build_page", { blocks: [{ type: "bullets", items: [1, 2] }] }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("build_page", {
        blocks: [
          {
            type: "table",
            rows: Array.from({ length: 61 }, (_unused, index) => [
              `row ${index}`,
            ]),
          },
        ],
      }),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run("build_page", {
        blocks: [{ type: "code", code: "x".repeat(20_001) }],
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    // a page that is too big to be made in one call is refused whole
    expect(
      await run("build_page", {
        blocks: [
          {
            type: "table",
            rows: Array.from({ length: 30 }, (_unused, row) =>
              Array.from(
                { length: 10 },
                (_other, column) => `${row}-${column}`,
              ),
            ),
          },
        ],
      }),
    ).toMatchObject({ error: { code: "too-large" } });
    const emptyScript = await run("build_page", {
      blocks: [{ type: "chart", kind: "process", script: " " }],
    });
    expect(emptyScript).toMatchObject({ error: { code: "bad-arguments" } });
    // and it says the script is the problem, not the chart
    expect((emptyScript as any).error.message).toContain(
      "must have a script of",
    );
    expect(
      await run("build_page", {
        blocks: [
          { type: "chart", kind: "process", script: "a\nb", fit: "spread" },
        ],
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("build_page", { blocks: BLOCKS, width: 10 }),
    ).toMatchObject({ error: { code: "bad-arguments" } });

    expect(live()).toHaveLength(0);
  });
});
