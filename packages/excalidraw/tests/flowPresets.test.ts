/**
 * AC-195 and AC-197 - the flow presets build bound charts that fit the page
 * (D-162, D-163, D-165).
 *
 * The expectations are read back from the elements themselves - the bindings,
 * the boxes, the text - and not re-derived from the builder's own formulas, so
 * a builder that is consistently wrong cannot pass by agreeing with itself.
 */

import { describe, expect, it } from "vitest";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  BASE_FLOW_FONT_SIZE,
  FLOW_PRESETS,
  MIN_FLOW_FONT_SIZE,
  buildFlowPreset,
} from "../scene/flowPresets";

import type { FlowPageRect, FlowPresetId } from "../scene/flowPresets";

const DEFAULT_PAGE: FlowPageRect = { x: 0, y: 0, width: 1920, height: 1080 };
const SMALL_PAGE: FlowPageRect = { x: 5000, y: 300, width: 900, height: 700 };

const PRESET_IDS = FLOW_PRESETS.map((p) => p.id);

/** a script of about `n` nodes for a preset */
const scriptFor = (preset: FlowPresetId, n: number): string => {
  const lines = (count: number, make: (i: number) => string) =>
    Array.from({ length: count }, (_, i) => make(i)).join("\n");

  switch (preset) {
    case "decision":
      return n === 1
        ? "Only step"
        : `Start\n? Ready?\nGo\nWait\n${lines(
            Math.max(0, n - 4),
            (i) => `Then ${i}`,
          )}`;
    case "tiers":
      return lines(Math.max(1, Math.ceil(n / 3)), (t) =>
        Array.from(
          { length: Math.min(3, n - t * 3) },
          (_, i) => `T${t}-${i}`,
        ).join(" | "),
      );
    case "integration":
      return lines(n, (i) => (i === 0 ? "Hub" : `Service ${i}`));
    case "network":
      return n === 1
        ? "Lonely"
        : `${lines(n - 1, (i) => `N${i} -> N${i + 1}`)}\nN0 -> N${n - 1}`;
    default:
      return lines(n, (i) => `Step ${i + 1}`);
  }
};

const build = (
  preset: FlowPresetId,
  script: string,
  options: Parameters<typeof buildFlowPreset>[2] = {},
) => {
  const result = buildFlowPreset(preset, script, options);

  if (!result.ok) {
    throw new Error(`${preset}: ${result.error}`);
  }

  return result;
};

const isArrow = (el: ExcalidrawElement): el is ExcalidrawArrowElement =>
  el.type === "arrow";

const isText = (el: ExcalidrawElement): el is ExcalidrawTextElement =>
  el.type === "text";

const nodeShapes = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((el) => el.customData?.flow?.role === "node");

/** the box an element covers, arrows included */
const extent = (el: ExcalidrawElement) => {
  if (isArrow(el)) {
    const xs = el.points.map((p) => el.x + p[0]);
    const ys = el.points.map((p) => el.y + p[1]);

    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }

  return {
    left: el.x,
    top: el.y,
    right: el.x + el.width,
    bottom: el.y + el.height,
  };
};

const byId = (elements: readonly ExcalidrawElement[]) =>
  new Map(elements.map((el) => [el.id, el]));

/** an element with the timestamp taken out, which is the only thing that varies */
const stable = (el: ExcalidrawElement) => ({ ...el, updated: 0 });

