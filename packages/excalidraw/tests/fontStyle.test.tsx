/**
 * AC-360, AC-361, AC-362 - a part of a text can be bold and italic.
 *
 * The style is kept as runs over the text: characters `start` up to `end` are
 * bold, italic or both. Bold and italic are drawn by thickening and leaning the
 * letters, so no letter changes its width and nothing that measures a text has
 * to know about them. The runs follow the text while it is typed, are written in
 * the SVG, are saved with the drawing, and are set from the properties of the
 * text or from the keys - for what is selected in the editor, or for the whole
 * text.
 */

import React from "react";

import { KEYS } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  FAUX_BOLD_STROKE,
  FAUX_ITALIC_SKEW,
  adjustStyleRunsForEdit,
  drawStyledLine,
  getStyledLines,
  newTextElement,
  normalizeStyleRuns,
  rangeHasStyle,
  setStyleOnRange,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  TextStyleRun,
} from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";
import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { getTextEditor } from "./queries/dom";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

/** a text of the drawing, with the styled parts asked for */
const text = (
  content = "hello world",
  styleRuns?: readonly TextStyleRun[],
  x = 10,
) => newTextElement({ text: content, x, y: 10, fontSize: 20, styleRuns });

/** the text as the drawing has it now */
const nowOf = (element: ExcalidrawElement) =>
  h.elements.find((found) => found.id === element.id) as ExcalidrawTextElement;

const bold = (start: number, end: number): TextStyleRun => ({
  start,
  end,
  bold: true,
});

