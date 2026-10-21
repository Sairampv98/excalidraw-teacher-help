import { act, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { FONT_FAMILY } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";
import { actionPaste } from "@excalidraw/excalidraw/actions/actionClipboard";
import { createPasteEvent } from "@excalidraw/excalidraw/clipboard";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  armCodePasteOnCanvas,
  cancelCodePaste,
  handleCodePaste,
  pendingCodePaste,
} from "../sidebar/insertIntoScene";

const { h } = window;

const CODE = "def second_largest(nums):\n    return sorted(nums)[-2]";
const OTHER = "just some notes";

/**
 * The clipboard the library's own paste path reads.
 *
 * `read()` is what the context menu's Paste uses; `readText()` is the fallback
 * the library takes when `read()` is not allowed.
 */
const mockClipboard = (text: string) => {
  const clipboard = {
    read: vi.fn(async () => [
      {
        types: ["text/plain"],
        // jsdom's Blob has no `text()` yet, and this is all the library asks
        // of the item
        getType: async () => ({ text: async () => text } as unknown as Blob),
      },
    ]),
    readText: vi.fn(async () => text),
    writeText: vi.fn(async () => undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
};

/**
 * The real editor, with the app's `onPaste` hook wired in exactly the way the
 * app wires it — the hook is what decides whether a paste is the armed code.
 */
const renderEditor = async () => {
  let api: ExcalidrawImperativeAPI | null = null;

  const { container, unmount } = render(
    <Excalidraw
      autoFocus
      onPaste={handleCodePaste}
      onExcalidrawAPI={(next) => {
        api = next;
      }}
    />,
  );

  // the library only pastes when the pointer is over the canvas
  Object.assign(document, {
    elementFromPoint: () =>
      container.querySelector<HTMLCanvasElement>("canvas.interactive"),
  });

  await waitFor(() => expect(api).toBeTruthy());

  return { api: api!, container, unmount };
};

/** the scene, in the shape the assertions read */
const scene = () =>
  h.elements as unknown as Array<{
    type: string;
    text?: string;
    fontFamily?: number;
    backgroundColor?: string;
    groupIds: string[];
  }>;

/**
 * A code card is a dark card with the code on it, in one group. A plain paste
 * is text boxes: no card, and the text is not in the code font.
 */
const expectCodeCard = () => {
  const elements = scene();

  const card = elements.find((el) => el.type === "rectangle");

  expect(card).toBeTruthy();
  expect(card!.backgroundColor).toBe("#1e1e1e");

  const runs = elements.filter((el) => el.type === "text");

  expect(runs.length).toBeGreaterThan(1);

  for (const run of runs) {
    expect(run.fontFamily).toBe(FONT_FAMILY.Cascadia);
    expect(run.text!.length).toBeGreaterThan(0);
  }

  // every run belongs to one group, so the card moves as a unit
  expect(new Set(runs.map((run) => run.groupIds[0])).size).toBe(1);
};

afterEach(() => {
  cancelCodePaste();
});

describe("the armed code paste", () => {
  it("AC-23 a right-click paste keeps the code-card format", async () => {
    const { api } = await renderEditor();

    mockClipboard(CODE);

    armCodePasteOnCanvas(api, CODE, {
      fileName: "notes.py",
      language: "python",
    });

    // the context menu's Paste: it reads the clipboard and calls the library's
    // paste function directly, so no DOM paste event is ever fired — which is
    // exactly why a DOM listener never saw this paste
    await act(async () => {
      h.app.actionManager.executeAction(actionPaste);
    });

    await waitFor(() => expect(h.elements.length).toBeGreaterThan(0));

    expectCodeCard();

    // the armed paste was spent
    expect(pendingCodePaste()).toBeNull();
  });

  it("AC-23 the keyboard paste produces the same code card", async () => {
    const { api } = await renderEditor();

    mockClipboard(CODE);

    armCodePasteOnCanvas(api, CODE, {
      fileName: "notes.py",
      language: "python",
    });

    // the keyboard paste: the browser fires a DOM paste event
    document.dispatchEvent(createPasteEvent({ types: { "text/plain": CODE } }));

    await waitFor(() => expect(h.elements.length).toBeGreaterThan(0));

    expectCodeCard();
  });

  it("AC-24 a paste whose clipboard no longer holds the armed code is an ordinary paste", async () => {
    const { api } = await renderEditor();

    // the user copied something else in the meantime
    mockClipboard(OTHER);

    armCodePasteOnCanvas(api, CODE, {
      fileName: "notes.py",
      language: "python",
    });

    await act(async () => {
      h.app.actionManager.executeAction(actionPaste);
    });

    await waitFor(() => expect(h.elements.length).toBeGreaterThan(0));

    const elements = scene();

    // an ordinary paste: plain text, no card
    expect(elements.some((el) => el.type === "rectangle")).toBe(false);

    const texts = elements.filter((el) => el.type === "text");

    expect(texts.length).toBe(1);
    expect(texts[0].text).toBe(OTHER);
    expect(texts[0].fontFamily).not.toBe(FONT_FAMILY.Cascadia);

    // and the armed paste was not consumed: only a paste of the stashed code
    // spends it
    expect(pendingCodePaste()).toBeTruthy();
  });
});