describe("flow presets build bound charts (AC-195)", () => {
  it("AC-195 every preset builds bound arrows with both sides agreeing", () => {
    for (const preset of PRESET_IDS) {
      for (const count of [1, 2, 7]) {
        const { elements } = build(preset, scriptFor(preset, count));
        const map = byId(elements);

        for (const arrow of elements.filter(isArrow)) {
          expect(arrow.startBinding, `${preset}/${count} start`).toBeTruthy();
          expect(arrow.endBinding, `${preset}/${count} end`).toBeTruthy();

          for (const [end, binding] of [
            ["start", arrow.startBinding!],
            ["end", arrow.endBinding!],
          ] as const) {
            const shape = map.get(binding.elementId);

            // the binding names a shape that is in the result ...
            expect(
              shape,
              `${preset}/${count} ${end} names a shape`,
            ).toBeTruthy();
            // ... and the shape names the arrow back
            expect(
              shape!.boundElements?.some(
                (b) => b.id === arrow.id && b.type === "arrow",
              ),
              `${preset}/${count} ${end} is named back`,
            ).toBe(true);

            // and the arrow really is where the binding says it is
            const point =
              end === "start"
                ? { x: arrow.x, y: arrow.y }
                : {
                    x: arrow.x + arrow.points[arrow.points.length - 1][0],
                    y: arrow.y + arrow.points[arrow.points.length - 1][1],
                  };

            expect(point.x).toBeCloseTo(
              shape!.x + shape!.width * binding.fixedPoint[0],
              4,
            );
            expect(point.y).toBeCloseTo(
              shape!.y + shape!.height * binding.fixedPoint[1],
              4,
            );
          }
        }

        // every arrow a shape claims is an arrow that claims the shape
        for (const shape of nodeShapes(elements)) {
          for (const bound of shape.boundElements ?? []) {
            if (bound.type !== "arrow") {
              continue;
            }
            const arrow = map.get(bound.id) as ExcalidrawArrowElement;

            expect(
              arrow,
              `${preset}/${count} claimed arrow exists`,
            ).toBeTruthy();
            expect(
              [arrow.startBinding?.elementId, arrow.endBinding?.elementId],
              `${preset}/${count} claimed arrow points back`,
            ).toContain(shape.id);
          }
        }
      }
    }
  });

  it("AC-195 every shape carries its label as bound text", () => {
    for (const preset of PRESET_IDS) {
      const { elements } = build(preset, scriptFor(preset, 7));
      const map = byId(elements);

      for (const shape of nodeShapes(elements)) {
        const ref = shape.boundElements?.find((b) => b.type === "text");

        expect(ref, `${preset} shape has bound text`).toBeTruthy();

        const text = map.get(ref!.id);

        expect(text && isText(text)).toBe(true);
        expect((text as ExcalidrawTextElement).containerId).toBe(shape.id);
        expect(
          (text as ExcalidrawTextElement).originalText.length,
        ).toBeGreaterThan(0);

        // the text is inside its shape
        const inner = extent(text!);
        const outer = extent(shape);

        expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.001);
        expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.001);
        expect(inner.right).toBeLessThanOrEqual(outer.right + 0.001);
        expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.001);
      }
    }

    // the label is what the script said (the steps preset numbers it)
    const { elements } = build("process", "  Plan the lesson \nTeach it");

    expect(elements.filter(isText).map((t) => t.originalText)).toEqual([
      "Plan the lesson",
      "Teach it",
    ]);
    expect(
      build("steps", "Open it\nSave it")
        .elements.filter(isText)
        .map((t) => t.originalText),
    ).toEqual(["1. Open it", "2. Save it"]);
  });

  it("AC-195 ids are unique and the seed makes the chart repeatable", () => {
    for (const preset of PRESET_IDS) {
      const script = scriptFor(preset, 7);
      const first = build(preset, script, { seed: 7 });
      const again = build(preset, script, { seed: 7 });
      const other = build(preset, script, { seed: 8 });

      const ids = first.elements.map((el) => el.id);

      expect(new Set(ids).size, `${preset} ids are unique`).toBe(ids.length);
      expect(again.elements.map(stable), `${preset} repeats`).toEqual(
        first.elements.map(stable),
      );
      expect(other.elements.map((el) => el.id)).not.toEqual(ids);
    }
  });

  it("AC-195 a loop returns to its first step", () => {
    const { elements } = build("cycle", "Plan\nBuild\nTest\nImprove");
    const shapes = nodeShapes(elements);
    const arrows = elements.filter(isArrow);

    expect(shapes).toHaveLength(4);
    // a ring of four steps has four arrows, one of them from the last to the first
    expect(arrows).toHaveLength(4);
    expect(
      arrows.some(
        (a) =>
          a.startBinding?.elementId === shapes[3].id &&
          a.endBinding?.elementId === shapes[0].id,
      ),
    ).toBe(true);

    // the steps are laid out round the loop, not in a line: the first is the
    // highest of them
    const tops = shapes.map((s) => s.y);

    expect(tops[0]).toBe(Math.min(...tops));
  });

  it("AC-195 the decision rejoins", () => {
    const { elements } = build(
      "decision",
      "Start\n? Is it raining?\nUmbrella\nSunglasses\nGo outside",
    );
    const map = byId(elements);
    const label = (id: string) => {
      const shape = map.get(id)!;
      const text = map.get(
        shape.boundElements!.find((b) => b.type === "text")!.id,
      ) as ExcalidrawTextElement;

      return text.originalText;
    };
    const arrows = elements.filter(isArrow);

    // two arrows come into the step after the branches ...
    const into = arrows
      .filter((a) => label(a.endBinding!.elementId) === "Go outside")
      .map((a) => label(a.startBinding!.elementId))
      .sort();

    expect(into).toEqual(["Sunglasses", "Umbrella"]);

    // ... the question is a diamond, and says yes and no
    const question = nodeShapes(elements).find(
      (s) => label(s.id) === "Is it raining?",
    )!;

    expect(question.type).toBe("diamond");
    expect(
      elements
        .filter(isText)
        .filter(
          (t) => t.containerId && map.get(t.containerId)?.type === "arrow",
        )
        .map((t) => t.originalText)
        .sort(),
    ).toEqual(["no", "yes"]);
  });

  it("AC-195 the tiers stack and the hub is in the middle", () => {
    const tiers = build("tiers", "Web | Mobile\nAPI\nServices | Cache | Queue");
    const map = byId(tiers.elements);
    const textOf = (shape: ExcalidrawElement) =>
      (
        map.get(
          shape.boundElements!.find((b) => b.type === "text")!.id,
        ) as ExcalidrawTextElement
      ).originalText;
    const shapes = nodeShapes(tiers.elements);
    const row = (name: string) => shapes.find((s) => textOf(s) === name)!;

    // the tiers stack top to bottom, with nothing between them
    expect(row("API").y).toBeGreaterThan(
      row("Web").y + row("Web").height - 0.001,
    );
    expect(row("Services").y).toBeGreaterThan(
      row("API").y + row("API").height - 0.001,
    );

    // the items of one tier share a row
    expect(row("Web").y).toBe(row("Mobile").y);
    expect(row("Services").y).toBe(row("Queue").y);

    // every tier spans the same width, so the tiers stack flush
    const span = (names: string[]) => {
      const boxes = names.map((n) => extent(row(n)));

      return [
        Math.min(...boxes.map((b) => b.left)),
        Math.max(...boxes.map((b) => b.right)),
      ];
    };

    expect(span(["Web", "Mobile"])[0]).toBeCloseTo(span(["API"])[0], 3);
    expect(span(["Web", "Mobile"])[1]).toBeCloseTo(span(["API"])[1], 3);
    expect(span(["Services", "Cache", "Queue"])[1]).toBeCloseTo(
      span(["API"])[1],
      3,
    );

    // a tier chart has no arrows
    expect(tiers.elements.filter(isArrow)).toHaveLength(0);

    // the hub is in the middle of what it connects to
    const hub = build("integration", "Our app\nA\nB\nC\nD\nE");
    const hubShapes = nodeShapes(hub.elements);
    const centre = (el: ExcalidrawElement) => ({
      x: el.x + el.width / 2,
      y: el.y + el.height / 2,
    });
    const spokes = hubShapes.slice(1).map(centre);
    const mean = {
      x: spokes.reduce((s, c) => s + c.x, 0) / spokes.length,
      y: spokes.reduce((s, c) => s + c.y, 0) / spokes.length,
    };

    expect(centre(hubShapes[0]).x).toBeCloseTo(mean.x, 0);
    expect(centre(hubShapes[0]).y).toBeCloseTo(mean.y, 0);
    expect(hub.elements.filter(isArrow)).toHaveLength(5);
  });
});

