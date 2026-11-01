/**
 * The tools that need what only the app has (D-407): its stickers, its tables and
 * its code cards - and the promise that every tool of the server has a handler,
 * whether it is the library's or the app's.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { Excalidraw, useExcalidrawAPI } from "@excalidraw/excalidraw";
import { MCP_HANDLERS, runMcpTool } from "@excalidraw/excalidraw/mcp/runner";
import { MCP_TOOLS } from "@excalidraw/excalidraw/mcp/toolSpecs";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { McpRunContext } from "@excalidraw/excalidraw/mcp/runner";

import { createAppTools } from "../assistant/appTools";
import { STICKERS } from "../emoji/catalog";

import type { AppToolDeps } from "../assistant/appTools";

const { h } = window;

const SVG = new File(
  ['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>'],
  "x.svg",
  { type: "image/svg+xml" },
);

const deps: AppToolDeps = {
  stickerFile: vi.fn(async () => SVG),
  getImageSize: vi.fn(async () => ({ width: 100, height: 50 })),
  // a letter is 10 wide and a line 20 tall
  tableText: {
    width: (text) => text.length * 10,
    height: (text) => (text.split("\n").length || 1) * 20,
    wrap: (text) => text,
  },
  buildCodeCard: vi.fn(async (code: string, language?: string) => ({
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
        text: "print('hi')",
      }),
    ] as never,
    width: 300,
    height: 120,
    highlighted: language === "python" && code.length > 0,
  })),
};

let api: any = null;

/** the editor's own api, as the app's tools are given it */
const GrabApi = () => {
  api = useExcalidrawAPI();

  return null;
};

/** the app's tools, and what the runner needs to hand them */
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

const live = () => h.elements.filter((element) => !element.isDeleted);

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

beforeEach(async () => {
  vi.mocked(deps.stickerFile).mockClear();
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <GrabApi />
    </Excalidraw>,
  );
});

