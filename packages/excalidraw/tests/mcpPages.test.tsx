/**
 * The page tools (D-403, D-404): adding, naming, moving and deleting pages with
 * what is on them, the page's frame, number, size and paper, the one-click looks
 * and the ink of drawn elements. Every tool runs against the real editor.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";
import { getCurrentInk, setCurrentInk } from "../inkDefault";
import { runMcpTool } from "../mcp/runner";
import { getPageRect } from "../scene/pages";
import { PAPER_LOOKS } from "../scene/paper";

import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { McpRunContext } from "../mcp/runner";

const { h } = window;

const CONTEXT: McpRunContext = {
  allowChanges: true,
  app: "test",
  features: [],
};

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

const ok = async (
  name: string,
  args: unknown = {},
  context: McpRunContext = CONTEXT,
) => {
  const outcome = await run(name, args, context);

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
const names = () => h.state.pages.map((page) => page.name);

/** a shape on a page, in the page's own terms */
const shapeOn = (page: number, id: string) =>
  ok("create_elements", {
    page,
    elements: [
      { type: "rectangle", id, x: 100, y: 100, width: 200, height: 100 },
    ],
  });

/** where an element is, in the terms of the page it is stamped to */
const placeOf = (id: string) => {
  const element = live().find((each) => each.id === id)!;
  const rect = getPageRect(h.state.pages, element.pageId);

  return {
    x: element.x - rect.x,
    y: element.y - rect.y,
    pageId: element.pageId,
  };
};

beforeEach(async () => {
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true} />,
  );
  act(() => {
    setCurrentInk({ look: "normal", amount: 50 });
  });
});

