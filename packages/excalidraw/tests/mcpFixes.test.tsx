/**
 * The fixes to the tools the assistant draws with (D-439 to D-444): an id that
 * can be used again, two of one id in one call, the roundness the file holds, a
 * text read against what it is drawn on, where the content ends, and the page in
 * words for a model that cannot look at a picture.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";
import { mcpToolByName } from "../mcp/toolSpecs";
import { runMcpTool } from "../mcp/runner";

import { act, render } from "./test-utils";

import type { McpRunContext } from "../mcp/runner";

const { h } = window;

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

const live = () => h.elements.filter((element) => !element.isDeleted);
const byId = (id: string) => live().find((element) => element.id === id) as any;

beforeEach(async () => {
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true} />,
  );
});

describe("an id is held only by a live element", () => {
  it("AC-532 an id of a deleted element can be used again, and the document holds it once", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "card",
          x: 100,
          y: 100,
          width: 80,
          height: 60,
        },
      ],
    });
    await ok("delete_elements", { ids: ["card"] });
    await ok("create_elements", {
      elements: [
        {
          type: "ellipse",
          id: "card",
          x: 300,
          y: 100,
          width: 80,
          height: 60,
        },
      ],
    });

    expect(h.elements.filter((element) => element.id === "card")).toHaveLength(
      1,
    );
    expect(byId("card").type).toBe("ellipse");
  });

  it("AC-532 an id a live element holds is refused, naming what holds it", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "card",
          x: 100,
          y: 100,
          width: 80,
          height: 60,
        },
      ],
    });

    const outcome = await run("create_elements", {
      elements: [
        { type: "ellipse", id: "card", x: 300, y: 100, width: 80, height: 60 },
      ],
    });

    expect(outcome.ok).toBe(false);
    expect((outcome as any).error.message).toContain("a live rectangle");
    expect(live()).toHaveLength(1);
  });

  it("AC-532 two elements of one id in one call are refused, and nothing is made", async () => {
    const outcome = await run("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "twin",
          x: 100,
          y: 100,
          width: 80,
          height: 60,
        },
        {
          type: "rectangle",
          id: "twin",
          x: 300,
          y: 100,
          width: 80,
          height: 60,
        },
      ],
    });

    expect(outcome.ok).toBe(false);
    expect((outcome as any).error.message).toContain(
      "elements[0] of this call",
    );
    expect(live()).toHaveLength(0);
  });
});

describe("the roundness the file holds", () => {
  it("AC-533 takes {type: 2} and {type: 3}, and refuses what is none of the forms", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "r2",
          x: 100,
          y: 100,
          width: 80,
          height: 60,
          roundness: { type: 2 },
        },
        {
          type: "rectangle",
          id: "r3",
          x: 300,
          y: 100,
          width: 80,
          height: 60,
          roundness: { type: 3 },
        },
      ],
    });

    expect(byId("r2").roundness).toEqual({ type: 2 });
    expect(byId("r3").roundness).toEqual({ type: 3 });

    const outcome = await run("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "r9",
          x: 500,
          y: 100,
          width: 80,
          height: 60,
          roundness: { type: 9 },
        },
      ],
    });

    expect(outcome.ok).toBe(false);
    expect((outcome as any).error.message).toContain("{type: 1|2|3}");
  });
});

describe("checking a page, again", () => {
  const card = (textColor: string) => [
    {
      type: "rectangle",
      id: "card",
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      backgroundColor: "#1e1e1e",
      fillStyle: "solid",
    },
    {
      type: "text",
      id: "code",
      x: 120,
      y: 120,
      text: "print(1)",
      fontSize: 28,
      strokeColor: textColor,
    },
  ];

  it("AC-534 a free text over a dark shape is read against the shape, and is not an overlap", async () => {
    await ok("create_elements", { elements: card("#e6edf3") });

    const light = await ok("check_page");

    expect(light.issues.map((issue: any) => issue.kind)).not.toContain(
      "low-contrast",
    );
    expect(light.issues.map((issue: any) => issue.kind)).not.toContain(
      "overlap",
    );

    await ok("set_properties", {
      ids: ["code"],
      properties: { strokeColor: "#1e1e1e" },
    });

    const dark = await ok("check_page");

    expect(dark.issues.map((issue: any) => issue.kind)).toContain(
      "low-contrast",
    );
  });

  it("AC-534 the issue about a label names the shape it belongs to", async () => {
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

    const issue = (await ok("check_page")).issues.find(
      (candidate: any) => candidate.kind === "low-contrast",
    );

    expect(issue.message).toContain("the label of rectangle dark");
  });

  it("AC-535 says where the content ends, and whether it fits", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "box",
          x: 100,
          y: 100,
          width: 200,
          height: 100,
        },
        {
          type: "rectangle",
          id: "far",
          x: 1800,
          y: 900,
          width: 400,
          height: 100,
        },
      ],
    });

    const outside = await ok("check_page");

    expect(outside.fits).toBe(false);
    expect(outside.lowest).toMatchObject({ id: "far", type: "rectangle" });
    expect(outside.contentEndsAt.x).toBeGreaterThan(outside.pageSize.width);

    await ok("delete_elements", { ids: ["far"] });

    const inside = await ok("check_page");

    expect(inside.fits).toBe(true);
    expect(inside.lowest.id).toBe("box");
    expect(inside.contentEndsAt).toEqual({ x: 300, y: 200 });
    expect(inside.pageSize.width).toBeGreaterThan(0);
  });
});

describe("the page in words", () => {
  it("AC-536 lists the things in reading order, with their words, and names what an arrow joins", async () => {
    await ok("create_elements", {
      elements: [
        {
          type: "rectangle",
          id: "second",
          x: 400,
          y: 100,
          width: 160,
          height: 80,
          backgroundColor: "#a5d8ff",
          fillStyle: "solid",
          label: { text: "Insert" },
        },
        {
          type: "rectangle",
          id: "first",
          x: 100,
          y: 100,
          width: 160,
          height: 80,
          label: { text: "Start" },
        },
        {
          type: "arrow",
          id: "link",
          x: 260,
          y: 140,
          width: 140,
          height: 0,
          start: { id: "first" },
          end: { id: "second" },
        },
      ],
    });

    const page = await ok("describe_page");

    expect(page.elements).toBe(3);
    // the labels are the words of their shapes, not things of their own
    expect(page.outline.map((row: any) => row.id)).toEqual([
      "first",
      "second",
      "link",
    ]);
    expect(page.outline[0]).toMatchObject({ type: "rectangle", text: "Start" });
    expect(page.outline[1]).toMatchObject({ text: "Insert", fill: "#a5d8ff" });
    expect(page.outline[2]).toMatchObject({ from: "Start", to: "Insert" });
    expect(page.lines[2]).toContain('from "Start" to "Insert"');
  });

  it("AC-536 is a tool that does not change the document", async () => {
    const spec = mcpToolByName("describe_page");

    expect(spec?.changes).toBe(false);

    const outcome = await run(
      "describe_page",
      {},
      { ...CONTEXT, allowChanges: false },
    );

    expect(outcome.ok).toBe(true);
  });
});
