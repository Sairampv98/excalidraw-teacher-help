/**
 * Flow charts as tools (D-419 to D-423): the kinds, a script checked, a chart made
 * from a script, listed, changed in place, deleted, and a script written for
 * another kind.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";
import { runMcpTool } from "../mcp/runner";
import { FLOW_CUSTOM_PRESETS_KEY } from "../scene/flowCustomPresets";

import { Keyboard } from "./helpers/ui";
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

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

const live = () => h.elements.filter((element) => !element.isDeleted);

/** the shapes of a chart: boxes that are not the words in them */
const shapesOf = (chartId: string) =>
  live().filter(
    (element) =>
      (element.customData as any)?.flow?.chartId === chartId &&
      element.type !== "text" &&
      element.type !== "arrow",
  );

const PROCESS = "Plan the lesson\nTeach it\nSet the task\nCheck the work";

/** a script of some lines, one to a step */
const steps = (count: number) =>
  Array.from(
    { length: count },
    (_unused, index) => `Step number ${index + 1}`,
  ).join("\n");

beforeEach(async () => {
  window.localStorage.removeItem(FLOW_CUSTOM_PRESETS_KEY);
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true} />,
  );
});

afterEach(() => {
  window.localStorage.removeItem(FLOW_CUSTOM_PRESETS_KEY);
});

describe("the kinds of chart", () => {
  it("AC-507 lists the kinds the whiteboard makes with what each is and an example, and the teacher's own", async () => {
    const plain = await ok("flow_kinds");

    expect(plain.kinds.map((kind: any) => kind.id)).toEqual([
      "process",
      "decision",
      "steps",
      "cycle",
      "tiers",
      "integration",
      "network",
      "list",
      "grid",
      "matrix",
      "pyramid",
      "funnel",
      "timeline",
      "target",
      "venn",
      "hierarchy",
    ]);

    for (const kind of plain.kinds) {
      expect(kind).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        example: expect.stringMatching(/\S/),
        custom: false,
      });
    }

    expect(plain.script).toMatch(/\?/);
    expect(plain.script).toMatch(/->/);

    window.localStorage.setItem(
      FLOW_CUSTOM_PRESETS_KEY,
      JSON.stringify([
        {
          id: "custom-fruit",
          name: "Fruit ring",
          description: "A ring of fruit",
          example: "Apple\nPear\nPlum",
          layout: "ring",
          colours: { fills: ["#ffc9c9"], outline: "#c92a2a" },
          shape: "own",
        },
      ]),
    );

    const withOwn = await ok("flow_kinds");
    const own = withOwn.kinds.find((kind: any) => kind.custom);

    expect(withOwn.kinds).toHaveLength(17);
    expect(own).toMatchObject({
      id: "custom-fruit",
      name: "Fruit ring",
      example: "Apple\nPear\nPlum",
    });
  });
});

