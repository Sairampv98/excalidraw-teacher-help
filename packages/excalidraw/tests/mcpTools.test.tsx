/**
 * The page's side of the MCP tools (D-399 to D-402): reading the document,
 * creating, changing and deleting elements, and the properties panel as tools.
 * Every tool runs against the real editor, so what is checked is what the person
 * would see and what Ctrl+Z would undo.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";
import { MCP_HANDLERS, runMcpTool } from "../mcp/runner";
import { MCP_MAX_ELEMENTS_PER_CALL, MCP_TOOLS } from "../mcp/toolSpecs";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { McpRunContext } from "../mcp/runner";

const { h } = window;

const CONTEXT: McpRunContext = {
  allowChanges: true,
  app: "test",
  features: ["canvas"],
};

/** a tool, run as the page runs it for the server */
const run = async (
  name: string,
  args: unknown = {},
  context: McpRunContext = CONTEXT,
) => {
  let outcome: Awaited<ReturnType<typeof runMcpTool>> | undefined;

  await act(async () => {
    outcome = await runMcpTool(h.app, name, args, context);
  });

  return outcome!;
};

/** a tool that is expected to answer, and what it answered */
const ok = async (name: string, args: unknown = {}) => {
  const outcome = await run(name, args);

  if (!outcome.ok) {
    throw new Error(
      `${name} failed: ${outcome.error.code}: ${outcome.error.message}`,
    );
  }

  return outcome.result as any;
};

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

const live = () => h.elements.filter((element) => !element.isDeleted);

beforeEach(async () => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);
});

