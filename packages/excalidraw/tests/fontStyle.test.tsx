/**
 * AC-360, AC-361 - a text can be bold and italic.
 *
 * The style is the whole text's, as its font and its size are: it is part of
 * the font string that measures and draws the text, it is saved with the
 * drawing and read back from it, it is written in the SVG, and it is set from
 * the properties of the text or from the keys.
 */

import React from "react";

import {
  FONT_FAMILY,
  KEYS,
  getFontFamilyString,
  getFontString,
} from "@excalidraw/common";
import { CaptureUpdateAction, newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";
import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";
import { getTextEditor } from "./queries/dom";

const { h } = window;

const mouse = new Pointer("mouse");

/** a text of the drawing, with the style asked for */
const text = (
  props: Partial<{ bold: boolean; italic: boolean; text: string }> & {
    x?: number;
  } = {},
) =>
  newTextElement({
    text: "hello",
    x: 10,
    y: 10,
    fontFamily: FONT_FAMILY.Helvetica,
    fontSize: 20,
    ...props,
  });

/** the texts as the drawing has them now */
const nowOf = (element: ExcalidrawElement) =>
  h.elements.find((found) => found.id === element.id) as ExcalidrawTextElement;

describe("AC-360 a text can be bold and italic", () => {
  it("AC-360 the font string carries the style, in the order a font has it", () => {
    const fontFamily = FONT_FAMILY.Helvetica;
    const family = getFontFamilyString({ fontFamily });

    // a text that is neither is as it always was
    expect(getFontString({ fontSize: 20, fontFamily })).toBe(`20px ${family}`);
    expect(getFontString({ fontSize: 20, fontFamily, bold: false })).toBe(
      `20px ${family}`,
    );

    expect(getFontString({ fontSize: 20, fontFamily, bold: true })).toBe(
      `bold 20px ${family}`,
    );
    expect(getFontString({ fontSize: 20, fontFamily, italic: true })).toBe(
      `italic 20px ${family}`,
    );
    // style, then weight, then size and family: the order of the CSS `font`
    expect(
      getFontString({ fontSize: 20, fontFamily, bold: true, italic: true }),
    ).toBe(`italic bold 20px ${family}`);

    // an element can be given as it is, which is how the text is measured
    expect(getFontString(text({ bold: true, italic: true }))).toBe(
      `italic bold 20px ${family}`,
    );
  });

  it("AC-360 a text that is not styled has no field for it", () => {
    const plain = text();
    const bold = text({ bold: true });
    const both = text({ bold: true, italic: true });

    // nothing is added to a drawing that never used the style
    expect("bold" in plain).toBe(false);
    expect("italic" in plain).toBe(false);

    expect(bold.bold).toBe(true);
    expect("italic" in bold).toBe(false);
    expect(both.bold).toBe(true);
    expect(both.italic).toBe(true);
  });

  it("AC-360 the style is saved with the drawing and read back from it", () => {
    const restored = restoreElements(
      [
        text({ bold: true }),
        text({ italic: true }),
        text({ bold: true, italic: true }),
        text(),
        // a style that was turned off is read back as it was written
        { ...text(), bold: false, italic: false } as ExcalidrawTextElement,
      ],
      null,
    ) as ExcalidrawTextElement[];

    expect(restored.map((element) => [element.bold, element.italic])).toEqual([
      [true, undefined],
      [undefined, true],
      [true, true],
      [undefined, undefined],
      [false, false],
    ]);

    // and a text that never had the style does not grow a field for it
    expect("bold" in restored[3]).toBe(false);
    expect("italic" in restored[3]).toBe(false);
  });

  it("AC-360 the style is written in the SVG, and only when there is one", async () => {
    const svg = await exportToSvg(
      [
        text({ bold: true }),
        text({ italic: true }),
        text({ bold: true, italic: true }),
        text(),
      ],
      { exportBackground: false, viewBackgroundColor: "#ffffff" },
      null,
    );

    const lines = Array.from(svg.querySelectorAll("text")).map((line) => [
      line.getAttribute("font-weight"),
      line.getAttribute("font-style"),
    ]);

    expect(lines).toEqual([
      ["bold", null],
      [null, "italic"],
      ["bold", "italic"],
      [null, null],
    ]);
  });
});

describe("AC-361 the buttons and the keys of the style", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  const select = (...elements: ExcalidrawElement[]) => {
    API.setElements(elements);
    API.setSelectedElements(elements);
  };

  const button = (style: "bold" | "italic") =>
    screen.getByTestId(`font-style-${style}`);

  it("AC-361 the properties of a text have Bold and Italic, lit when the text has them", () => {
    const plain = text();
    const bold = text({ bold: true });

    select(plain);

    expect(button("bold").title).toContain("Bold");
    expect(button("italic").title).toContain("Italic");
    expect(button("bold").classList.contains("active")).toBe(false);
    expect(button("italic").classList.contains("active")).toBe(false);

    select(bold);

    expect(button("bold").classList.contains("active")).toBe(true);
    expect(button("italic").classList.contains("active")).toBe(false);
  });

  it("AC-361 a button sets the style on the selected texts, and takes it off when they all have it", () => {
    const first = text();
    const second = text({ bold: true });

    select(first, second);

    // one of them has it: not lit, and pressing it sets it on both
    expect(button("bold").classList.contains("active")).toBe(false);
    fireEvent.click(button("bold"));

    expect(nowOf(first).bold).toBe(true);
    expect(nowOf(second).bold).toBe(true);
    expect(button("bold").classList.contains("active")).toBe(true);

    // both have it: pressing it takes it off both
    fireEvent.click(button("bold"));

    expect(nowOf(first).bold).toBe(false);
    expect(nowOf(second).bold).toBe(false);

    // italic is its own: it does not touch bold
    fireEvent.click(button("bold"));
    fireEvent.click(button("italic"));

    expect(nowOf(first)).toMatchObject({ bold: true, italic: true });
    expect(nowOf(second)).toMatchObject({ bold: true, italic: true });
  });

  it("AC-361 a shape's own text takes the style when the shape is selected", async () => {
    const rectangle = UI.createElement("rectangle", { x: 10, y: 10 });

    await UI.editText(rectangle, "inside");

    const inside = h.elements.find(
      (element) => element.type === "text",
    ) as ExcalidrawTextElement;

    API.setSelectedElements([rectangle]);

    expect(inside.containerId).toBe(rectangle.id);

    fireEvent.click(button("bold"));

    expect(nowOf(inside).bold).toBe(true);
  });

  it("AC-361 Ctrl+B and Ctrl+I do the same, and only when there is a text", () => {
    const element = text();

    select(element);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("b");
    });

    expect(nowOf(element).bold).toBe(true);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("i");
    });

    expect(nowOf(element)).toMatchObject({ bold: true, italic: true });

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("b");
    });

    expect(nowOf(element).bold).toBe(false);

    // with no text selected the key is not taken: the browser keeps it
    API.setSelectedElements([]);

    const kept = fireEvent.keyDown(document, { key: "b", ctrlKey: true });

    expect(kept).toBe(true);
  });

  it("AC-361 the style can be undone", () => {
    const element = text();

    // the drawing as it was is the one that is gone back to
    API.updateScene({
      elements: [element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    API.setSelectedElements([element]);
    fireEvent.click(button("bold"));
    expect(nowOf(element).bold).toBe(true);

    Keyboard.undo();
    expect(nowOf(element).bold).toBeFalsy();

    Keyboard.redo();
    expect(nowOf(element).bold).toBe(true);
  });

  it("AC-361 a text that is being typed takes the style from the keys", async () => {
    UI.clickTool("text");
    mouse.clickAt(100, 100);

    const editor = await getTextEditor();

    fireEvent.input(editor, { target: { value: "typed" } });

    const pressed = fireEvent.keyDown(editor, {
      key: "b",
      ctrlKey: true,
    });

    // the key is the editor's, and not the browser's
    expect(pressed).toBe(false);
    expect(editor.style.font).toContain("bold");

    fireEvent.keyDown(editor, { key: "i", ctrlKey: true });

    expect(editor.style.font).toContain("italic");

    act(() => {
      editor.blur();
    });

    const typed = h.elements.find(
      (element) => element.type === "text",
    ) as ExcalidrawTextElement;

    expect(typed).toMatchObject({ text: "typed", bold: true, italic: true });
  });
});

// keeps the import used when a test is skipped by the runner
void KEYS;
