/**
 * AC-233 - the colour presets (D-206).
 *
 * The rules the presets are chosen by - contrast against the page, colours that
 * differ in hue - are computed with the WCAG formulas, so they are checked and
 * not just believed.
 */

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
  setFlowClassPreview,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { readFlowClass } from "../scene/flowClass";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import {
  DARK_PAGE,
  FLOW_COLOR_PRESETS,
  LIGHT_PAGE,
  contrastRatio,
  hueDistance,
} from "../scene/flowPalette";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen, within } from "./test-utils";

const { h } = window;

const lookOpen = async () => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview", { seed: 2 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={{ elements: built.elements as never }}
    />,
  );

  act(() => {
    h.setState({ width: 1400, height: 900 });
  });
  act(() => {
    API.setSelectedElements([
      h.elements.find(
        (e) => e.type !== "text" && e.type !== "arrow",
      ) as ExcalidrawElement,
    ]);
  });
  act(() => {
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
  });
};

/** the colour pads on the page: there is one, for the part chosen in the table */
const colourPads = () =>
  screen
    .getAllByRole("radiogroup")
    .filter((group) => / colour$/.test(group.getAttribute("aria-label") ?? ""));

const state = () => editorJotaiStore.get(flowAnimationStateAtom);

const shapes = () =>
  h.elements.filter(
    (element) =>
      !element.isDeleted &&
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  );

afterEach(() => {
  stopFlowAnimation();
  setFlowClassPreview(false);
  updateFlowAnimationSettings({
    ...FLOW_LOOK_DEFAULTS,
    nodeStyle: "focus",
    arrowStyle: "none",
    speed: 240,
    camera: false,
    loop: true,
  });
});

describe("AC-233 the colour presets", () => {
  it("AC-233 every colour reads on its page at 3 to 1 or better", () => {
    for (const preset of FLOW_COLOR_PRESETS) {
      for (const [variant, page] of [
        [preset.light, LIGHT_PAGE],
        [preset.dark, DARK_PAGE],
      ] as const) {
        for (const colour of [
          variant.nodeColor,
          variant.textColor,
          variant.markColor,
        ]) {
          if (colour === null) {
            // the default is the accent colour, which the editor itself uses
            continue;
          }

          expect(
            contrastRatio(colour, page),
            `${preset.name}: ${colour} on ${page}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }

    // the formula is the WCAG one: black on white is 21, white on white is 1
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("AC-233 the pairs differ in hue unless they are meant to be alike", () => {
    for (const preset of FLOW_COLOR_PRESETS) {
      for (const variant of [preset.light, preset.dark]) {
        const { nodeColor, markColor } = variant;

        // the highlight and what travels are never the same colour
        expect(nodeColor === markColor && nodeColor !== null).toBe(false);

        // black and white have no hue to tell apart
        const achromatic = ["#000000", "#ffffff"];

        if (
          preset.alike ||
          nodeColor === null ||
          markColor === null ||
          achromatic.includes(nodeColor.toLowerCase())
        ) {
          continue;
        }

        expect(
          hueDistance(nodeColor, markColor),
          `${preset.name}: ${nodeColor} and ${markColor}`,
        ).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it("AC-233 the Look tab has a table of colours and neon, and no presets", async () => {
    await lookOpen();

    // the quick presets are gone (the owner, 2026-11-11)
    expect(screen.queryByRole("group", { name: "Colour presets" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Colour preset:/ }),
    ).toBeNull();

    const table = screen.getByRole("table", { name: "Colours and neon" });

    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Shape", "Text", "Animation", "Arrow"]);
    expect(
      within(table)
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")!.textContent),
    ).toEqual(["Neon shape", "Neon text", "Neon animation", "Neon arrows"]);

    // one pad serves the part that is chosen, and the first is chosen
    expect(colourPads()).toHaveLength(1);
    expect(
      screen.getByRole("radiogroup", { name: "Shape colour" }),
    ).toBeTruthy();
  });

  it("AC-233 the pad sets the colour of the part chosen in the table, and the table shows it", async () => {
    await lookOpen();

    const chip = (part: string) =>
      screen.getByRole("button", { name: `Choose the ${part} colour` });

    expect(chip("shape").getAttribute("aria-pressed")).toBe("true");

    for (const [part, group, key] of [
      ["shape", "Shape colour", "nodeColor"],
      ["text", "Text colour", "textColor"],
      ["animation", "Animation colour", "markColor"],
      ["arrow", "Arrow colour", "arrowColor"],
    ] as const) {
      act(() => {
        fireEvent.click(chip(part));
      });

      expect(chip(part).getAttribute("aria-pressed")).toBe("true");
      expect(colourPads()).toHaveLength(1);

      act(() => {
        fireEvent.click(
          within(screen.getByRole("radiogroup", { name: group })).getAllByRole(
            "radio",
          )[2],
        );
      });

      const set = state()[key];

      expect(set).not.toBeNull();
      // the chip shows the colour that is set
      expect(
        (chip(part).firstElementChild as HTMLElement).style.backgroundColor,
      ).not.toBe("");
      expect(chip(part).getAttribute("title")).toContain(
        part[0].toUpperCase() + part.slice(1),
      );
    }
  });

  it("AC-233 each neon switch is next to its part and sets its own glow", async () => {
    await lookOpen();

    for (const [label, key] of [
      ["Neon shape", "glowShape"],
      ["Neon text", "glowText"],
      ["Neon animation", "glowMark"],
      ["Neon arrows", "glowArrow"],
    ] as const) {
      expect(state()[key]).toBe(false);

      act(() => {
        fireEvent.click(screen.getByLabelText(label));
      });

      expect(state()[key]).toBe(true);
    }
  });

  it("AC-233 a colour from the pad writes through to a marked chart", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });
    act(() => {
      fireEvent.click(
        within(
          screen.getByRole("radiogroup", { name: "Shape colour" }),
        ).getAllByRole("radio")[3],
      );
    });

    expect(state().nodeColor).not.toBeNull();
    expect(shapes().length).toBeGreaterThan(0);

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toMatchObject({
        nodeColor: state().nodeColor,
      });
    }
  });
});