describe("reading the document", () => {
  it("AC-461 describes what the whiteboard can do: changes allowed, pages, limits, tools and how positions work", async () => {
    const capabilities = await ok("describe_capabilities");

    expect(capabilities).toMatchObject({
      allowChanges: true,
      pages: 1,
      currentPage: 1,
      limits: { maxElementsPerCall: MCP_MAX_ELEMENTS_PER_CALL },
    });
    expect(capabilities.tools).toEqual(MCP_TOOLS.map((tool) => tool.name));
    expect(capabilities.coordinates).toMatch(/page-relative/);
  });

  it("AC-461 lists the pages with their size, frame, number and paper, and the one that is open", async () => {
    const { pages } = await ok("list_pages");

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      page: 1,
      width: 1920,
      height: 1080,
      frame: false,
      pageNumber: false,
      open: true,
      elements: 0,
    });
    expect(pages[0].paper).toMatchObject({ type: "plain" });
  });

  it("AC-461 lists elements page-relative or in scene units, by page, type, id and selection", async () => {
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: 100,
      y: 50,
      width: 200,
      height: 80,
    });
    const dot = API.createElement({
      type: "ellipse",
      id: "dot",
      x: 400,
      y: 60,
      width: 40,
      height: 40,
    });

    API.setElements([box, dot]);
    API.setSelectedElements([dot]);

    const all = await ok("list_elements");

    expect(all.total).toBe(2);
    expect(all.elements[0]).toMatchObject({
      id: "box",
      type: "rectangle",
      page: 1,
      x: 100,
      y: 50,
      width: 200,
    });
    expect(
      (await ok("list_elements", { types: ["ellipse"] })).elements.map(
        (e: any) => e.id,
      ),
    ).toEqual(["dot"]);
    expect(
      (await ok("list_elements", { selected: true })).elements.map(
        (e: any) => e.id,
      ),
    ).toEqual(["dot"]);
    expect((await ok("list_elements", { ids: ["box"] })).total).toBe(1);

    // a second page: its elements are on it, and its positions are its own
    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });
    API.setElements([box, { ...dot, pageId: "p2", x: 1920 + 100 + 400 }]);

    expect(
      (await ok("list_elements", { page: 1 })).elements.map((e: any) => e.id),
    ).toEqual(["box"]);

    const second = (await ok("list_elements", { page: 2 })).elements[0];

    expect(second).toMatchObject({ id: "dot", page: 2 });
    expect(
      (await ok("list_elements", { page: 2, absolute: true })).elements[0].x,
    ).toBe(2420);
  });

  it("AC-461 gives everything about one element, with its words and its place on its page, and says when it is not there", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "card",
          x: 10,
          y: 20,
          width: 160,
          height: 80,
          label: { text: "Hello" },
        },
      ],
    });

    const one = await ok("get_element", { id: "card" });

    expect(one.page).toBe(1);
    expect(one.pageRelative).toEqual({ x: 10, y: 20 });
    expect(one.element).toMatchObject({ type: "rectangle", id: "card" });
    expect(one.boundText.text).toBe("Hello");

    const missing = await run("get_element", { id: "nope" });

    expect(missing).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await run("get_element", {})).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
  });

  it("AC-461 tells what is selected, and select_elements and go_to_page change what is selected and open", async () => {
    API.setElements([
      API.createElement({ type: "rectangle", id: "a", x: 0, y: 0 }),
      API.createElement({ type: "rectangle", id: "b", x: 200, y: 0 }),
    ]);

    expect(await ok("get_selection")).toEqual({ ids: [], pages: [] });

    await ok("select_elements", { ids: ["a", "b"] });
    expect((await ok("get_selection")).ids.sort()).toEqual(["a", "b"]);

    await ok("select_elements", { ids: [] });
    expect((await ok("get_selection")).ids).toEqual([]);

    expect(await run("go_to_page", { page: 9 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("creating elements", () => {
  it("AC-462 makes shapes, with words in them, at a position on the page, and says what it made", async () => {
    const { created, page } = await ok("create_elements", {
      page: 1,
      elements: [
        {
          type: "rectangle",
          x: 100,
          y: 100,
          width: 300,
          height: 120,
          backgroundColor: "#a5d8ff",
          fillStyle: "solid",
          strokeColor: "#1971c2",
          roundness: "round",
          label: { text: "Start", fontSize: 28 },
        },
        { type: "ellipse", x: 500, y: 100, width: 160, height: 120 },
        { type: "diamond", x: 750, y: 100, width: 160, height: 120 },
        {
          type: "text",
          x: 100,
          y: 300,
          text: "A heading",
          fontSize: 36,
          fontFamily: "Nunito",
        },
      ],
    });

    expect(page).toBe(1);
    // the rectangle, its words, the ellipse, the diamond and the heading
    expect(created.map((e: any) => e.type).sort()).toEqual([
      "diamond",
      "ellipse",
      "rectangle",
      "text",
      "text",
    ]);

    const rect = live().find((element) => element.type === "rectangle")!;

    expect(rect).toMatchObject({
      x: 100,
      y: 100,
      width: 300,
      height: 120,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      strokeColor: "#1971c2",
      pageId: h.state.currentPageId,
    });
    expect(rect.roundness).not.toBeNull();

    const words = live().find(
      (element) =>
        element.type === "text" && (element as any).containerId === rect.id,
    )!;

    expect((words as any).text).toBe("Start");
    expect((words as any).fontSize).toBe(28);

    const heading = live().find(
      (element) => (element as any).text === "A heading",
    )! as any;

    expect(heading.fontSize).toBe(36);
    expect(heading.fontFamily).toBe(6);
  });

  it("AC-462 puts elements on the page that is named, in that page's own terms", async () => {
    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });

    await ok("create_elements", {
      page: 2,
      elements: [
        {
          type: "rectangle",
          id: "second",
          x: 50,
          y: 60,
          width: 100,
          height: 100,
        },
      ],
    });

    const made = live().find((element) => element.id === "second")!;

    expect(made.pageId).toBe("p2");
    // the second page starts after the first and the space between
    expect(made.x).toBeGreaterThan(1920);
    expect((await ok("get_element", { id: "second" })).pageRelative).toEqual({
      x: 50,
      y: 60,
    });
  });

  it("AC-462 makes lines, arrows that are bound to the shapes they join, and freedraw from points", async () => {
    await ok("create_elements", {
      elements: [
        { type: "rectangle", id: "a", x: 100, y: 100, width: 160, height: 80 },
        { type: "rectangle", id: "b", x: 500, y: 100, width: 160, height: 80 },
        {
          type: "arrow",
          x: 260,
          y: 140,
          points: [
            [0, 0],
            [240, 0],
          ],
          start: { id: "a" },
          end: { id: "b" },
          endArrowhead: "triangle",
          label: { text: "next" },
        },
        {
          type: "line",
          x: 100,
          y: 400,
          points: [
            [0, 0],
            [100, 50],
            [200, 0],
          ],
          strokeStyle: "dashed",
        },
        {
          type: "freedraw",
          x: 100,
          y: 600,
          points: [
            [0, 0],
            [10, 8],
            [30, 12],
            [60, 0],
          ],
          strokeColor: "#e03131",
          strokeWidth: 4,
        },
      ],
    });

    const arrow = live().find((element) => element.type === "arrow") as any;

    expect(arrow.startBinding.elementId).toBe("a");
    expect(arrow.endBinding.elementId).toBe("b");
    expect(arrow.endArrowhead).toBe("triangle");

    const a = live().find((element) => element.id === "a")!;

    expect(a.boundElements?.some((bound) => bound.id === arrow.id)).toBe(true);

    expect(live().find((element) => element.type === "line")).toMatchObject({
      strokeStyle: "dashed",
    });

    const stroke = live().find((element) => element.type === "freedraw") as any;

    expect(stroke).toMatchObject({ strokeColor: "#e03131", strokeWidth: 4 });
    expect(stroke.points).toHaveLength(4);
    expect(stroke.width).toBe(60);
  });

  it("AC-462 is one undo step, and the elements come back with a redo", async () => {
    await ok("create_elements", {
      elements: [
        { type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
        { type: "ellipse", x: 200, y: 0, width: 100, height: 100 },
        { type: "text", x: 0, y: 200, text: "x" },
      ],
    });
    expect(live()).toHaveLength(3);

    undo();
    expect(live()).toHaveLength(0);

    act(() => {
      Keyboard.redo();
    });
    expect(live()).toHaveLength(3);
  });

  it("AC-462 refuses what it cannot make, in words: a type it does not know, an id that is taken, a list that is too long", async () => {
    expect(
      await run("create_elements", { elements: [{ type: "banana" }] }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/type must be one of/),
      },
    });
    expect(
      await run("create_elements", { elements: [{ type: "text" }] }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/text must be a string/),
      },
    });
    expect(
      await run("create_elements", {
        elements: [{ type: "line", points: [[0, 0]] }],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });

    await ok("create_elements", {
      elements: [{ type: "rectangle", id: "dup", x: 0, y: 0 }],
    });
    expect(
      await run("create_elements", {
        elements: [{ type: "rectangle", id: "dup", x: 0, y: 0 }],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/already in the document/),
      },
    });

    const tooMany = Array.from(
      { length: MCP_MAX_ELEMENTS_PER_CALL + 1 },
      () => ({ type: "rectangle", x: 0, y: 0 }),
    );

    expect(await run("create_elements", { elements: tooMany })).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
    expect(live()).toHaveLength(1);
  });
});

