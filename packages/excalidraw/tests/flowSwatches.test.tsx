/**
 * AC-229 - the colours are chosen from a swatch pad (D-207).
 *
 * The pad is used the way a person uses it: swatches pressed, the keyboard
 * moved along, and the setting read back from the animation's own state.
 */

import fs from "node:fs";
import path from "node:path";

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
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { FLOW_SWATCHES, swatchOf } from "../scene/flowPalette";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen, within } from "./test-utils";

const { h } = window;

const PADS = [
  { label: "Highlight colour", key: "nodeColor" },
  { label: "Animation colour", key: "markColor" },
  { label: "Arrow colour", key: "arrowColor" },
] as const;

/** the bar of a chart that is selected, with its Look section open */
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
    fireEvent.click(screen.getByRole("button", { name: "Look" }));
  });
};

const pad = (label: string) => screen.getByRole("radiogroup", { name: label });

const swatch = (label: string, name: string) =>
  screen.getByRole("radio", { name: `${label}: ${name}` });

const state = () => editorJotaiStore.get(flowAnimationStateAtom);

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

describe("AC-229 the colours are chosen from a swatch pad", () => {
  it("AC-229 each colour is chosen from a pad of swatches", async () => {
    await lookOpen();

    for (const { label } of PADS) {
      const radios = within(pad(label)).getAllByRole("radio");

      // the default, the colours, black, white and grey
      expect(radios).toHaveLength(FLOW_SWATCHES.length);

      for (const { name } of FLOW_SWATCHES) {
        expect(swatch(label, name)).not.toBeNull();
      }
    }

    // pressing a swatch sets that colour, for each of the three
    for (const { label, key } of PADS) {
      act(() => {
        fireEvent.click(swatch(label, "Blue"));
      });

      expect(state()[key]).toBe("#1971c2");
    }
  });

  it("AC-229 the current choice is ringed", async () => {
    await lookOpen();

    const label = "Highlight colour";

    // nothing chosen: the default is the choice
    expect(swatch(label, "Default").getAttribute("aria-checked")).toBe("true");
    expect(swatch(label, "Red").getAttribute("aria-checked")).toBe("false");

    act(() => {
      fireEvent.click(swatch(label, "Red"));
    });

    expect(swatch(label, "Red").getAttribute("aria-checked")).toBe("true");
    expect(swatch(label, "Default").getAttribute("aria-checked")).toBe("false");

    // exactly one is ringed, and the stylesheet draws the ring
    expect(
      within(pad(label))
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
    expect(
      fs.readFileSync(
        path.resolve(__dirname, "../components/FlowColorPad.scss"),
        "utf8",
      ),
    ).toMatch(/aria-checked="true"[\s\S]*box-shadow/);
  });

  it("AC-229 the default swatch clears the colour", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(swatch("Animation colour", "Green"));
    });

    expect(state().markColor).toBe("#2f9e44");

    act(() => {
      fireEvent.click(swatch("Animation colour", "Default"));
    });

    expect(state().markColor).toBeNull();
  });

  it("AC-229 a custom swatch opens the browser's picker", async () => {
    await lookOpen();

    const custom = screen.getByLabelText(
      "Arrow colour: custom",
    ) as HTMLInputElement;

    // the native colour input: the browser's own picker
    expect(custom.type).toBe("color");

    act(() => {
      fireEvent.change(custom, { target: { value: "#123456" } });
    });

    expect(state().arrowColor).toBe("#123456");

    // none of the swatches is it, so the custom one is the choice
    expect(
      custom.closest("[data-swatch='custom']")!.hasAttribute("data-checked"),
    ).toBe(true);
    expect(
      within(pad("Arrow colour"))
        .getAllByRole("radio")
        .some((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toBe(false);
  });

  it("AC-229 a custom colour equal to a swatch rings it", async () => {
    await lookOpen();

    const custom = screen.getByLabelText(
      "Highlight colour: custom",
    ) as HTMLInputElement;

    act(() => {
      // the picker gives lower case; a stored value may not
      fireEvent.change(custom, { target: { value: "#e03131" } });
    });

    expect(swatch("Highlight colour", "Red").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      custom.closest("[data-swatch='custom']")!.hasAttribute("data-checked"),
    ).toBe(false);

    // upper case is the same colour
    expect(swatchOf("#E03131")?.id).toBe("red");
  });

  it("AC-229 the pad is a radio group reachable by keyboard", async () => {
    await lookOpen();

    const label = "Highlight colour";
    const radios = () => within(pad(label)).getAllByRole("radio");

    // one stop for the tab key: the choice
    expect(
      radios().filter((r) => r.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    expect(swatch(label, "Default").getAttribute("tabindex")).toBe("0");

    // the arrow keys move along the pad and choose as they go
    const first = swatch(label, "Default");

    first.focus();
    act(() => {
      fireEvent.keyDown(first, { key: "ArrowRight" });
    });

    expect(state().nodeColor).toBe("#e03131");
    expect(document.activeElement).toBe(swatch(label, "Red"));

    act(() => {
      fireEvent.keyDown(swatch(label, "Red"), { key: "ArrowRight" });
    });

    expect(state().nodeColor).toBe("#e8590c");

    // and it wraps: left from the first is the last
    act(() => {
      fireEvent.click(swatch(label, "Default"));
    });
    swatch(label, "Default").focus();
    act(() => {
      fireEvent.keyDown(swatch(label, "Default"), { key: "ArrowLeft" });
    });

    expect(state().nodeColor).toBe("#868e96");
  });
});