describe("the app's tools", () => {
  const withApi = () => context();

  it("AC-482 finds stickers by words, by kind, and with no words the whole set", async () => {
    const context = withApi();
    const all = await run("list_stickers", {}, context);
    const fire = await run("list_stickers", { query: "fire" }, context);
    const gifs = await run("list_stickers", { kind: "gif" }, context);

    expect(all).toMatchObject({ ok: true });
    expect((all as any).result.total).toBe(STICKERS.length);
    expect((fire as any).result.stickers[0]).toMatchObject({
      id: "fire",
      kind: "emoji",
      label: "Fire",
    });
    expect(
      (gifs as any).result.stickers.every((s: any) => s.kind === "gif"),
    ).toBe(true);
    expect(
      (await run("list_stickers", { query: "zzzzqq" }, context)) as any,
    ).toMatchObject({
      result: { total: 0, stickers: [] },
    });
    expect(
      await run("list_stickers", { kind: "video" }, context),
    ).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });

  it("AC-482 puts a sticker on the page named, with its top-left where asked and its longest side as asked, in one undo step", async () => {
    const context = withApi();

    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });

    const result = await run(
      "insert_sticker",
      { id: "fire", page: 2, x: 120, y: 80, size: 300 },
      context,
    );

    expect(result).toMatchObject({ ok: true });

    const image = live().find((element) => element.type === "image") as any;

    expect(image.pageId).toBe("p2");
    expect(image).toMatchObject({ width: 300, height: 150 });
    expect(h.state.pages[0].id).not.toBe(image.pageId);
    expect((result as any).result.created[0]).toMatchObject({
      page: 2,
      x: 120,
      y: 80,
    });
    expect(Object.keys(h.app.files)).toContain(image.fileId);
    expect(h.app.files[image.fileId].mimeType).toBe("image/svg+xml");

    undo();
    expect(live().filter((element) => element.type === "image")).toHaveLength(
      0,
    );
  });

  it("AC-482 a sticker with no place goes in the middle of the page, and a sticker that is not there is refused with what is near it", async () => {
    const context = withApi();

    await run("insert_sticker", { id: "joy" }, context);

    const image = live().find((element) => element.type === "image") as any;

    expect(image.x + image.width / 2).toBeCloseTo(1920 / 2, 0);
    expect(image.y + image.height / 2).toBeCloseTo(1080 / 2, 0);

    const missing = await run("insert_sticker", { id: "fir" }, context);

    expect(missing).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect((missing as any).error.message).toMatch(/list_stickers/);
    // what is near the word is told: "fir" is the start of "fire"
    expect((missing as any).error.message).toMatch(/Near it: .*fire/);
    expect(
      await run("insert_sticker", { id: "joy", size: 5 }, context),
    ).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });

  it("AC-483 draws a table of boxes and their texts, grouped, at the point asked for, never wider than the page", async () => {
    const context = withApi();
    const result = await run(
      "insert_table",
      {
        rows: [["Name", "Role"], ["Ada", "Programmer"], ["Grace"]],
        x: 200,
        y: 300,
      },
      context,
    );

    expect(result).toMatchObject({ ok: true });
    expect((result as any).result).toMatchObject({
      rows: 3,
      columns: 2,
      created: 12,
    });

    const rectangles = live().filter((element) => element.type === "rectangle");
    const texts = live().filter((element) => element.type === "text") as any[];

    expect(rectangles).toHaveLength(6);
    expect(texts.map((text) => text.text).sort()).toEqual(
      ["", "Ada", "Grace", "Name", "Programmer", "Role"].sort(),
    );
    expect(Math.min(...rectangles.map((r) => r.x))).toBe(200);
    expect(Math.min(...rectangles.map((r) => r.y))).toBe(300);
    // one group: the table moves as one
    expect(new Set(live().map((element) => element.groupIds[0])).size).toBe(1);

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-483 a table of long texts is made no wider than what is left of the page", async () => {
    const context = withApi();
    // ten wide a letter, so each of these cells is 1500 wide
    const long = "x".repeat(150);
    const result = await run(
      "insert_table",
      { rows: [[long, long]], x: 200, y: 100 },
      context,
    );

    expect(result).toMatchObject({ ok: true });
    // the page is 1920 wide: 200 to the left, and 40 kept to the right
    expect((result as any).result.width).toBeLessThanOrEqual(1920 - 200 - 40);
    expect(
      Math.max(
        ...live()
          .filter((element) => element.type === "rectangle")
          .map((element) => element.x + element.width),
      ),
    ).toBeLessThanOrEqual(1920 - 40);
  });

  it("AC-483 refuses a table that is not rows of texts, or is too large", async () => {
    const context = withApi();

    for (const rows of ["a", [], [["a", 1]], [[["x"]]]]) {
      expect(await run("insert_table", { rows }, context)).toMatchObject({
        error: { code: expect.stringMatching(/bad-arguments/) },
      });
    }

    expect(
      await run(
        "insert_table",
        { rows: Array.from({ length: 61 }, () => ["a"]) },
        context,
      ),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run(
        "insert_table",
        { rows: [Array.from({ length: 13 }, () => "a")] },
        context,
      ),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run("insert_table", { rows: [["x".repeat(501)]] }, context),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(live()).toHaveLength(0);
  });

  it("AC-483 puts a code card at the point asked for, on the page asked for, and says whether it is highlighted", async () => {
    const context = withApi();

    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });

    const result = await run(
      "insert_code_card",
      { code: "print('hi')", language: "python", page: 2, x: 50, y: 60 },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      result: { page: 2, highlighted: true, created: 2, width: 300 },
    });
    expect(deps.buildCodeCard).toHaveBeenCalledWith("print('hi')", "python");

    const card = live().find((element) => element.id === "card")!;

    expect(card.pageId).toBe("p2");
    // the second page starts after the first and the space between
    expect(card.x).toBeGreaterThan(1920);

    expect(
      await run("insert_code_card", { code: "   " }, context),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("insert_code_card", { code: "x".repeat(20001) }, context),
    ).toMatchObject({ error: { code: "bad-arguments" } });
  });

  it("AC-483 the tools that change the board are refused while Allow changes is off, and a build without them says so", async () => {
    const off: McpRunContext = { ...withApi(), allowChanges: false };

    for (const [tool, args] of [
      ["insert_sticker", { id: "joy" }],
      ["insert_table", { rows: [["a"]] }],
      ["insert_code_card", { code: "x" }],
    ] as const) {
      expect(await run(tool, args, off)).toMatchObject({
        error: { code: "changes-not-allowed" },
      });
    }

    const bare: McpRunContext = {
      allowChanges: true,
      app: "test",
      features: [],
    };

    expect(await run("list_stickers", {}, bare)).toMatchObject({
      ok: false,
      error: {
        code: "failed",
        message: expect.stringMatching(/does not have list_stickers/),
      },
    });
    expect(live()).toHaveLength(0);
  });
});

describe("the tools of the server", () => {
  it("AC-484 every tool has a handler - the library's, or the app's - and the app has no handler for a tool that is not its own", () => {
    const appTools = Object.keys(createAppTools(() => null, deps)).sort();
    const wanted = MCP_TOOLS.filter((tool) => tool.app)
      .map((tool) => tool.name)
      .sort();
    const library = MCP_TOOLS.filter((tool) => !tool.app && !tool.server)
      .map((tool) => tool.name)
      .sort();

    expect(appTools).toEqual(wanted);
    expect(Object.keys(MCP_HANDLERS).sort()).toEqual(library);
    expect(wanted).toEqual([
      "build_page",
      "insert_code_card",
      "insert_code_panel",
      "insert_sticker",
      "insert_table",
      "insert_youtube",
      "list_stickers",
      "make_slides",
      "pdf_read",
      "place_markdown",
      "place_pdf_page",
      "place_video",
      "read_code_panel",
      "read_image_text",
      "run_code",
      "set_code_panel",
    ]);
  });
});