describe("changing and deleting elements", () => {
  it("AC-463 moves and resizes a shape page-relatively, and the words and the arrow bound to it follow", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "a",
          x: 100,
          y: 100,
          width: 160,
          height: 80,
          label: { text: "Move me" },
        },
        { type: "rectangle", id: "b", x: 600, y: 100, width: 160, height: 80 },
        {
          type: "arrow",
          id: "link",
          x: 260,
          y: 140,
          points: [
            [0, 0],
            [340, 0],
          ],
          start: { id: "a" },
          end: { id: "b" },
        },
      ],
    });

    const arrowBefore = {
      ...(live().find((element) => element.id === "link") as any),
    };

    await ok("update_elements", {
      updates: [{ id: "a", x: 120, y: 300, width: 220, height: 100 }],
    });

    const a = live().find((element) => element.id === "a")!;
    const words = live().find(
      (element) => (element as any).containerId === "a",
    )! as any;
    const arrow = live().find((element) => element.id === "link") as any;

    expect(a).toMatchObject({ x: 120, y: 300, width: 220, height: 100 });
    // the words stay inside the shape, in the middle of it
    expect(words.x).toBeGreaterThanOrEqual(120);
    expect(words.x + words.width).toBeLessThanOrEqual(120 + 220);
    expect(words.y).toBeGreaterThanOrEqual(300);
    expect(words.y + words.height).toBeLessThanOrEqual(300 + 100);
    // the arrow is still bound at both ends, and it moved with the shape
    expect(arrow.startBinding.elementId).toBe("a");
    expect(arrow.endBinding.elementId).toBe("b");
    expect(arrow.y).not.toBe(arrowBefore.y);
  });

  it("AC-463 changes the words of a text and of a shape, locks, links and turns elements", async () => {
    await ok("create_elements", {
      elements: [
        { type: "text", id: "t", x: 0, y: 0, text: "one" },
        {
          type: "rectangle",
          id: "r",
          x: 0,
          y: 200,
          width: 200,
          height: 100,
          label: { text: "old" },
        },
      ],
    });

    await ok("update_elements", {
      updates: [
        {
          id: "t",
          text: "two lines\nof text",
          locked: true,
          link: "https://example.com",
        },
        { id: "r", text: "new words", angle: 0.5 },
      ],
    });

    const text = live().find((element) => element.id === "t")! as any;
    const words = live().find(
      (element) => (element as any).containerId === "r",
    )! as any;

    expect(text).toMatchObject({
      text: "two lines\nof text",
      locked: true,
      link: "https://example.com",
    });
    expect(words.text).toBe("new words");
    expect(live().find((element) => element.id === "r")!.angle).toBe(0.5);
  });

  it("AC-463 changes the points of a line, and is one undo step", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "line",
          id: "l",
          x: 100,
          y: 100,
          points: [
            [0, 0],
            [100, 0],
          ],
        },
      ],
    });
    await ok("update_elements", {
      updates: [
        {
          id: "l",
          points: [
            [0, 0],
            [100, 50],
            [200, 0],
          ],
          x: 150,
        },
      ],
    });

    const line = live().find((element) => element.id === "l") as any;

    expect(line.points).toHaveLength(3);
    expect(line.x).toBe(150);

    undo();
    expect(
      (live().find((element) => element.id === "l") as any).points,
    ).toHaveLength(2);
    expect(live().find((element) => element.id === "l")!.x).toBe(100);
  });

  it("AC-463 refuses a change it does not do, with what it does do", async () => {
    await ok("create_elements", {
      elements: [{ type: "rectangle", id: "r", x: 0, y: 0 }],
    });

    expect(
      await run("update_elements", {
        updates: [{ id: "r", strokeColor: "#fff" }],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/set_properties/),
      },
    });
    expect(
      await run("update_elements", { updates: [{ id: "r", text: "x" }] }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/no text/),
      },
    });
    expect(
      await run("update_elements", { updates: [{ id: "ghost", x: 1 }] }),
    ).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("AC-463 deletes elements with the words bound to them, unbinds the arrows, and one undo brings them back", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "a",
          x: 100,
          y: 100,
          width: 160,
          height: 80,
          label: { text: "gone" },
        },
        { type: "rectangle", id: "b", x: 500, y: 100, width: 160, height: 80 },
        {
          type: "arrow",
          id: "link",
          x: 260,
          y: 140,
          points: [
            [0, 0],
            [240, 0],
          ],
          start: { id: "a" },
          end: { id: "b" },
        },
      ],
    });

    expect(await ok("delete_elements", { ids: ["a"] })).toEqual({
      deleted: ["a"],
    });

    const ids = live().map((element) => element.id);

    expect(ids).not.toContain("a");
    expect(live().some((element) => (element as any).containerId === "a")).toBe(
      false,
    );
    expect(ids).toContain("b");
    expect(
      (live().find((element) => element.id === "link") as any)?.startBinding ??
        null,
    ).toBeNull();

    undo();
    expect(live().map((element) => element.id)).toContain("a");
    expect(live().some((element) => (element as any).containerId === "a")).toBe(
      true,
    );
  });
});