describe("pages", () => {
  it("AC-471 adds a page after the one that is open, after or before a number, with a name, and does not open it unless asked", async () => {
    const first = await ok("add_page", {});

    expect(first).toMatchObject({ page: 2, name: "Page 2" });
    expect(h.state.currentPageId).toBe(h.state.pages[0].id);

    await ok("add_page", { before: 1, name: "Cover" });
    expect(names()).toEqual(["Cover", "Page 2", "Page 3"]);

    await ok("add_page", { after: 0 });
    expect(h.state.pages).toHaveLength(4);

    const opened = await ok("add_page", { after: 4, open: true });

    expect(h.state.currentPageId).toBe(opened.id);
    expect(h.state.pages[4].id).toBe(opened.id);
    expect(await run("add_page", { after: 1, before: 2 })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(await run("add_page", { after: 9 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("AC-471 the content of the pages that moved goes with them, and one undo puts the pages back", async () => {
    await ok("add_page", {});
    await shapeOn(2, "later");

    const before = placeOf("later");

    await ok("add_page", { before: 1 });

    expect(h.state.pages).toHaveLength(3);
    // the shape is on the same page, in the same place on it, though the page moved
    expect(placeOf("later")).toEqual({ ...before, pageId: before.pageId });
    expect(h.state.pages.findIndex((page) => page.id === before.pageId)).toBe(
      2,
    );

    undo();
    expect(h.state.pages).toHaveLength(2);
    expect(placeOf("later")).toEqual(before);
  });

  it("AC-471 renames a page and moves it, and what is on the pages moves with them", async () => {
    await ok("add_page", {});
    await ok("add_page", {});
    await shapeOn(1, "one");
    await shapeOn(3, "three");

    await ok("rename_page", { page: 2, name: "Middle" });
    expect(names()).toEqual(["Page 1", "Middle", "Page 3"]);

    const one = placeOf("one");
    const three = placeOf("three");

    await ok("move_page", { page: 3, to: 1 });

    const order = h.state.pages.map((page) => page.id);

    expect(order[0]).toBe(three.pageId);
    expect(order[1]).toBe(one.pageId);
    expect(placeOf("three")).toEqual(three);
    expect(placeOf("one")).toEqual(one);
    expect(names()).toEqual(
      ["Page 1", "Page 2", "Middle"].map((name, i) =>
        name === "Middle" ? name : `Page ${i + 1}`,
      ),
    );

    expect(await run("move_page", { page: 1, to: 9 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await run("rename_page", { page: 1, name: "  " })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
  });

  it("AC-471 deletes a page with what is on it, the pages after it move back, and one undo brings it all back", async () => {
    await ok("add_page", {});
    await shapeOn(1, "gone");
    await shapeOn(2, "stays");

    const stays = placeOf("stays");
    const kept: string[] = [];
    const context: McpRunContext = {
      ...CONTEXT,
      hooks: { keepDeletedPage: async (id) => void kept.push(id) },
    };
    const doomed = h.state.pages[0].id;

    expect(await ok("delete_page", { page: 1 }, context)).toMatchObject({
      deleted: 1,
      pages: 1,
    });
    expect(kept).toEqual([doomed]);
    expect(h.state.pages).toHaveLength(1);
    expect(live().map((element) => element.id)).toEqual(["stays"]);
    // the page that was second is first now, and what is on it did not move on it
    expect({ x: placeOf("stays").x, y: placeOf("stays").y }).toEqual({
      x: stays.x,
      y: stays.y,
    });

    undo();
    expect(h.state.pages).toHaveLength(2);
    expect(
      live()
        .map((element) => element.id)
        .sort(),
    ).toEqual(["gone", "stays"]);
  });

  it("AC-471 a document keeps one page, and a store that fails does not stop a delete", async () => {
    const context: McpRunContext = {
      ...CONTEXT,
      hooks: {
        keepDeletedPage: async () => {
          throw new Error("storage is full");
        },
      },
    };

    await shapeOn(1, "only");
    await ok("delete_page", { page: 1 }, context);

    expect(h.state.pages).toHaveLength(1);
    expect(live()).toHaveLength(0);
    expect(await run("delete_page", { page: 5 }, context)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("AC-471 clears a page and keeps it, in one undo step", async () => {
    await ok("add_page", {});
    await shapeOn(1, "a");
    await shapeOn(2, "b");

    expect(await ok("clear_page", { page: 2 })).toEqual({
      page: 2,
      deleted: 1,
    });
    expect(live().map((element) => element.id)).toEqual(["a"]);
    expect(h.state.pages).toHaveLength(2);

    undo();
    expect(live()).toHaveLength(2);
  });

  it("AC-471 lists the deleted pages and brings one back through the app's own store, and says when there is none", async () => {
    expect(await run("list_deleted_pages")).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });

    const context: McpRunContext = {
      ...CONTEXT,
      hooks: {
        listDeletedPages: async () => [
          { id: "k1", name: "Page 2", deletedAt: 5, elements: 3 },
        ],
        restoreDeletedPage: async (id) =>
          id === "k1" ? { page: 2, id: "page-x", name: "Page 2" } : null,
      },
    };

    expect(await ok("list_deleted_pages", {}, context)).toEqual({
      deleted: [{ id: "k1", name: "Page 2", deletedAt: 5, elements: 3 }],
    });
    expect(await ok("restore_page", { id: "k1" }, context)).toMatchObject({
      page: 2,
    });
    expect(await run("restore_page", { id: "nope" }, context)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("the page's own settings", () => {
  it("AC-472 turns the frame and the page number on and off, and says what the page is now", async () => {
    const now = await ok("set_page", { frame: true, pageNumber: true });

    expect(now).toMatchObject({
      page: 1,
      frame: true,
      pageNumber: true,
      width: 1920,
      height: 1080,
    });
    expect(h.state.pages[0]).toMatchObject({ frame: true, number: true });
    expect((await ok("list_pages")).pages[0]).toMatchObject({
      frame: true,
      pageNumber: true,
    });

    await ok("set_page", { frame: false });
    expect(h.state.pages[0].frame).toBe(false);

    undo();
    expect(h.state.pages[0].frame).toBe(true);
  });

  it("AC-472 gives a page a preset size - which it remembers - or a size of its own that is never below the minimum", async () => {
    const a4 = await ok("set_page", { preset: "a4-portrait" });

    expect(a4.sizePreset).toBe("a4-portrait");
    expect(a4.width).toBeGreaterThanOrEqual(1920);
    expect(a4.height).toBeGreaterThan(a4.width);
    expect(h.state.pages[0].sizePreset).toBe("a4-portrait");

    const own = await ok("set_page", { width: 3000, height: 100 });

    expect(own).toMatchObject({ width: 3000, height: 1080 });
    expect(h.state.pages[0].sizePreset).toBeUndefined();

    expect(await run("set_page", { preset: "huge" })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(
      await run("set_page", { preset: "a4-portrait", width: 2000 }),
    ).toMatchObject({ ok: false, error: { code: "bad-arguments" } });
    expect(await run("set_page", {})).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
  });

  it("AC-472 a page that grows moves the content of the pages after it", async () => {
    await ok("add_page", {});
    await shapeOn(2, "second");

    const before = placeOf("second");

    await ok("set_page", { page: 1, width: 3000 });

    expect(placeOf("second")).toEqual(before);
    expect(getPageRect(h.state.pages, h.state.pages[1].id).x).toBeGreaterThan(
      3000,
    );
  });

  it("AC-472 sets the paper of a page - type, colour, grain, age - and on every page when asked", async () => {
    await ok("add_page", {});

    const now = await ok("set_page", {
      page: 2,
      paper: { type: "grid", color: "cream", grain: 30, age: 40 },
    });

    expect(now.paper).toEqual({
      type: "grid",
      color: "cream",
      grain: 30,
      age: 40,
    });
    expect(h.state.pages[0].paper).toBeUndefined();

    // what is not given stays what the page has
    expect(
      (await ok("set_page", { page: 2, paper: { age: 90 } })).paper,
    ).toEqual({
      type: "grid",
      color: "cream",
      grain: 30,
      age: 90,
    });

    await ok("set_page", {
      page: 1,
      paper: { type: "dot-grid" },
      paperOnAllPages: true,
    });
    expect(h.state.pages.map((page) => page.paper?.type)).toEqual([
      "dot-grid",
      "dot-grid",
    ]);

    for (const bad of [
      { type: "wood" },
      { color: "pink-ish" },
      { grain: 101 },
      { age: -1 },
      "grid",
    ]) {
      expect(await run("set_page", { paper: bad })).toMatchObject({
        ok: false,
        error: { code: "bad-arguments" },
      });
    }
  });

  it("AC-472 makes what is on a page half the size and back, in steps", async () => {
    await shapeOn(1, "big");

    expect(await ok("scale_page_content", { direction: "shrink" })).toEqual({
      page: 1,
      contentScale: 0.5,
    });
    expect(live()[0]).toMatchObject({ width: 100, height: 50 });

    expect(
      (await ok("scale_page_content", { direction: "grow" })).contentScale,
    ).toBe(1);
    expect(live()[0]).toMatchObject({ width: 200, height: 100 });
    expect(
      await run("scale_page_content", { direction: "sideways" }),
    ).toMatchObject({ ok: false });
  });
});

describe("the look of a page and the ink", () => {
  it("AC-473 says what a page may look like, and what it is now", async () => {
    const look = await ok("describe_page_look");

    expect(look.paperTypes.map((type: any) => type.id)).toEqual([
      "plain",
      "single-line",
      "double-line",
      "grid",
      "dot-grid",
      "cornell",
      "isometric",
      "music",
    ]);
    expect(look.paperColors).toHaveLength(13);
    expect(look.paperColors[0].id).toBe("canvas");
    expect(look.looks.map((each: any) => each.id)).toEqual(
      PAPER_LOOKS.map((each) => each.id),
    );
    expect(look.inkLooks).toEqual([
      "normal",
      "neon",
      "chalk",
      "marker",
      "pencil",
    ]);
    expect(look.now).toMatchObject({
      frame: false,
      paper: { type: "plain", color: "canvas" },
    });
    expect(
      look.sizePresets.find((preset: any) => preset.id === "project"),
    ).toMatchObject({ width: 1920, height: 1080 });
  });

  it("AC-473 a one-click look gives the page its paper and the person's next elements its ink, and does not recolour what is drawn", async () => {
    await shapeOn(1, "before");

    const result = await ok("apply_page_look", { look: "green-chalkboard" });

    expect(result.paper).toMatchObject({ type: "plain", color: "chalkboard" });
    expect(h.state.pages[0].paper).toMatchObject({ color: "chalkboard" });
    expect(getCurrentInk()).toMatchObject({ look: "chalk", amount: 50 });
    expect(h.state.currentItemStrokeColor).toBe("#f5f5f0");
    expect(live().find((element) => element.id === "before")!.strokeColor).toBe(
      "#1e1e1e",
    );

    undo();
    expect(h.state.pages[0].paper).toBeUndefined();

    expect(await run("apply_page_look", { look: "rainbow" })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
  });

  it("AC-473 changes the ink of drawn elements, and leaves the ink the person draws with next as it was", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "freedraw",
          id: "pen",
          x: 0,
          y: 0,
          points: [
            [0, 0],
            [30, 20],
            [60, 0],
          ],
        },
        { type: "rectangle", id: "box", x: 0, y: 200, width: 100, height: 100 },
      ],
    });

    const next = getCurrentInk();

    expect(
      await ok("set_ink", {
        ids: ["pen", "box"],
        look: "neon",
        amount: 80,
        color: "#00f0ff",
      }),
    ).toEqual({ elements: 2 });

    for (const id of ["pen", "box"]) {
      const element = live().find((each) => each.id === id)!;

      expect(element.customData?.ink).toMatchObject({
        look: "neon",
        amount: 80,
      });
      expect(element.strokeColor).toBe("#00f0ff");
    }

    expect(getCurrentInk()).toEqual(next);

    undo();
    expect(
      live().find((each) => each.id === "pen")!.customData?.ink,
    ).toBeUndefined();

    expect(await run("set_ink", { ids: ["pen"], look: "paint" })).toMatchObject(
      { ok: false, error: { code: "bad-arguments" } },
    );
    expect(await run("set_ink", { ids: ["pen"], amount: 500 })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
    expect(await run("set_ink", { ids: ["pen"] })).toMatchObject({
      ok: false,
      error: { code: "bad-arguments" },
    });
  });

  it("AC-473 the page tools that change the document are refused while Allow changes is off", async () => {
    const off = { ...CONTEXT, allowChanges: false };

    for (const [tool, args] of [
      ["add_page", {}],
      ["delete_page", { page: 1 }],
      ["set_page", { frame: true }],
      ["apply_page_look", { look: "blackboard" }],
      ["set_ink", { ids: ["x"], look: "neon" }],
    ] as const) {
      expect(await run(tool, args, off)).toMatchObject({
        ok: false,
        error: { code: "changes-not-allowed" },
      });
    }

    expect(await run("describe_page_look", {}, off)).toMatchObject({
      ok: true,
    });
    expect(h.state.pages).toHaveLength(1);
  });
});