describe("flow presets fit the page (AC-197)", () => {
  const pages = [
    ["the default page", DEFAULT_PAGE],
    ["a small page", SMALL_PAGE],
  ] as const;

  it("AC-197 every shape is inside the page", () => {
    for (const [name, page] of pages) {
      for (const preset of PRESET_IDS) {
        for (const count of [1, 10]) {
          const result = buildFlowPreset(preset, scriptFor(preset, count), {
            page,
          });

          // a chart either fits or is reported (below); one that is built fits
          if (!result.ok) {
            continue;
          }

          for (const el of result.elements) {
            const box = extent(el);

            expect(
              box.left,
              `${name} ${preset}/${count}`,
            ).toBeGreaterThanOrEqual(page.x);
            expect(box.top).toBeGreaterThanOrEqual(page.y);
            expect(box.right).toBeLessThanOrEqual(page.x + page.width);
            expect(box.bottom).toBeLessThanOrEqual(page.y + page.height);
          }
        }
      }
    }

    // and ten steps do fit the default page: the fit is not just "report everything"
    for (const preset of PRESET_IDS) {
      expect(
        buildFlowPreset(preset, scriptFor(preset, 10), { page: DEFAULT_PAGE })
          .ok,
        `${preset} with ten nodes fits the default page`,
      ).toBe(true);
    }

    // a chart is placed where it is asked to be, and kept on the page
    const nearEdge = build("process", "a\nb", {
      page: DEFAULT_PAGE,
      center: { x: 5, y: 5 },
    });

    expect(nearEdge.bounds.x).toBeGreaterThanOrEqual(0);
    expect(nearEdge.bounds.y).toBeGreaterThanOrEqual(0);
  });

  it("AC-197 no two shapes overlap", () => {
    for (const preset of PRESET_IDS) {
      for (const count of [2, 10, 25]) {
        const result = buildFlowPreset(preset, scriptFor(preset, count));

        if (!result.ok) {
          continue;
        }

        const boxes = nodeShapes(result.elements).map(extent);

        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const overlap =
              a.left < b.right &&
              b.left < a.right &&
              a.top < b.bottom &&
              b.top < a.bottom;

            expect(overlap, `${preset}/${count}: shapes ${i} and ${j}`).toBe(
              false,
            );
          }
        }
      }
    }
  });

  it("AC-197 the text never goes below the floor", () => {
    expect(MIN_FLOW_FONT_SIZE).toBeGreaterThanOrEqual(12);

    for (const [, page] of pages) {
      for (const preset of PRESET_IDS) {
        for (const count of [1, 10, 25]) {
          const result = buildFlowPreset(preset, scriptFor(preset, count), {
            page,
          });

          if (!result.ok) {
            continue;
          }

          expect(result.fontSize).toBeGreaterThanOrEqual(MIN_FLOW_FONT_SIZE);
          expect(result.fontSize).toBeLessThanOrEqual(BASE_FLOW_FONT_SIZE);

          // the labels in the shapes carry that size
          for (const text of result.elements.filter(isText)) {
            if (text.customData?.flow?.role === "label") {
              expect(text.fontSize).toBe(result.fontSize);
            }
          }
        }
      }
    }

    // a small chart keeps the full size; a bigger one is shrunk, not cut (a long
    // run of steps wraps into rows instead, D-227)
    expect(build("process", "a\nb").fontSize).toBe(BASE_FLOW_FONT_SIZE);
    expect(build("cycle", scriptFor("cycle", 18)).fontSize).toBeLessThan(
      BASE_FLOW_FONT_SIZE,
    );
  });

  it("AC-197 a script too big for the floor is reported", () => {
    const result = buildFlowPreset("cycle", scriptFor("cycle", 100), {
      page: DEFAULT_PAGE,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.tooBig).toBe(true);
    expect(!result.ok && result.error).toMatch(/page/i);

    // and nothing was built to be shrunk past the floor
    expect("elements" in result).toBe(false);

    // a script with no lines is a different failure: it is not "too big"
    const empty = buildFlowPreset("process", "  ");

    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.tooBig).toBeUndefined();
  });
});