describe("checking a script", () => {
  it("AC-508 says whether a script can be made, how many nodes and arrows it has, the text size and the pages, without making it", async () => {
    const result = await ok("check_flow_script", {
      kind: "process",
      script: PROCESS,
    });

    expect(result).toMatchObject({
      ok: true,
      nodes: 4,
      arrows: 3,
      pages: 1,
      problems: [],
      reason: null,
    });
    expect(result.fontSize).toBeGreaterThanOrEqual(14);
    expect(live()).toHaveLength(0);

    const none = await ok("check_flow_script", {
      kind: "process",
      script: PROCESS,
      arrows: "none",
    });

    expect(none.arrows).toBe(0);
  });

  it("AC-508 says why a script cannot be made: no words, a chart too big for its page at a text that can be read, and how fit changes it", async () => {
    expect(
      await ok("check_flow_script", { kind: "process", script: "" }),
    ).toMatchObject({ ok: false, reason: expect.any(String) });

    const big = steps(40);
    const page = await ok("check_flow_script", {
      kind: "list",
      script: big,
    });

    expect(page.ok).toBe(false);
    expect(page.reason).toMatch(/\S/);

    const larger = await ok("check_flow_script", {
      kind: "list",
      script: big,
      fit: "larger",
    });
    const spread = await ok("check_flow_script", {
      kind: "list",
      script: big,
      fit: "spread",
    });

    expect(larger.ok).toBe(true);
    expect(spread.ok).toBe(true);
    expect(spread.pages).toBeGreaterThan(1);
    expect(page.pages).toBe(0);
    expect(larger.pages).toBe(1);
  });

  it("AC-508 refuses a kind that is not one, a fit, a shape or arrows that are not, a script that is too long, and a page that is not there", async () => {
    expect(
      await run("check_flow_script", { kind: "pizza", script: "a" }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/flow_kinds/),
      },
    });
    expect(
      await run("check_flow_script", {
        kind: "process",
        script: "a",
        fit: "wide",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("check_flow_script", {
        kind: "process",
        script: "a",
        shape: "star",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("check_flow_script", {
        kind: "process",
        script: "a",
        arrows: "some",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("check_flow_script", {
        kind: "process",
        script: "x".repeat(20_001),
      }),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run("check_flow_script", { kind: "process", script: "a", page: 9 }),
    ).toMatchObject({ ok: false });
    expect(await run("check_flow_script", { kind: "process" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });
});

describe("making a chart", () => {
  it("AC-509 makes a chart that remembers its script, in the middle of the page, in one undo step", async () => {
    const result = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
    });

    expect(result).toMatchObject({
      kind: "process",
      page: 1,
      pages: 1,
      pagesMade: 0,
      nodes: 4,
      arrows: 3,
    });
    expect(result.chartId).toMatch(/^chart-/);
    expect(result.created).toBe(live().length);
    expect(shapesOf(result.chartId)).toHaveLength(4);
    // the middle of a page 1920 by 1080
    expect(result.at.x + result.size.width / 2).toBeCloseTo(960, -1);
    expect(result.at.y + result.size.height / 2).toBeCloseTo(540, -1);

    const listed = await ok("list_flow_charts");

    expect(listed.charts).toEqual([
      expect.objectContaining({
        chartId: result.chartId,
        kind: "process",
        script: PROCESS,
        fit: "page",
        shape: "own",
        arrows: "own",
        pages: [1],
        nodes: 4,
      }),
    ]);

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-509 puts the middle of a chart where asked, on the page asked for, and keeps it on the page", async () => {
    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });

    const result = await ok("create_flow_chart", {
      kind: "cycle",
      script: "Plan\nBuild\nTest\nImprove",
      page: 2,
      x: 1200,
      y: 300,
    });

    expect(result.page).toBe(2);
    expect(
      shapesOf(result.chartId).every((shape) => shape.pageId === "p2"),
    ).toBe(true);
    expect(result.at.x + result.size.width / 2).toBeCloseTo(1200, -1);
    expect(result.at.y + result.size.height / 2).toBeCloseTo(300, -1);

    // a place off the page is brought back on it
    const off = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
      page: 2,
      x: 100000,
      y: 100000,
    });

    expect(off.at.x + off.size.width).toBeLessThanOrEqual(1920);
    expect(off.at.y + off.size.height).toBeLessThanOrEqual(1080);
  });

  it("AC-509 takes the shape and the arrows asked for, a kind of the teacher's own, and a larger text over the page", async () => {
    const circles = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
      shape: "ellipse",
      arrows: "none",
    });

    expect(circles.arrows).toBe(0);
    expect(
      shapesOf(circles.chartId).every((shape) => shape.type === "ellipse"),
    ).toBe(true);
    expect(live().filter((element) => element.type === "arrow")).toHaveLength(
      0,
    );

    window.localStorage.setItem(
      FLOW_CUSTOM_PRESETS_KEY,
      JSON.stringify([
        {
          id: "custom-fruit",
          name: "Fruit ring",
          description: "",
          example: "Apple\nPear\nPlum",
          layout: "ring",
          colours: { fills: ["#ffc9c9"], outline: "#c92a2a" },
          shape: "own",
        },
      ]),
    );

    const own = await ok("create_flow_chart", {
      kind: "custom-fruit",
      script: "Apple\nPear\nPlum",
    });

    expect(own.kind).toBe("custom-fruit");
    expect(
      (await ok("list_flow_charts")).charts.find(
        (chart: any) => chart.chartId === own.chartId,
      ),
    ).toMatchObject({ kind: "custom-fruit", custom: "Fruit ring" });
    expect(
      shapesOf(own.chartId).every((shape) => shape.strokeColor === "#c92a2a"),
    ).toBe(true);

    const larger = await ok("create_flow_chart", {
      kind: "list",
      script: steps(40),
      fit: "larger",
    });

    expect(larger.pages).toBe(1);
    expect(larger.fontSize).toBe(18);
  });

  it("AC-509 spreads a chart that is too big over the pages that follow, makes the pages that are missing, and one undo takes the chart and the pages away", async () => {
    const pagesBefore = h.state.pages.length;
    const result = await ok("create_flow_chart", {
      kind: "list",
      script: steps(40),
      fit: "spread",
    });

    expect(result.pages).toBeGreaterThan(1);
    expect(result.pagesMade).toBe(result.pages - 1);
    expect(h.state.pages).toHaveLength(pagesBefore + result.pagesMade);

    const used = new Set(shapesOf(result.chartId).map((shape) => shape.pageId));

    expect(used.size).toBe(result.pages);
    expect((await ok("list_flow_charts")).charts[0].pages).toHaveLength(
      result.pages,
    );

    undo();
    expect(live()).toHaveLength(0);
    expect(h.state.pages).toHaveLength(pagesBefore);
  });

  it("AC-509 refuses a kind that is not one, a script with nothing in it, one too big for the page at a readable text, a fit, shape or arrows that are not, and Allow changes off, and makes nothing", async () => {
    expect(
      await run("create_flow_chart", { kind: "pizza", script: "a\nb" }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("create_flow_chart", { kind: "process", script: "  " }),
    ).toMatchObject({ error: { code: "bad-arguments" } });

    const big = await run("create_flow_chart", {
      kind: "list",
      script: steps(40),
    });

    expect(big).toMatchObject({ ok: false, error: { code: "bad-arguments" } });
    expect(
      await run("create_flow_chart", {
        kind: "process",
        script: PROCESS,
        fit: "wide",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("create_flow_chart", {
        kind: "process",
        script: PROCESS,
        shape: "star",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("create_flow_chart", {
        kind: "process",
        script: PROCESS,
        arrows: "x",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run(
        "create_flow_chart",
        { kind: "process", script: PROCESS },
        { ...CONTEXT, allowChanges: false },
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(live()).toHaveLength(0);
  });
});

describe("listing, changing and deleting a chart", () => {
  it("AC-510 lists the charts on the pages with their script, kind and pages, only those on a page when asked, and not what is deleted or is not a chart", async () => {
    await act(async () => {
      h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
    });

    const one = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
    });
    const two = await ok("create_flow_chart", {
      kind: "cycle",
      script: "A\nB\nC",
      page: 2,
    });

    await ok("create_elements", {
      elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    });

    const all = await ok("list_flow_charts");

    expect(all.charts.map((chart: any) => chart.chartId).sort()).toEqual(
      [one.chartId, two.chartId].sort(),
    );

    const onTwo = await ok("list_flow_charts", { page: 2 });

    expect(onTwo.charts).toHaveLength(1);
    expect(onTwo.charts[0]).toMatchObject({
      chartId: two.chartId,
      kind: "cycle",
      script: "A\nB\nC",
      pages: [2],
      nodes: 3,
    });

    await ok("delete_flow_chart", { chartId: one.chartId });
    expect((await ok("list_flow_charts")).charts).toHaveLength(1);
  });

  it("AC-511 changes the script in place: the nodes whose words are the same are kept with their place and colours, a new line adds one, a line that is gone removes its node, in one undo step", async () => {
    const made = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
    });
    const second = shapesOf(made.chartId).find((shape) => {
      const text = live().find(
        (element) =>
          element.type === "text" && (element as any).containerId === shape.id,
      ) as any;

      return text?.originalText === "Teach it";
    })!;

    // the teacher colours a node
    await act(async () => {
      h.app.scene.mutateElement(second as any, { backgroundColor: "#ffc9c9" });
    });

    const result = await ok("edit_flow_chart", {
      chartId: made.chartId,
      script: "Plan the lesson\nTeach it\nMark the work\nCheck the work",
    });

    expect(result).toMatchObject({
      chartId: made.chartId,
      rebuilt: false,
      kept: 3,
      added: 1,
      removed: 1,
    });

    const after = live().find((element) => element.id === second.id) as any;

    expect(after.backgroundColor).toBe("#ffc9c9");
    expect((await ok("list_flow_charts")).charts[0].script).toBe(
      "Plan the lesson\nTeach it\nMark the work\nCheck the work",
    );
    expect(shapesOf(made.chartId)).toHaveLength(4);

    undo();
    expect((await ok("list_flow_charts")).charts[0].script).toBe(PROCESS);
  });

  it("AC-511 makes the chart again in the same place when its kind, fit, shape or arrows change, and says so", async () => {
    const made = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
    });
    const before = shapesOf(made.chartId).map((shape) => shape.id);
    const result = await ok("edit_flow_chart", {
      chartId: made.chartId,
      kind: "cycle",
    });

    expect(result).toMatchObject({ rebuilt: true });

    const charts = (await ok("list_flow_charts")).charts;

    expect(charts[0]).toMatchObject({ kind: "cycle", script: PROCESS });
    expect(
      shapesOf(made.chartId).every((shape) => !before.includes(shape.id)),
    ).toBe(true);

    await ok("edit_flow_chart", {
      chartId: made.chartId,
      shape: "ellipse",
      arrows: "none",
    });
    expect(
      shapesOf(made.chartId).every((shape) => shape.type === "ellipse"),
    ).toBe(true);
    expect((await ok("list_flow_charts")).charts[0]).toMatchObject({
      shape: "ellipse",
      arrows: "none",
    });
  });

  it("AC-511 spreads a chart that grows over pages it makes, and one undo takes the change and the pages away", async () => {
    const made = await ok("create_flow_chart", {
      kind: "list",
      script: steps(6),
    });
    const pagesBefore = h.state.pages.length;
    const result = await ok("edit_flow_chart", {
      chartId: made.chartId,
      script: steps(40),
      fit: "spread",
    });

    expect(result.pagesMade).toBeGreaterThan(0);
    expect(h.state.pages.length).toBeGreaterThan(pagesBefore);

    undo();
    expect(h.state.pages).toHaveLength(pagesBefore);
    expect((await ok("list_flow_charts")).charts[0].script).toBe(steps(6));
  });

  it("AC-511 refuses a chart that is not there, one that does not remember its script, a script with problems or too big, a kind that is not one, and Allow changes off, and changes nothing", async () => {
    const made = await ok("create_flow_chart", {
      kind: "process",
      script: PROCESS,
    });
    const snapshot = JSON.stringify(
      live().map((element) => [element.id, element.version]),
    );

    expect(
      await run("edit_flow_chart", {
        chartId: "chart-nothing",
        script: "a\nb",
      }),
    ).toMatchObject({ error: { code: "not-found" } });
    expect(
      await run("edit_flow_chart", { chartId: made.chartId, kind: "pizza" }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("edit_flow_chart", { chartId: made.chartId, script: " " }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("edit_flow_chart", {
        chartId: made.chartId,
        script: steps(150),
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run(
        "edit_flow_chart",
        { chartId: made.chartId, script: "a\nb" },
        { ...CONTEXT, allowChanges: false },
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(
      JSON.stringify(live().map((element) => [element.id, element.version])),
    ).toBe(snapshot);

    // a chart from before charts remembered
    await ok("create_elements", {
      elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    });

    const rectangle = live().find(
      (element) =>
        element.type === "rectangle" && !(element.customData as any)?.flow,
    )!;

    await act(async () => {
      h.app.scene.mutateElement(rectangle as any, {
        customData: { flow: { chartId: "chart-old", role: "node" } },
      });
    });
    expect(
      await run("edit_flow_chart", { chartId: "chart-old", script: "a\nb" }),
    ).toMatchObject({
      error: {
        code: "failed",
        message: expect.stringMatching(/create_flow_chart/),
      },
    });
  });

  it("AC-512 deletes every part of a chart in one undo step, and refuses one that is not there", async () => {
    const made = await ok("create_flow_chart", {
      kind: "decision",
      script: "Start\n? Ready?\nGo\nWait\nEnd",
    });
    const count = live().length;

    expect(count).toBeGreaterThan(8);
    expect(await ok("delete_flow_chart", { chartId: made.chartId })).toEqual({
      chartId: made.chartId,
      deleted: count,
    });
    expect(live()).toHaveLength(0);

    undo();
    expect(live()).toHaveLength(count);

    expect(
      await run("delete_flow_chart", { chartId: "chart-nothing" }),
    ).toMatchObject({ error: { code: "not-found" } });
    expect(
      await run(
        "delete_flow_chart",
        { chartId: made.chartId },
        { ...CONTEXT, allowChanges: false },
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(live()).toHaveLength(count);
  });

  it("AC-512 writes a script for another kind of chart, keeping its words, and says whether it changed", async () => {
    const network = await ok("convert_flow_script", {
      from: "process",
      to: "network",
      script: "Plan\nBuild\nTest",
    });

    expect(network).toMatchObject({
      from: "process",
      to: "network",
      changed: true,
    });
    expect(network.script).toMatch(/Plan\s*->\s*Build/);
    expect(network.script).toMatch(/Build\s*->\s*Test/);

    expect(
      await ok("convert_flow_script", {
        from: "process",
        to: "process",
        script: "Plan\nBuild",
      }),
    ).toMatchObject({ script: "Plan\nBuild", changed: false });
    expect(
      await run("convert_flow_script", {
        from: "pizza",
        to: "process",
        script: "a",
      }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(
      await run("convert_flow_script", { from: "process", to: "cycle" }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
  });
});
