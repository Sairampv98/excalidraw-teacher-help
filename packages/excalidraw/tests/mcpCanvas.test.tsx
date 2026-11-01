/**
 * The tools that arrange, style, check and look (D-405, D-406): the editor's
 * actions by name and the promise that none is left out, duplicating, a part of
 * a text in bold, binding an arrow, the check of a page, the canvas and the view,
 * search and numbers, export, putting a saved document on a page, and Mermaid.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Excalidraw } from "../index";
import { MCP_ACTION_CATALOG } from "../mcp/actionCatalog";
import { SMALL_TEXT, contrastRatio, rgbOf } from "../mcp/arrangeTools";
import { runMcpTool } from "../mcp/runner";

import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { McpRunContext } from "../mcp/runner";

const { h } = window;

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: vi.fn(async (source: string) => {
    if (/broken/.test(source)) {
      throw new Error("Parse error on line 1");
    }

    return {
      elements: [
        {
          type: "rectangle",
          id: "A",
          x: 40,
          y: 60,
          width: 120,
          height: 60,
          label: { text: "Start" },
        },
        {
          type: "rectangle",
          id: "B",
          x: 240,
          y: 60,
          width: 120,
          height: 60,
          label: { text: "End" },
        },
        {
          type: "arrow",
          x: 160,
          y: 90,
          width: 80,
          height: 0,
          start: { id: "A" },
          end: { id: "B" },
        },
      ],
      files: {},
    };
  }),
}));

const CONTEXT: McpRunContext = {
  allowChanges: true,
  app: "test",
  features: [],
};

const run = async (name: string, args: unknown = {}, context = CONTEXT) => {
  let outcome: Awaited<ReturnType<typeof runMcpTool>> | undefined;

  await act(async () => {
    outcome = await runMcpTool(h.app, name, args, context);
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

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

const live = () => h.elements.filter((element) => !element.isDeleted);
const byId = (id: string) => live().find((element) => element.id === id) as any;

const boxes = () =>
  ok("create_elements", {
    elements: [
      { type: "rectangle", id: "a", x: 100, y: 100, width: 100, height: 100 },
      { type: "rectangle", id: "b", x: 400, y: 300, width: 100, height: 100 },
      { type: "rectangle", id: "c", x: 700, y: 120, width: 100, height: 100 },
    ],
  });

beforeEach(async () => {
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true} />,
  );
});

describe("the editor's actions", () => {
  it("AC-474 lists every action: those it runs, those another tool does, those for later, and those that are not for an assistant, with why", async () => {
    const list = await ok("list_actions");

    expect(list.run.map((entry: any) => entry.name)).toEqual(
      expect.arrayContaining([
        "alignLeft",
        "group",
        "bringToFront",
        "flipHorizontal",
        "gridMode",
      ]),
    );
    expect(
      list.coveredByATool.find(
        (entry: any) => entry.name === "changeStrokeColor",
      ),
    ).toEqual({
      name: "changeStrokeColor",
      use: "set_properties",
    });
    expect(
      list.comingLater.find((entry: any) => entry.name === "flowLayout"),
    ).toMatchObject({ use: "flow_layout" });
    expect(
      list.notForTheAssistant.find((entry: any) => entry.name === "undo").why,
    ).toMatch(/Ctrl\+Z/);
  });

  it("AC-474 aligns, flips, layers and locks the elements it is given, in one undo step, and leaves the person's selection as it was", async () => {
    await boxes();
    act(() => {
      h.setState({ selectedElementIds: { c: true } });
    });

    await ok("run_action", { name: "alignLeft", ids: ["a", "b"] });
    expect(byId("a").x).toBe(byId("b").x);
    expect(
      Object.keys(h.state.selectedElementIds).filter(
        (id) => h.state.selectedElementIds[id],
      ),
    ).toEqual(["c"]);

    undo();
    expect(byId("b").x).toBe(400);

    await ok("run_action", { name: "toggleElementLock", ids: ["a"] });
    expect(byId("a").locked).toBe(true);

    await ok("run_action", { name: "flipHorizontal", ids: ["c"] });
    await ok("run_action", { name: "sendToBack", ids: ["c"] });
    expect(live()[0].id).toBe("c");

    await ok("run_action", {
      name: "distributeHorizontally",
      ids: ["a", "b", "c"],
    });
    expect(await run("run_action", { name: "gridMode" })).toMatchObject({
      ok: true,
    });
    expect(h.state.gridModeEnabled).toBe(true);
  });

  it("AC-474 groups elements and takes them out of the group again", async () => {
    await boxes();
    await ok("run_action", { name: "group", ids: ["a", "b"] });

    expect(byId("a").groupIds).toHaveLength(1);
    expect(byId("a").groupIds).toEqual(byId("b").groupIds);

    await ok("run_action", { name: "ungroup", ids: ["a"] });
    expect(byId("a").groupIds).toHaveLength(0);
  });

  it("AC-474 AC-520 says why when an action is not one it runs: the tool that does it, the tool that comes later, or why it is not for an assistant", async () => {
    await boxes();

    expect(
      await run("run_action", { name: "changeStrokeColor", ids: ["a"] }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/set_properties/),
      },
    });
    expect(
      await run("run_action", { name: "flowLayout", ids: ["a"] }),
    ).toMatchObject({
      error: {
        message: expect.stringMatching(/in a later part of the server/),
      },
    });
    expect(await run("run_action", { name: "undo" })).toMatchObject({
      error: { message: expect.stringMatching(/not for the assistant/) },
    });
    expect(await run("run_action", { name: "teleport" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("run_action", { name: "alignLeft", ids: ["a"] }),
    ).toMatchObject({
      error: { message: expect.stringMatching(/at least 2 elements/) },
    });
    expect(await run("run_action", { name: "group" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("run_action", { name: "group", ids: ["a", "ghost"] }),
    ).toMatchObject({ error: { code: "not-found" } });
  });

  it("AC-475 every action the editor registers is named in the list, and every name in it is registered", () => {
    const registered = Object.keys((h.app as any).actionManager.actions).sort();
    const named = MCP_ACTION_CATALOG.map((entry) => entry.name).sort();

    expect(registered.filter((name) => !named.includes(name))).toEqual([]);
    expect(named.filter((name) => !registered.includes(name))).toEqual([]);
    expect(new Set(named).size).toBe(named.length);

    // the tools the list points to are tools of the server
    for (const entry of MCP_ACTION_CATALOG) {
      if (entry.use === "excluded") {
        expect(entry.why.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("copying, styling a text and binding an arrow", () => {
  it("AC-476 copies elements with the words in them and the arrows between them, to the side, in one undo step", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "p",
          x: 100,
          y: 100,
          width: 160,
          height: 80,
          label: { text: "Copy me" },
        },
        { type: "rectangle", id: "q", x: 500, y: 100, width: 160, height: 80 },
        {
          type: "arrow",
          id: "pq",
          x: 260,
          y: 140,
          points: [
            [0, 0],
            [240, 0],
          ],
          start: { id: "p" },
          end: { id: "q" },
        },
      ],
    });

    const { created } = await ok("duplicate_elements", {
      ids: ["p", "q", "pq"],
      dx: 0,
      dy: 300,
    });

    // two shapes, the words, the arrow
    expect(created).toHaveLength(4);
    expect(live()).toHaveLength(8);
    expect(
      created.find(
        (entry: any) => entry.type === "rectangle" && entry.text === "Copy me",
      ).y,
    ).toBe(400);
    expect(
      created.every((entry: any) => !["p", "q", "pq"].includes(entry.id)),
    ).toBe(true);

    const copiedArrow = live().find(
      (element) => element.type === "arrow" && element.id !== "pq",
    ) as any;
    const copiedIds = created.map((entry: any) => entry.id);

    expect(copiedIds).toContain(copiedArrow.startBinding.elementId);
    expect(copiedIds).toContain(copiedArrow.endBinding.elementId);

    undo();
    expect(live()).toHaveLength(4);
  });

  it("AC-476 makes a part of a text bold or italic, and plain again, and says what it did", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "text",
          id: "t",
          x: 0,
          y: 0,
          text: "Hello brave world",
          fontSize: 28,
        },
      ],
    });

    expect(
      await ok("style_text", { id: "t", start: 6, end: 11, bold: true }),
    ).toMatchObject({
      start: 6,
      end: 11,
      bold: true,
      italic: false,
    });
    expect(byId("t").styleRuns).toEqual([{ start: 6, end: 11, bold: true }]);

    await ok("style_text", { id: "t", italic: true });
    expect(byId("t").styleRuns.some((run: any) => run.italic)).toBe(true);

    await ok("style_text", { id: "t", bold: false, italic: false });
    expect(byId("t").styleRuns).toBeUndefined();

    undo();
    expect(byId("t").styleRuns).toBeDefined();

    expect(await run("style_text", { id: "t" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("style_text", { id: "t", bold: true, start: 5, end: 99 }),
    ).toMatchObject({
      error: { message: expect.stringMatching(/17 characters/) },
    });
  });

  it("AC-476 styles the words of a shape through the shape", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "r",
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          label: { text: "Boxed" },
        },
      ],
    });
    await ok("style_text", { id: "r", bold: true });

    const words = live().find(
      (element) => (element as any).containerId === "r",
    ) as any;

    expect(words.styleRuns).toEqual([{ start: 0, end: 5, bold: true }]);
    expect(await run("style_text", { id: "ghost", bold: true })).toMatchObject({
      error: { code: "not-found" },
    });
  });

  it("AC-476 binds the ends of an arrow to shapes, and takes them off", async () => {
    await ok("create_elements", {
      elements: [
        { type: "rectangle", id: "s", x: 100, y: 100, width: 120, height: 80 },
        { type: "rectangle", id: "e", x: 500, y: 100, width: 120, height: 80 },
        {
          type: "arrow",
          id: "loose",
          x: 240,
          y: 140,
          points: [
            [0, 0],
            [240, 0],
          ],
        },
        { type: "ellipse", id: "x", x: 900, y: 100, width: 80, height: 80 },
      ],
    });

    expect(
      await ok("bind_arrow", { arrow: "loose", start: "s", end: "e" }),
    ).toEqual({ arrow: "loose", start: "s", end: "e" });
    expect(byId("loose").startBinding.elementId).toBe("s");
    expect(byId("loose").endBinding.elementId).toBe("e");
    expect(
      byId("s").boundElements.some((bound: any) => bound.id === "loose"),
    ).toBe(true);
    expect(
      byId("e").boundElements.some((bound: any) => bound.id === "loose"),
    ).toBe(true);

    await ok("bind_arrow", { arrow: "loose", end: null });
    expect(byId("loose").endBinding).toBeNull();
    expect(
      byId("e").boundElements.some((bound: any) => bound.id === "loose"),
    ).toBe(false);

    expect(await run("bind_arrow", { arrow: "s", start: "e" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("bind_arrow", { arrow: "loose" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("bind_arrow", { arrow: "loose", start: 5 })).toMatchObject(
      { error: { code: "bad-arguments" } },
    );
  });
});

describe("checking a page", () => {
  it("AC-477 reads colours and works out their contrast", () => {
    expect(rgbOf("#fff")).toEqual([255, 255, 255]);
    expect(rgbOf("#1e1e1e")).toEqual([30, 30, 30]);
    expect(rgbOf("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(rgbOf("white")).toEqual([255, 255, 255]);
    expect(rgbOf("transparent")).toBeNull();
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("AC-477 finds what would not read well - outside the page, on top of each other, small, too pale - and says ok when there is none", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "text",
          id: "fine",
          x: 100,
          y: 100,
          text: "Readable heading",
          fontSize: 36,
        },
        {
          type: "rectangle",
          id: "one",
          x: 100,
          y: 300,
          width: 300,
          height: 200,
        },
        {
          type: "rectangle",
          id: "two",
          x: 150,
          y: 350,
          width: 300,
          height: 200,
        },
        {
          type: "text",
          id: "tiny",
          x: 100,
          y: 700,
          text: "tiny words",
          fontSize: 12,
        },
        {
          type: "text",
          id: "pale",
          x: 100,
          y: 800,
          text: "pale words",
          fontSize: 28,
          strokeColor: "#f1f3f5",
        },
        {
          type: "rectangle",
          id: "off",
          x: 1800,
          y: 900,
          width: 400,
          height: 100,
        },
        {
          type: "rectangle",
          id: "left",
          x: -80,
          y: 100,
          width: 100,
          height: 60,
        },
      ],
    });

    const result = await ok("check_page");
    const kinds = result.issues.map(
      (issue: any) => `${issue.kind}:${issue.ids.join("+")}`,
    );

    expect(result.ok).toBe(false);
    expect(kinds).toContain("overlap:one+two");
    expect(kinds).toContain("small-text:tiny");
    expect(kinds).toContain("low-contrast:pale");
    expect(kinds).toContain("outside-page:off");
    expect(kinds).toContain("outside-page:left");
    expect(kinds.some((kind: string) => kind.endsWith("fine"))).toBe(false);
    expect(result.contentStartsAt).toEqual({ x: -80, y: 100 });
    expect(SMALL_TEXT).toBe(18);

    await ok("delete_elements", {
      ids: ["one", "tiny", "pale", "off", "left"],
    });
    expect(await ok("check_page")).toMatchObject({ ok: true, issues: [] });
  });

  it("AC-477 a text on a dark shape is read against the shape, and an empty page is a note, not a problem", async () => {
    expect(await ok("check_page")).toMatchObject({
      ok: true,
      issues: [{ kind: "empty", severity: "note" }],
    });

    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "dark",
          x: 100,
          y: 100,
          width: 300,
          height: 120,
          backgroundColor: "#1e1e1e",
          fillStyle: "solid",
          label: { text: "On dark", fontSize: 28 },
        },
      ],
    });
    expect(
      (await ok("check_page")).issues.map((issue: any) => issue.kind),
    ).toContain("low-contrast");

    await ok("set_properties", {
      ids: ["dark"],
      properties: { strokeColor: "#ffffff" },
    });
    expect(
      (await ok("check_page")).issues.map((issue: any) => issue.kind),
    ).not.toContain("low-contrast");
  });
});

describe("the canvas and the view", () => {
  it("AC-478 changes the canvas background in one undo step, the grid and the snapping, and the name", async () => {
    await ok("set_canvas", { backgroundColor: "#fff3bf" });
    expect(h.state.viewBackgroundColor).toBe("#fff3bf");

    await ok("set_canvas", {
      grid: true,
      gridSize: 40,
      snapToObjects: true,
      snapToMidpoints: false,
      theme: "dark",
      zen: true,
      stats: true,
      name: "Lesson 3",
    });
    expect(h.state).toMatchObject({
      gridModeEnabled: true,
      gridSize: 40,
      objectsSnapModeEnabled: true,
      isMidpointSnappingEnabled: false,
      theme: "dark",
      zenModeEnabled: true,
      name: "Lesson 3",
    });
    expect(h.state.stats.open).toBe(true);

    undo();
    expect(h.state.viewBackgroundColor).not.toBe("#fff3bf");

    for (const bad of [
      {},
      { backgroundColor: "url(x)" },
      { theme: "sepia" },
      { gridSize: 1 },
      { name: "x".repeat(200) },
    ]) {
      expect(await run("set_canvas", bad)).toMatchObject({
        ok: false,
        error: { code: "bad-arguments" },
      });
    }
  });

  it("AC-478 moves the view - a zoom, a point of a page, the page, some elements - and picks the tool", async () => {
    await boxes();

    await ok("set_view", { zoom: 2 });
    expect(h.state.zoom.value).toBe(2);

    await ok("set_view", { center: { x: 500, y: 300 }, zoom: 1 });
    expect(h.state.scrollX).toBeCloseTo(h.state.width / 2 - 500, 3);

    expect(await ok("set_view", { fit: "page" })).toMatchObject({ page: 1 });
    expect(await ok("set_view", { fit: "elements", ids: ["a"] })).toEqual({
      elements: 1,
    });
    expect(await run("set_view", { fit: "selection" })).toMatchObject({
      error: { code: "not-found" },
    });
    expect(await run("set_view", {})).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("set_view", { zoom: 100 })).toMatchObject({
      error: { code: "bad-arguments" },
    });

    await ok("set_tool", { tool: "freedraw" });
    expect(h.state.activeTool.type).toBe("freedraw");
    expect(await run("set_tool", { tool: "wand" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });

  it("AC-478 finds words, and the shape they are in, and can select them", async () => {
    await ok("create_elements", {
      elements: [
        { type: "text", id: "t1", x: 0, y: 0, text: "Apples and pears" },
        {
          type: "rectangle",
          id: "r1",
          x: 0,
          y: 200,
          width: 200,
          height: 100,
          label: { text: "More APPLES" },
        },
        { type: "text", id: "t2", x: 0, y: 400, text: "Oranges" },
      ],
    });

    const found = await ok("find_text", { query: "apples" });

    expect(found.total).toBe(2);
    expect(
      found.matches.map((match: any) => match.containerId ?? match.id).sort(),
    ).toEqual(["r1", "t1"]);
    expect(
      (await ok("find_text", { query: "apples", caseSensitive: true })).total,
    ).toBe(0);
    // words in capitals find the words in small letters, unless the case matters
    expect((await ok("find_text", { query: "APPLES" })).total).toBe(2);
    expect(
      (await ok("find_text", { query: "APPLES", caseSensitive: true })).total,
    ).toBe(1);

    await ok("find_text", { query: "oranges", select: true });
    expect(h.state.selectedElementIds).toEqual({ t2: true });
    expect(await run("find_text", { query: "" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });

  it("AC-478 gives the numbers of the stats panel: counts, pages, and where the selection is", async () => {
    await boxes();
    await ok("add_page", {});

    const stats = await ok("get_stats", { ids: ["a", "b"] });

    expect(stats.document).toMatchObject({
      pages: 2,
      elements: 3,
      byType: { rectangle: 3 },
    });
    expect(stats.pages).toEqual([
      { page: 1, name: "Page 1", elements: 3 },
      { page: 2, name: "Page 2", elements: 0 },
    ]);
    expect(stats.selection).toMatchObject({
      count: 2,
      page: 1,
      x: 100,
      y: 100,
      width: 400,
      height: 300,
    });
    expect((await ok("get_stats", { ids: ["a"] })).selection).toMatchObject({
      id: "a",
      type: "rectangle",
      angle: 0,
    });
    expect((await ok("get_stats")).selection).toBeNull();
  });
});

describe("export and insert", () => {
  it("AC-479 exports a page as a picture, as SVG and as the saved document, and says when it cannot", async () => {
    await boxes();

    const png = await ok("export_scene", { scale: 1 });

    expect(png).toMatchObject({ format: "png", scope: "page", page: 1 });
    expect(png.images[0]).toMatchObject({ mimeType: "image/png" });

    const svg = await ok("export_scene", { format: "svg", scope: "all" });

    expect(svg.text).toMatch(/^<svg/);

    const json = await ok("export_scene", { format: "json" });
    const saved = JSON.parse(json.text);

    expect(saved.type).toBe("excalidraw");
    expect(saved.elements).toHaveLength(3);

    expect(await run("export_scene", { format: "gif" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("export_scene", { scope: "selection" })).toMatchObject({
      error: { code: "not-found" },
    });
    expect(await run("export_scene", { scale: 9 })).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });

  it("AC-479 puts a saved document on a page, beside what is there, with ids of its own, in one undo step", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "mine",
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          label: { text: "Mine" },
        },
      ],
    });

    const saved = (await ok("export_scene", { format: "json" })).text;

    await ok("insert_document", { json: saved });

    const rectangles = live().filter((element) => element.type === "rectangle");

    expect(rectangles).toHaveLength(2);
    expect(new Set(live().map((element) => element.id)).size).toBe(
      live().length,
    );
    // beside what was there: to the right of it
    const arrived = rectangles.find((element) => element.id !== "mine")!;

    expect(arrived.x).toBeGreaterThan(300);
    expect(arrived.pageId).toBe(byId("mine").pageId);

    undo();
    expect(
      live().filter((element) => element.type === "rectangle"),
    ).toHaveLength(1);

    expect(await run("insert_document", { json: "{not json" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("insert_document", { json: JSON.stringify({ type: "other" }) }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
  });

  it("AC-479 the tools that change the document are refused while Allow changes is off", async () => {
    const off = { ...CONTEXT, allowChanges: false };

    for (const [tool, args] of [
      ["run_action", { name: "gridMode" }],
      ["duplicate_elements", { ids: ["a"] }],
      ["style_text", { id: "a", bold: true }],
      ["bind_arrow", { arrow: "a" }],
      ["mermaid_to_diagram", { source: "graph TD" }],
      ["set_canvas", { grid: true }],
      ["insert_document", { json: "{}" }],
    ] as const) {
      expect(await run(tool, args, off)).toMatchObject({
        error: { code: "changes-not-allowed" },
      });
    }

    // looking is allowed
    expect(await run("check_page", {}, off)).toMatchObject({ ok: true });
    expect(await run("list_actions", {}, off)).toMatchObject({ ok: true });
  });
});

describe("a diagram from Mermaid", () => {
  it("AC-480 draws the diagram as ordinary elements at the point asked for, on the page asked for, in one undo step", async () => {
    await ok("add_page", {});

    const result = await ok("mermaid_to_diagram", {
      source: "graph LR; A-->B",
      page: 2,
      x: 300,
      y: 200,
    });

    expect(result.page).toBe(2);
    expect(result.created.map((element: any) => element.type).sort()).toEqual([
      "arrow",
      "rectangle",
      "rectangle",
      "text",
      "text",
    ]);

    const start = live().find(
      (element) => (element as any).text === "Start",
    ) as any;
    const box = live().find((element) => element.id === start.containerId)!;

    // the top-left of the diagram is where it was asked to be, in the page's own terms
    expect((await ok("get_element", { id: box.id })).pageRelative).toEqual({
      x: 300,
      y: 200,
    });
    expect(box.pageId).toBe(h.state.pages[1].id);

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-480 says in words when the text is not Mermaid the editor can draw", async () => {
    expect(
      await run("mermaid_to_diagram", { source: "broken ((" }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/Parse error/),
      },
    });
    expect(await run("mermaid_to_diagram", { source: "   " })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(live()).toHaveLength(0);
  });
});

describe("the shape library", () => {
  it("AC-481 lists what the library holds, and puts an item on a page where asked, with new ids, in one undo step", async () => {
    expect(await ok("library_list")).toEqual({ items: [] });

    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "lib1",
          x: 500,
          y: 400,
          width: 160,
          height: 80,
          label: { text: "Item" },
        },
        { type: "ellipse", id: "lib2", x: 700, y: 440, width: 60, height: 60 },
      ],
    });
    await ok("run_action", { name: "addToLibrary", ids: ["lib1", "lib2"] });

    const { items } = await ok("library_list");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ elements: 3, width: 260, height: 100 });

    await ok("add_page", {});

    const result = await ok("library_insert", {
      id: items[0].id,
      page: 2,
      x: 300,
      y: 200,
    });

    expect(result.page).toBe(2);
    expect(result.created).toHaveLength(3);

    const copies = live().filter(
      (element) =>
        !["lib1", "lib2"].includes(element.id) &&
        element.pageId === h.state.pages[1].id &&
        element.type !== "text",
    );
    const first = copies.find((element) => element.type === "rectangle")!;

    expect((await ok("get_element", { id: first.id })).pageRelative).toEqual({
      x: 300,
      y: 200,
    });
    expect(live()).toHaveLength(6);

    undo();
    expect(live()).toHaveLength(3);

    expect(await run("library_insert", { id: "nope" })).toMatchObject({
      error: { code: "not-found" },
    });
  });
});
