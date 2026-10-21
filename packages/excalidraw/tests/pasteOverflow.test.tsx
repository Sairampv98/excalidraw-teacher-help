/**
 * The paste that does not fit (D-24, D-25, D-26).
 *
 * The fork's page model clamps the camera to the page's rect, so content that
 * lies outside the page is in the document but unreachable — the owner put it
 * exactly like this: "whenever I paste a long content it goes beyond the page
 * and is not visible or accessible anymore".
 *
 * The paste now *offers* the user what to do with the text that does not fit
 * (D-24), the fit is decided per line (D-25), and the text that is left over
 * goes back to the clipboard (D-26).
 *
 * The assertions go through the library's own page layout (`getPageRect`) and
 * its own bounding box (`getCommonBounds`), never through a re-derivation of
 * the page arithmetic, so a self-consistent-but-wrong implementation cannot
 * pass.
 */

import React from "react";
import { vi } from "vitest";

import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { createPasteEvent } from "../clipboard";
import { Excalidraw } from "../index";
import { getPageRect } from "../scene/pages";

import { render, fireEvent, act, waitFor, GlobalTestState } from "./test-utils";
import { Pointer } from "./helpers/ui";

const { h } = window;

const mouse = new Pointer("mouse");

/** tolerance for float drift, in scene units */
const EPS = 0.001;

/** far more lines than a page can hold */
const LINE_COUNT = 120;

const longText = () =>
  Array.from({ length: LINE_COUNT }, (_, index) => `line ${index + 1}`).join(
    "\n",
  );

const mockClipboard = () => {
  const clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
};

/** the text of the paste, as text elements */
const pastedText = () =>
  h.elements.filter(
    (element) => element.type === "text" && !element.isDeleted,
  ) as ExcalidrawElement[];

/** whether the element lies entirely inside the rect of the page it is on */
const isInsideItsPage = (element: ExcalidrawElement) => {
  const rect = getPageRect(h.state.pages, element.pageId);
  const [minX, minY, maxX, maxY] = getCommonBounds([element]);

  return (
    minX >= rect.x - EPS &&
    minY >= rect.y - EPS &&
    maxX <= rect.x + rect.width + EPS &&
    maxY <= rect.y + rect.height + EPS
  );
};

/** pastes `text` the way the browser does */
const paste = (text: string) => {
  document.dispatchEvent(createPasteEvent({ types: { "text/plain": text } }));
};

/**
 * Renders the editor with the pages system on and puts the cursor in the
 * middle of the canvas, so the paste lands on the page.
 */
const setup = async () => {
  localStorage.clear();
  mouse.reset();

  const clipboard = mockClipboard();

  const renderResult = await render(
    <Excalidraw pagesEnabled={true} autoFocus={true} />,
  );

  h.state.width = 1000;
  h.state.height = 1000;

  // jsdom has no layout, so `elementFromPoint` cannot resolve the canvas on
  // its own — the paste handler needs it to know the paste targets the canvas
  Object.assign(document, {
    elementFromPoint: () => GlobalTestState.canvas,
  });

  mouse.moveTo(500, 500);

  return { renderResult, clipboard };
};

/** waits for the offer to be on screen */
const waitForTheOffer = async (
  renderResult: Awaited<ReturnType<typeof render>>,
) => {
  await waitFor(() => {
    expect(
      renderResult.baseElement.querySelector(".PasteOverflowDialog"),
    ).not.toBeNull();
  });
};

/** clicks one of the offer's answers */
const answer = async (
  renderResult: Awaited<ReturnType<typeof render>>,
  label: string,
) => {
  const button = renderResult.baseElement.querySelector<HTMLButtonElement>(
    `.PasteOverflowDialog button[aria-label="${label}"]`,
  );

  expect(button).not.toBeNull();

  await act(async () => {
    fireEvent.click(button!);
  });
};