describe("the properties panel as tools", () => {
  const shape = async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "r",
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          backgroundColor: "#ffc9c9",
          label: { text: "Hi" },
        },
        {
          type: "arrow",
          id: "ar",
          x: 0,
          y: 300,
          points: [
            [0, 0],
            [200, 0],
          ],
        },
        {
          type: "freedraw",
          id: "fd",
          x: 0,
          y: 500,
          points: [
            [0, 0],
            [30, 20],
          ],
        },
      ],
    });
  };

  it("AC-464 describes what the panel would show for a shape, a text, an arrow - and leaves out what it would not", async () => {
    await shape();

    const rect = await ok("describe_properties", { ids: ["r"] });

    expect(Object.keys(rect.properties)).toEqual(
      expect.arrayContaining([
        "strokeColor",
        "backgroundColor",
        "fillStyle",
        "strokeWidth",
        "strokeStyle",
        "roughness",
        "roundness",
        "opacity",
        "fontFamily",
        "fontSize",
        "verticalAlign",
      ]),
    );
    expect(rect.properties.strokeColor.value).toBe("#1e1e1e");
    expect(rect.properties.fillStyle.values).toEqual([
      "hachure",
      "cross-hatch",
      "solid",
      "zigzag",
    ]);
    expect(rect.properties).not.toHaveProperty("arrowType");
    expect(rect.properties).not.toHaveProperty("startArrowhead");

    const arrow = await ok("describe_properties", { ids: ["ar"] });

    expect(Object.keys(arrow.properties)).toEqual(
      expect.arrayContaining([
        "arrowType",
        "startArrowhead",
        "endArrowhead",
        "strokeStyle",
      ]),
    );
    // an arrow has no background, so the panel has no fill style for it
    expect(arrow.properties).not.toHaveProperty("fillStyle");
    expect(arrow.properties).not.toHaveProperty("backgroundColor");

    // freedraw has colours and a width, and no stroke style
    const free = await ok("describe_properties", { ids: ["fd"] });

    expect(free.properties).toHaveProperty("strokeWidth");
    expect(free.properties).not.toHaveProperty("strokeStyle");
  });

  it("AC-464 says mixed where the elements differ, and the common value where they do not", async () => {
    await shape();
    await ok("set_properties", {
      ids: ["ar"],
      properties: { strokeColor: "#e03131" },
    });

    expect(
      (await ok("describe_properties", { ids: ["r", "ar"] })).properties
        .strokeColor.value,
    ).toBe("mixed");
    expect(
      (await ok("describe_properties", { ids: ["ar"] })).properties.strokeColor
        .value,
    ).toBe("#e03131");
  });

  it("AC-464 changes properties as the panel does - colours, fill, widths, fonts, the arrow's heads and type - and the text in a shape follows", async () => {
    await shape();

    await ok("set_properties", {
      ids: ["r"],
      properties: {
        strokeColor: "#1971c2",
        backgroundColor: "#a5d8ff",
        fillStyle: "cross-hatch",
        strokeWidth: 4,
        strokeStyle: "dashed",
        roughness: 0,
        roundness: "round",
        opacity: 60,
        fontFamily: "Comic Shanns",
        fontSize: 28,
      },
    });

    const rect = live().find((element) => element.id === "r") as any;
    const words = live().find(
      (element) => (element as any).containerId === "r",
    ) as any;

    expect(rect).toMatchObject({
      strokeColor: "#1971c2",
      backgroundColor: "#a5d8ff",
      fillStyle: "cross-hatch",
      strokeWidth: 4,
      strokeStyle: "dashed",
      roughness: 0,
      opacity: 60,
    });
    expect(rect.roundness).not.toBeNull();
    expect(words).toMatchObject({ fontFamily: 8, fontSize: 28 });

    await ok("set_properties", {
      ids: ["ar"],
      properties: {
        arrowType: "elbow",
        startArrowhead: "circle",
        endArrowhead: null,
        strokeStyle: "dotted",
      },
    });

    const arrow = live().find((element) => element.id === "ar") as any;

    expect(arrow).toMatchObject({
      elbowed: true,
      startArrowhead: "circle",
      endArrowhead: null,
      strokeStyle: "dotted",
    });
  });

  it("AC-464 is one undo step for all of it, leaves the person's selection and the style of the next elements alone", async () => {
    await shape();
    API.setSelectedElements([live().find((element) => element.id === "fd")!]);

    const defaults = {
      stroke: h.state.currentItemStrokeColor,
      fill: h.state.currentItemFillStyle,
    };

    await ok("set_properties", {
      ids: ["r"],
      properties: {
        strokeColor: "#e03131",
        backgroundColor: "#ffec99",
        strokeWidth: 4,
      },
    });

    expect(
      Object.keys(h.state.selectedElementIds).filter(
        (id) => h.state.selectedElementIds[id],
      ),
    ).toEqual(["fd"]);
    expect({
      stroke: h.state.currentItemStrokeColor,
      fill: h.state.currentItemFillStyle,
    }).toEqual(defaults);

    undo();

    const rect = live().find((element) => element.id === "r") as any;

    expect(rect).toMatchObject({
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffc9c9",
      strokeWidth: 2,
    });
  });

  it("AC-464 refuses a property the panel would not show, a value it does not offer and a name it does not have", async () => {
    await shape();

    expect(
      await run("set_properties", {
        ids: ["ar"],
        properties: { fillStyle: "solid" },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/would not show/),
      },
    });
    expect(
      await run("set_properties", {
        ids: ["r"],
        properties: { strokeStyle: "wavy" },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/one of solid, dashed, dotted/),
      },
    });
    expect(
      await run("set_properties", {
        ids: ["r"],
        properties: { colour: "red" },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a property/),
      },
    });
    expect(
      await run("set_properties", {
        ids: ["r"],
        properties: { strokeColor: "url(javascript:1)" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(
      await run("set_properties", { ids: ["r"], properties: {} }),
    ).toMatchObject({ ok: false });
    // nothing was changed by any of them
    expect(
      (live().find((element) => element.id === "r") as any).strokeStyle,
    ).toBe("solid");
  });
});

