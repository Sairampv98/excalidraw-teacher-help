/**
 * AC-269 - the properties panel sets the ink look (D-241).
 *
 * The real editor, the real panel: the look is chosen with the buttons and read
 * back from the elements, from undo and from what is drawn next.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CaptureUpdateAction, NORMAL_INK, inkOf } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getCurrentInk, setCurrentInk } from "../inkDefault";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

const mount = async (
  elements: ExcalidrawElement[],
  selected: string[] = [],
) => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);

  act(() => {
    h.app.updateScene({
      elements: elements as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });

  if (selected.length) {
    act(() => {
      API.setSelectedElements(
        elements.filter((e) => selected.includes(e.id)) as never,
      );
    });
  }
};

const choose = (look: string) =>
  act(() => {
    fireEvent.click(screen.getByTestId(`ink-look-${look}`));
  });

const live = (id: string) => h.elements.find((e) => e.id === id)!;

describe("AC-269 the properties panel sets the ink look", () => {
  beforeEach(() => {
    setCurrentInk(NORMAL_INK);
  });

  afterEach(() => {
    setCurrentInk(NORMAL_INK);
  });

  it("AC-269 the panel shows the looks for drawn elements", async () => {
    const elements = (
      [
        "text",
        "freedraw",
        "rectangle",
        "diamond",
        "ellipse",
        "line",
        "arrow",
      ] as const
    ).map((type) => API.createElement({ type, id: type }));

    await mount(elements as never);

    for (const element of elements) {
      act(() => {
        API.setSelectedElements([element] as never);
      });

      // the five looks, by name, and Normal is the one that is on
      for (const look of ["normal", "neon", "chalk", "marker", "pencil"]) {
        expect(
          screen.getByTestId(`ink-look-${look}`),
          `${element.type} ${look}`,
        ).not.toBeNull();
      }

      expect(
        screen.getByTestId("ink-look-normal").getAttribute("aria-checked"),
        element.type,
      ).toBe("true");
      // Normal has no colours and no amount
      expect(screen.queryByTestId("ink-look-colors")).toBeNull();
      expect(screen.queryByTestId("ink-amount")).toBeNull();
    }

    // once a look is chosen, its named colours and its amount are there
    choose("neon");
    expect(screen.getByTestId("ink-look-colors").children).toHaveLength(7);
    expect(screen.getByTestId("ink-amount")).not.toBeNull();

    choose("pencil");
    expect(screen.getByTestId("ink-look-colors").children).toHaveLength(5);
    expect(screen.getByText("Darkness")).not.toBeNull();
  });

  it("AC-269 choosing a look sets it on the selection and undo takes it back", async () => {
    const text = API.createElement({ type: "text", id: "t", text: "Hello" });
    const stroke = API.createElement({ type: "freedraw", id: "s" });
    const other = API.createElement({ type: "rectangle", id: "o" });

    await mount([text, stroke, other] as never, ["t", "s"]);

    choose("chalk");

    expect(inkOf(live("t"))).toEqual({ look: "chalk", amount: 50 });
    expect(inkOf(live("s"))).toEqual({ look: "chalk", amount: 50 });
    // what is not selected is not touched
    expect(inkOf(live("o"))).toEqual(NORMAL_INK);

    // the amount and a named colour are set on every selected element
    act(() => {
      fireEvent.change(screen.getByTestId("ink-amount"), {
        target: { value: "80" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("ink-color-pink"));
    });

    expect(inkOf(live("t")).amount).toBe(80);
    expect(inkOf(live("s")).amount).toBe(80);
    expect(live("t").strokeColor).toBe("#f4a6c0");
    expect(live("s").strokeColor).toBe("#f4a6c0");

    // undo takes the colour back, then the amount, then the look
    act(() => {
      Keyboard.undo();
    });
    expect(live("t").strokeColor).not.toBe("#f4a6c0");
    act(() => {
      Keyboard.undo();
    });
    expect(inkOf(live("t")).amount).toBe(50);
    act(() => {
      Keyboard.undo();
    });
    expect(inkOf(live("t"))).toEqual(NORMAL_INK);
    expect(inkOf(live("s"))).toEqual(NORMAL_INK);

    // and back with redo
    act(() => {
      Keyboard.redo();
    });
    expect(inkOf(live("t")).look).toBe("chalk");

    // choosing Normal puts the element back as if it never had a look
    act(() => {
      API.setSelectedElements([live("t"), live("s")] as never);
    });
    choose("normal");
    expect(live("t").customData?.ink).toBeUndefined();
  });

  it("AC-269 a shape and the words inside it take the look together", async () => {
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      boundElements: [{ type: "text", id: "words" }],
    });
    const words = API.createElement({
      type: "text",
      id: "words",
      text: "Inside",
      containerId: "box",
    });
    const before = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      textX: words.x,
      textWidth: words.width,
    };

    await mount([box, words] as never, ["box"]);

    choose("neon");

    expect(inkOf(live("box")).look).toBe("neon");
    expect(inkOf(live("words")).look).toBe("neon");

    // only the ink: the shape and the box of the words are where and what they were
    expect(live("box")).toMatchObject({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
    });
    expect(live("words").x).toBe(before.textX);
    expect(live("words").width).toBe(before.textWidth);
  });

  it("AC-269 the next element drawn has the look", async () => {
    await mount([]);

    expect(getCurrentInk()).toEqual(NORMAL_INK);

    UI.clickTool("rectangle");
    choose("marker");

    expect(getCurrentInk().look).toBe("marker");

    UI.createElement("rectangle", { x: 20, y: 20, size: 80 });
    expect(inkOf(h.elements[0])).toEqual({ look: "marker", amount: 50 });

    // it stays for the next one, with another tool
    UI.createElement("ellipse", { x: 140, y: 20, size: 80 });
    expect(inkOf(h.elements[1]).look).toBe("marker");

    // until another is chosen
    UI.clickTool("freedraw");
    choose("pencil");
    UI.createElement("freedraw", { x: 20, y: 160, size: 60 });
    expect(inkOf(h.elements[2]).look).toBe("pencil");
    // what was drawn before is not changed by it
    expect(inkOf(h.elements[0]).look).toBe("marker");

    // Normal is what an element drawn with it is: it has no ink data at all
    UI.clickTool("line");
    choose("normal");
    UI.createElement("line", { x: 20, y: 260, size: 60 });
    expect(h.elements[3].customData?.ink).toBeUndefined();
  });

  it("AC-269 images and frames show no looks", async () => {
    const image = API.createElement({ type: "image", id: "img" });
    const frame = API.createElement({ type: "frame", id: "fr" });

    await mount([image, frame] as never);

    for (const element of [image, frame]) {
      act(() => {
        API.setSelectedElements([element] as never);
      });

      expect(screen.queryByTestId("ink-look-neon"), element.type).toBeNull();
      expect(screen.queryByTestId("ink-look-normal"), element.type).toBeNull();
    }

    // the look of a tool that draws nothing with ink is not offered either
    act(() => {
      API.setSelectedElements([]);
    });
    UI.clickTool("eraser");
    expect(screen.queryByTestId("ink-look-neon")).toBeNull();
  });
});