describe("the paste that does not fit", () => {
  it("AC-29 a paste that fits the page is inserted as it is today, with no offer", async () => {
    const { renderResult } = await setup();

    paste("hello\nworld");

    await waitFor(() => {
      expect(pastedText().length).toBe(2);
    });

    // no offer: the paste fitted
    expect(
      renderResult.baseElement.querySelector(".PasteOverflowDialog"),
    ).toBeNull();

    // and the text is inside the page, so the camera can reach it
    for (const element of pastedText()) {
      expect(isInsideItsPage(element)).toBe(true);
    }
  });

  it("AC-30 a paste that does not fit raises the offer", async () => {
    const { renderResult } = await setup();

    paste(longText());

    await waitForTheOffer(renderResult);

    // the offer says how much of the text fits on the page
    const description = renderResult.baseElement.querySelector(
      ".PasteOverflowDialog__description",
    )!.textContent!;

    const fitting = Number(description.match(/(\d+)/)![1]);

    expect(fitting).toBeGreaterThan(0);
    expect(fitting).toBeLessThan(LINE_COUNT);
  });

  it("AC-30 the discard answer places only the text that fits", async () => {
    const { renderResult } = await setup();

    paste(longText());

    await waitForTheOffer(renderResult);

    await answer(renderResult, "Discard remaining text");

    await waitFor(() => {
      expect(pastedText().length).toBeGreaterThan(0);
    });

    // only the part that fits the page was placed
    expect(pastedText().length).toBeLessThan(LINE_COUNT);

    for (const element of pastedText()) {
      expect(isInsideItsPage(element)).toBe(true);
    }
  });

  it("AC-30 the all-on-this-page answer places everything and grows the page", async () => {
    const { renderResult } = await setup();

    const pageBefore = getPageRect(h.state.pages, h.state.currentPageId);

    paste(longText());

    await waitForTheOffer(renderResult);

    await answer(renderResult, "Place all text on this page");

    await waitFor(() => {
      expect(pastedText().length).toBe(LINE_COUNT);
    });

    // the page grew to contain the text
    const pageAfter = getPageRect(h.state.pages, h.state.currentPageId);

    expect(pageAfter.height).toBeGreaterThan(pageBefore.height);

    // and it contains every line of the paste
    for (const element of pastedText()) {
      expect(isInsideItsPage(element)).toBe(true);
    }
  });

  it("AC-30 the multiple-pages answer splits the text across pages", async () => {
    const { renderResult } = await setup();

    paste(longText());

    await waitForTheOffer(renderResult);

    await answer(renderResult, "Place text on multiple pages");

    await waitFor(() => {
      expect(pastedText().length).toBe(LINE_COUNT);
    });

    // the document has more than one page now
    expect(h.state.pages.length).toBeGreaterThan(1);

    // and every line lies entirely inside the page it is on — the library's
    // own page layout, and its own bounding box
    for (const element of pastedText()) {
      expect(isInsideItsPage(element)).toBe(true);
    }

    // the lines are spread over more than one page
    const pageIds = new Set(pastedText().map((element) => element.pageId));

    expect(pageIds.size).toBeGreaterThan(1);
  });

  it("AC-31 the text that did not fit is on the clipboard", async () => {
    const { renderResult, clipboard } = await setup();

    const text = longText();

    paste(text);

    await waitForTheOffer(renderResult);

    await answer(renderResult, "Discard remaining text");

    await waitFor(() => {
      expect(pastedText().length).toBeGreaterThan(0);
    });

    // the text that was not placed is on the clipboard, so the user can paste
    // it somewhere else
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    const leftover = clipboard.writeText.mock.calls[0][0] as string;

    // the leftover is exactly the text that was not placed
    const placed = pastedText().length;
    const lines = text.split("\n");

    expect(leftover).toBe(lines.slice(placed).join("\n"));
    expect(leftover.length).toBeGreaterThan(0);
  });
});