describe("a picture of the board", () => {
  it("AC-467 gives the page, the selection or some elements as a PNG, sized to the longest side asked for", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "a",
          x: 100,
          y: 100,
          width: 300,
          height: 120,
          label: { text: "Hi" },
        },
        { type: "ellipse", id: "b", x: 600, y: 100, width: 100, height: 100 },
      ],
    });

    const page = await ok("screenshot", { maxSize: 600 });

    expect(page.page).toBe(1);
    expect(page.images).toHaveLength(1);
    expect(page.images[0].mimeType).toBe("image/png");
    expect(typeof page.images[0].data).toBe("string");

    API.setSelectedElements([live().find((element) => element.id === "a")!]);
    expect(
      (await ok("screenshot", { scope: "selection" })).images,
    ).toHaveLength(1);
    expect(
      (await ok("screenshot", { scope: "elements", ids: ["b"] })).images,
    ).toHaveLength(1);
  });

  it("AC-467 says so when there is nothing to draw, or the scope is not one it knows", async () => {
    expect(await run("screenshot", { scope: "selection" })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await run("screenshot", { scope: "everything" })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(await run("screenshot", { maxSize: 50 })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(await run("screenshot", { page: 4 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("the limits and the guards", () => {
  it("AC-465 refuses every tool that changes the scene while Allow changes is off, and still reads", async () => {
    const off = { ...CONTEXT, allowChanges: false };

    for (const tool of MCP_TOOLS.filter((spec) => spec.changes)) {
      expect(await run(tool.name, {}, off)).toMatchObject({
        ok: false,
        error: { code: "changes-not-allowed" },
      });
    }

    expect(await run("list_pages", {}, off)).toMatchObject({ ok: true });
    expect(await run("describe_capabilities", {}, off)).toMatchObject({
      ok: true,
    });
    expect(live()).toHaveLength(0);
  });

  it("AC-465 an unknown tool and arguments of the wrong kind are answers, not crashes", async () => {
    expect(await run("nope")).toMatchObject({
      ok: false,
      error: { code: "unknown-tool" },
    });
    expect(await run("list_elements", "text")).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(await run("list_elements", { page: 0 })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(await run("list_elements", { page: 7 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await run("list_elements", { ids: "a" })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
  });
});

describe("the tools and their definitions", () => {
  it("AC-466 every tool has a handler and every handler a tool, and each one says what it takes", () => {
    expect(Object.keys(MCP_HANDLERS).sort()).toEqual(
      MCP_TOOLS.map((tool) => tool.name).sort(),
    );

    const names = new Set<string>();

    for (const tool of MCP_TOOLS) {
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
      expect(tool.name).toMatch(/^[a-z][a-z_]*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.changes).toBe("boolean");
    }
  });

  it("AC-466 the tools that change the scene are the ones the specs say, and no reader changes it", async () => {
    API.setElements([
      API.createElement({ type: "rectangle", id: "r", x: 0, y: 0 }),
    ]);

    const before = JSON.stringify(h.elements);

    for (const tool of MCP_TOOLS.filter(
      (spec) => !spec.changes && spec.name !== "go_to_page",
    )) {
      if (tool.name === "screenshot") {
        continue;
      }

      await run(
        tool.name,
        tool.name === "get_element"
          ? { id: "r" }
          : tool.name === "describe_properties"
          ? { ids: ["r"] }
          : tool.name === "select_elements"
          ? { ids: [] }
          : {},
      );
    }

    expect(JSON.stringify(h.elements)).toBe(before);
  });
});
