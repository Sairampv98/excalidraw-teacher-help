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
  isDarkPage,
  presetColorsFor,
  presetLook,
} from "../scene/flowPalette";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen, within } from "./test-utils";

const { h } = window;

const NAMES = [
  "Classic",
  "Cyan and pink",
  "Green and purple",
  "Yellow and blue",
  "Orange and cyan",
  "Pink and lime",
  "Fire and ice",
  "High contrast",
];

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

const preset = (name: string) =>
  screen.getByRole("button", { name: `Colour preset: ${name}` });

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
  it("AC-233 the Look section offers the presets", async () => {
    await lookOpen();

    const group = screen.getByRole("group", { name: "Colour presets" });

    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(NAMES.map((name) => `Colour preset: ${name}`));
  });

  it("AC-233 a preset sets the shape, text and animation colours and the glow together", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(preset("Cyan and pink"));
    });

    // the page is light, so it is the variant that reads on a light page
    expect(state().nodeColor).toBe("#008ba3");
    expect(state().markColor).toBe("#e0007a");
    // the text follows the shape, and the glow is on (D-206, D-208)
    expect(state().textColor).toBeNull();
    expect(state().glowShape).toBe(true);

    // a preset with a text colour of its own sets it
    act(() => {
      fireEvent.click(preset("Fire and ice"));
    });

    expect(state().nodeColor).toBe("#e60023");
    expect(state().textColor).toBe("#1e1e1e");
    expect(state().markColor).toBe("#1f51ff");
  });

  it("AC-233 a preset leaves the arrow, the target and the speed alone", async () => {
    await lookOpen();

    act(() => {
      updateFlowAnimationSettings({
        arrowColor: "#111111",
        hideArrow: true,
        nodeTarget: "box",
        speed: 400,
        nodeStyle: "pulse",
        arrowStyle: "beam",
      });
    });
    act(() => {
      fireEvent.click(preset("Green and purple"));
    });

    expect(state()).toMatchObject({
      arrowColor: "#111111",
      hideArrow: true,
      nodeTarget: "box",
      speed: 400,
      nodeStyle: "pulse",
      arrowStyle: "beam",
    });
  });

  it("AC-233 the variant for the page background is applied", async () => {
    await lookOpen();

    expect(isDarkPage("#ffffff")).toBe(false);
    expect(isDarkPage(undefined)).toBe(false);
    expect(isDarkPage("transparent")).toBe(false);
    expect(isDarkPage("#1e1e1e")).toBe(true);

    // a dark page gets the variant that reads on a dark page
    act(() => {
      h.setState({ viewBackgroundColor: "#1e1e1e" });
    });
    act(() => {
      fireEvent.click(preset("Cyan and pink"));
    });

    expect(state().nodeColor).toBe("#00f0ff");
    expect(state().markColor).toBe("#ff2bd6");

    // and a light one gets the other
    act(() => {
      h.setState({ viewBackgroundColor: "#ffffff" });
    });
    act(() => {
      fireEvent.click(preset("Cyan and pink"));
    });

    expect(state().nodeColor).toBe("#008ba3");
    expect(state().markColor).toBe("#e0007a");
  });

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

  it("AC-233 the chosen preset shows as chosen", async () => {
    await lookOpen();

    // nothing set: Classic is the one in use
    expect(preset("Classic").getAttribute("aria-pressed")).toBe("true");

    act(() => {
      fireEvent.click(preset("Pink and lime"));
    });

    for (const name of NAMES) {
      expect(preset(name).getAttribute("aria-pressed")).toBe(
        name === "Pink and lime" ? "true" : "false",
      );
    }

    // a colour changed by hand is no preset's any more
    act(() => {
      updateFlowAnimationSettings({ nodeColor: "#123456" });
    });

    expect(
      NAMES.filter(
        (name) => preset(name).getAttribute("aria-pressed") === "true",
      ),
    ).toEqual([]);
  });

  it("AC-233 a preset writes through to a marked chart", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });
    act(() => {
      fireEvent.click(preset("Green and purple"));
    });

    const colors = presetColorsFor(
      FLOW_COLOR_PRESETS.find((p) => p.id === "green-purple")!,
      "#ffffff",
    );

    expect(shapes().length).toBeGreaterThan(0);

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toMatchObject(presetLook(colors));
    }
  });

  it("AC-233 classic clears the colours", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });
    act(() => {
      fireEvent.click(preset("Orange and cyan"));
    });

    expect(state().nodeColor).not.toBeNull();

    act(() => {
      fireEvent.click(preset("Classic"));
    });

    expect(state().nodeColor).toBeNull();
    expect(state().textColor).toBeNull();
    expect(state().markColor).toBeNull();
    expect(state().glowShape).toBe(false);

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toMatchObject({
        nodeColor: null,
        textColor: null,
        markColor: null,
        glowShape: false,
        glowText: false,
        glowMark: false,
      });
    }
  });
});