describe("AC-360 a part of a text can be bold and italic", () => {
  it("AC-360 the runs are cleaned: inside the text, in order, none empty, neighbours that are alike one", () => {
    expect(
      normalizeStyleRuns(
        [
          { start: -5, end: 3, bold: true },
          { start: 3, end: 6, bold: true },
          { start: 4, end: 9, italic: true },
          { start: 7, end: 7, bold: true },
          { start: 20, end: 30, bold: true },
          { start: Number.NaN, end: 2, bold: true },
        ],
        10,
      ),
    ).toEqual([
      { start: 0, end: 4, bold: true },
      { start: 4, end: 6, bold: true, italic: true },
      { start: 6, end: 9, italic: true },
    ]);

    expect(normalizeStyleRuns(undefined, 10)).toEqual([]);
    expect(normalizeStyleRuns([], 10)).toEqual([]);
  });

  it("AC-360 a style is set and taken off a part of a text, and asked for that part", () => {
    const runs = setStyleOnRange(undefined, 10, 2, 5, "bold", true);

    expect(runs).toEqual([bold(2, 5)]);
    expect(rangeHasStyle(runs, 10, 2, 5, "bold")).toBe(true);
    // one letter more is not all bold, and bold is not italic
    expect(rangeHasStyle(runs, 10, 1, 5, "bold")).toBe(false);
    expect(rangeHasStyle(runs, 10, 2, 5, "italic")).toBe(false);
    // nothing selected has nothing
    expect(rangeHasStyle(runs, 10, 3, 3, "bold")).toBe(false);

    // italic over part of it: the two meet
    const both = setStyleOnRange(runs, 10, 4, 8, "italic", true);

    expect(both).toEqual([
      bold(2, 4),
      { start: 4, end: 5, bold: true, italic: true },
      { start: 5, end: 8, italic: true },
    ]);

    // each is taken off on its own
    const italicOnly = setStyleOnRange(both, 10, 0, 10, "bold", false);

    expect(italicOnly).toEqual([{ start: 4, end: 8, italic: true }]);
    expect(setStyleOnRange(italicOnly, 10, 0, 10, "italic", false)).toEqual([]);
  });

  it("AC-360 the runs follow an edit: what is typed has the style before it, and what is deleted takes its own", () => {
    const runs = [bold(6, 11)];
    const edited = (to: string) =>
      adjustStyleRunsForEdit(runs, "hello world", to);

    // typed in the bold word, and at the end of it
    expect(edited("hello woXrld")).toEqual([bold(6, 12)]);
    expect(edited("hello worldX")).toEqual([bold(6, 12)]);
    // typed before it, and at the very start: plain, and the word moves
    expect(edited("hello Xworld")).toEqual([bold(7, 12)]);
    expect(edited("Xhello world")).toEqual([bold(7, 12)]);
    // deleted in it, and all of it
    expect(edited("hello wrld")).toEqual([bold(6, 10)]);
    expect(edited("hello ")).toEqual([]);
    // deleted before it
    expect(edited("ello world")).toEqual([bold(5, 10)]);
    // a part of it replaced by other letters
    expect(edited("hello wXXd")).toEqual([bold(6, 10)]);
    // a text with no runs has none
    expect(adjustStyleRunsForEdit(undefined, "a", "ab")).toEqual([]);
  });

  it("AC-360 the lines of a text are stretches of one style each, found in the original text", () => {
    // a plain text is not styled at all
    expect(getStyledLines({ text: "hello", originalText: "hello" })).toBeNull();
    expect(
      getStyledLines({ text: "hello", originalText: "hello", styleRuns: [] }),
    ).toBeNull();

    // wrapped at the space: the line break stands where the space was
    expect(
      getStyledLines({
        text: "hello\nworld foo",
        originalText: "hello world foo",
        styleRuns: [bold(6, 11)],
      }),
    ).toEqual([
      [{ text: "hello", bold: false, italic: false }],
      [
        { text: "world", bold: true, italic: false },
        { text: " foo", bold: false, italic: false },
      ],
    ]);

    // the same letters in both lines: each is found after the one before it
    expect(
      getStyledLines({
        text: "aa\naa",
        originalText: "aa aa",
        styleRuns: [bold(3, 5)],
      }),
    ).toEqual([
      [{ text: "aa", bold: false, italic: false }],
      [{ text: "aa", bold: true, italic: false }],
    ]);
  });

  /** a canvas that says what it was asked to draw */
  const recordingContext = () => {
    const calls: unknown[][] = [];
    const context = {
      fillStyle: "#000000",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "miter",
      textAlign: "left",
      measureText: (line: string) => ({ width: line.length * 10 }),
      save: () => calls.push(["save"]),
      restore: () => calls.push(["restore"]),
      translate: (x: number, y: number) => calls.push(["translate", x, y]),
      transform: (...matrix: number[]) => calls.push(["transform", ...matrix]),
      fillText: (line: string, x: number, y: number) =>
        calls.push(["fillText", line, x, y]),
      strokeText: (line: string, x: number, y: number) =>
        calls.push(["strokeText", line, x, y, context.lineWidth]),
    };

    return { calls, context: context as unknown as CanvasRenderingContext2D };
  };

  it("AC-360 a bold stretch is thickened, an italic one is leaned, and each stays where the plain line had it", () => {
    const { calls, context } = recordingContext();

    drawStyledLine(
      context,
      [
        { text: "plain ", bold: false, italic: false },
        { text: "bold", bold: true, italic: false },
        { text: " ", bold: false, italic: false },
        { text: "lean", bold: false, italic: true },
      ],
      30,
      5,
      "left",
      20,
    );

    const drawn = calls.filter(
      (call) => call[0] !== "save" && call[0] !== "restore",
    );

    expect(drawn).toEqual([
      ["fillText", "plain ", 5, 30],
      // "bold" starts where it does in the whole line: 6 letters of 10 pixels
      ["fillText", "bold", 65, 30],
      ["strokeText", "bold", 65, 30, 20 * FAUX_BOLD_STROKE],
      ["fillText", " ", 105, 30],
      // an italic stretch is drawn from its own corner, leaned
      ["translate", 115, 30],
      ["transform", 1, 0, -FAUX_ITALIC_SKEW, 1, 0, 0],
      ["fillText", "lean", 0, 0],
    ]);

    // the alignment of the line is as it was
    expect(context.textAlign).toBe("left");
  });

  it("AC-360 a line that is centred or at the right is placed by the width of the whole line", () => {
    const stretches = [
      { text: "ab", bold: false, italic: false },
      { text: "cd", bold: true, italic: false },
    ];

    const centred = recordingContext();

    drawStyledLine(centred.context, stretches, 0, 100, "center", 20);
    expect(centred.calls.filter((call) => call[0] === "fillText")).toEqual([
      ["fillText", "ab", 80, 0],
      ["fillText", "cd", 100, 0],
    ]);
    expect(centred.context.textAlign).toBe("center");

    const right = recordingContext();

    drawStyledLine(right.context, stretches, 0, 100, "right", 20);
    expect(right.calls.filter((call) => call[0] === "fillText")).toEqual([
      ["fillText", "ab", 60, 0],
      ["fillText", "cd", 80, 0],
    ]);
  });

  it("AC-360 a text with styled parts is made with them, and one without has no field", () => {
    const styled = text("hello world", [bold(6, 11), bold(0, 3), bold(3, 5)]);
    const plain = text("hello world");

    // cleaned, and in order
    expect(styled.styleRuns).toEqual([bold(0, 5), bold(6, 11)]);
    expect("styleRuns" in plain).toBe(false);
    // runs that cover nothing are not a style
    expect("styleRuns" in text("hello", [bold(3, 3)])).toBe(false);
  });

  it("AC-360 the parts are read back from a drawing, made to fit the text, and a plain text has no field", () => {
    const restored = restoreElements(
      [
        text("hello world", [bold(6, 11)]),
        // runs that reach past the text, as a hand-written file may have them
        { ...text("hello"), styleRuns: [bold(3, 99)] } as ExcalidrawTextElement,
        // runs that come to nothing
        { ...text("hello"), styleRuns: [bold(2, 2)] } as ExcalidrawTextElement,
        text("hello"),
      ],
      null,
    ) as ExcalidrawTextElement[];

    expect(restored[0].styleRuns).toEqual([bold(6, 11)]);
    expect(restored[1].styleRuns).toEqual([bold(3, 5)]);
    expect("styleRuns" in restored[2]).toBe(false);
    expect("styleRuns" in restored[3]).toBe(false);
  });

  it("AC-360 the parts are written in the SVG as stretches, and a plain text is written as it was", async () => {
    const svg = await exportToSvg(
      [
        text("hello world", [{ start: 0, end: 5, italic: true }, bold(6, 11)]),
        text("plain"),
      ],
      { exportBackground: false, viewBackgroundColor: "#ffffff" },
      null,
    );

    const [styled, plain] = Array.from(svg.querySelectorAll("text"));
    const stretches = Array.from(styled.querySelectorAll("tspan"));

    expect(stretches.map((stretch) => stretch.textContent)).toEqual([
      "hello",
      " ",
      "world",
    ]);

    // italic is a font style, bold a stroke of the colour of the text: no
    // letter gets wider
    expect(stretches[0].getAttribute("font-style")).toBe("italic");
    expect(stretches[0].getAttribute("stroke")).toBeNull();
    expect(stretches[1].getAttribute("font-style")).toBeNull();
    expect(stretches[1].getAttribute("stroke")).toBeNull();
    expect(stretches[2].getAttribute("stroke")).toBe(
      styled.getAttribute("fill"),
    );
    expect(stretches[2].getAttribute("stroke-width")).toBe(
      `${20 * FAUX_BOLD_STROKE}`,
    );

    expect(plain.querySelector("tspan")).toBeNull();
    expect(plain.textContent).toBe("plain");
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

  const lit = (style: "bold" | "italic") =>
    button(style).classList.contains("active");

  it("AC-361 the properties of a text have Bold and Italic, lit when the whole text has them", () => {
    const whole = text("hello", [bold(0, 5)]);

    select(text("hello"));

    expect(button("bold").title).toContain("Bold");
    expect(button("italic").title).toContain("Italic");
    expect(lit("bold")).toBe(false);
    expect(lit("italic")).toBe(false);

    select(whole);

    expect(lit("bold")).toBe(true);
    expect(lit("italic")).toBe(false);

    // a text that is only partly bold is not bold
    select(text("hello", [bold(0, 3)]));

    expect(lit("bold")).toBe(false);
  });

  it("AC-361 with a text selected, a button styles the whole text, and takes the style off when all of it has it", () => {
    const first = text("hello");
    const second = text("hello", [bold(0, 2)], 200);

    select(first, second);

    // one is part bold: not lit, and pressing it makes both bold
    fireEvent.click(button("bold"));

    expect(nowOf(first).styleRuns).toEqual([bold(0, 5)]);
    expect(nowOf(second).styleRuns).toEqual([bold(0, 5)]);
    expect(lit("bold")).toBe(true);

    // both are bold: pressing it takes it off both
    fireEvent.click(button("bold"));

    expect(nowOf(first).styleRuns ?? []).toEqual([]);
    expect(nowOf(second).styleRuns ?? []).toEqual([]);

    // italic is its own, and meets bold
    fireEvent.click(button("bold"));
    fireEvent.click(button("italic"));

    expect(nowOf(first).styleRuns).toEqual([
      { start: 0, end: 5, bold: true, italic: true },
    ]);
  });

  it("AC-361 a shape's own text takes the style when the shape is selected", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 200,
      height: 100,
    });
    const inside = newTextElement({
      text: "inside",
      x: 20,
      y: 20,
      containerId: rectangle.id,
    });

    API.setElements([
      { ...rectangle, boundElements: [{ type: "text", id: inside.id }] },
      inside,
    ]);
    API.setSelectedElements([rectangle]);

    fireEvent.click(button("bold"));

    expect(nowOf(inside).styleRuns).toEqual([bold(0, 6)]);
  });

  it("AC-361 Ctrl+B and Ctrl+I do the same, and only when there is a text", () => {
    const element = text("hello");

    select(element);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("b");
    });
    expect(nowOf(element).styleRuns).toEqual([bold(0, 5)]);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("i");
    });
    expect(nowOf(element).styleRuns).toEqual([
      { start: 0, end: 5, bold: true, italic: true },
    ]);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("b");
    });
    expect(nowOf(element).styleRuns).toEqual([
      { start: 0, end: 5, italic: true },
    ]);

    // with no text selected the key is not taken: the browser keeps it
    API.setSelectedElements([]);

    expect(fireEvent.keyDown(document, { key: "b", ctrlKey: true })).toBe(true);
  });

  it("AC-361 the style can be undone and done again", () => {
    const element = text("hello");

    // the drawing as it was is the one that is gone back to
    API.updateScene({
      elements: [element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    API.setSelectedElements([element]);

    fireEvent.click(button("bold"));
    expect(nowOf(element).styleRuns).toEqual([bold(0, 5)]);

    Keyboard.undo();
    expect(nowOf(element).styleRuns ?? []).toEqual([]);

    Keyboard.redo();
    expect(nowOf(element).styleRuns).toEqual([bold(0, 5)]);
  });
});

describe("AC-362 the style of a part of the text being typed", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  /** the editor of a text, opened */
  const openEditor = async (element: ExcalidrawTextElement) => {
    API.setElements([element]);
    API.setSelectedElements([element]);
    Keyboard.keyPress(KEYS.ENTER);

    return getTextEditor();
  };

  const press = (editor: HTMLTextAreaElement, key: string) =>
    fireEvent.keyDown(editor, { key, ctrlKey: true });

  const mirror = () =>
    document.querySelector<HTMLElement>(".excalidraw-wysiwyg-mirror");

  it("AC-362 Ctrl+B styles what is selected in the editor, and the rest of the text is left", async () => {
    const element = text("hello world");
    const editor = await openEditor(element);

    editor.setSelectionRange(6, 11);

    // the key is the editor's, and not the browser's
    expect(press(editor, "b")).toBe(false);
    expect(nowOf(element).styleRuns).toEqual([bold(6, 11)]);

    // taken off again: it was all bold
    press(editor, "b");
    expect(nowOf(element).styleRuns ?? []).toEqual([]);

    // italic, apart from bold
    press(editor, "i");
    press(editor, "b");
    expect(nowOf(element).styleRuns).toEqual([
      { start: 6, end: 11, bold: true, italic: true },
    ]);
  });

  it("AC-362 the editor shows the styled part under the textarea, and shows nothing extra for a plain text", async () => {
    const element = text("hello world");
    const editor = await openEditor(element);

    // a plain text has no styled copy to show
    expect(mirror()?.style.display ?? "none").toBe("none");
    expect(editor.style.color).not.toBe("transparent");

    editor.setSelectionRange(6, 11);
    press(editor, "b");

    const copy = mirror()!;
    const parts = Array.from(copy.querySelectorAll("span"));

    expect(copy.style.display).toBe("block");
    expect(parts.map((part) => part.textContent)).toEqual(["hello ", "world"]);
    expect(
      parts.map((part) =>
        part.classList.contains("excalidraw-wysiwyg-mirror__bold"),
      ),
    ).toEqual([false, true]);

    // the letters of the textarea are not shown twice; its caret is
    expect(editor.style.color).toBe("transparent");
    expect(editor.style.caretColor).not.toBe("");

    // the textarea is above its copy
    expect(
      copy.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // the style off, and the textarea shows its own letters again
    press(editor, "b");
    expect(mirror()!.style.display).toBe("none");
    expect(editor.style.color).not.toBe("transparent");
  });

  it("AC-362 with nothing selected the key styles the whole text", async () => {
    const element = text("hello world");
    const editor = await openEditor(element);

    editor.setSelectionRange(3, 3);
    press(editor, "b");

    expect(nowOf(element).styleRuns).toEqual([bold(0, 11)]);
  });

  it("AC-362 the properties style the part that is selected, and are lit for it", async () => {
    const element = text("hello world");
    const editor = await openEditor(element);

    editor.setSelectionRange(0, 5);
    fireEvent.click(screen.getByTestId("font-style-italic"));

    expect(nowOf(element).styleRuns).toEqual([
      { start: 0, end: 5, italic: true },
    ]);
    expect(
      screen.getByTestId("font-style-italic").classList.contains("active"),
    ).toBe(true);
    expect(
      screen.getByTestId("font-style-bold").classList.contains("active"),
    ).toBe(false);

    // another part is not italic: not lit for it
    // the selection moves, as it does with the mouse or the arrow keys
    editor.setSelectionRange(6, 11);
    fireEvent.select(editor);
    expect(
      screen.getByTestId("font-style-italic").classList.contains("active"),
    ).toBe(false);
  });

  it("AC-362 what is typed in a styled part is styled, and the parts follow what is deleted", async () => {
    const element = text("hello world", [bold(6, 11)]);
    const editor = await openEditor(element);

    // typed inside the bold word
    fireEvent.input(editor, { target: { value: "hello woXrld" } });
    expect(nowOf(element).styleRuns).toEqual([bold(6, 12)]);

    // typed before it
    fireEvent.input(editor, { target: { value: "hello Y woXrld" } });
    expect(nowOf(element).styleRuns).toEqual([bold(8, 14)]);

    // a part of the bold word deleted
    fireEvent.input(editor, { target: { value: "hello Y wrld" } });
    expect(nowOf(element).styleRuns).toEqual([bold(8, 12)]);

    // the styled copy is of the new text
    expect(
      Array.from(mirror()!.querySelectorAll("span")).map(
        (part) => part.textContent,
      ),
    ).toEqual(["hello Y ", "wrld"]);

    // and it is kept when the text is let go of
    act(() => {
      editor.blur();
    });

    expect(nowOf(element)).toMatchObject({
      originalText: "hello Y wrld",
      styleRuns: [bold(8, 12)],
    });
    expect(mirror()).toBeNull();
  });
});
