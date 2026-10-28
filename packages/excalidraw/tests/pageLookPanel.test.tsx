/**
 * AC-274 - the Page and paper panel is in the main menu (D-243, D-244).
 *
 * The real editor, the real menu and the real panel: the page's own controls
 * are out of the properties panel, and what is chosen is read back from the
 * pages, from undo and from the ink of the next elements.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CaptureUpdateAction, NORMAL_INK } from "@excalidraw/element";

import { Excalidraw, MainMenu } from "../index";
import { getCurrentInk, setCurrentInk } from "../inkDefault";
import { PAPER_COLORS, PAPER_LOOKS, PAPER_TYPES } from "../scene/paper";

import { UI, Keyboard } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

const PAGES = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const mount = async () => {
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <MainMenu>
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.DefaultItems.PageLook />
      </MainMenu>
    </Excalidraw>,
  );

  act(() => {
    h.setState({ pages: PAGES, currentPageId: "page-1" });
  });
};

const openPanel = async () => {
  act(() => {
    h.setState({ openDialog: { name: "pageLook" } });
  });

  return screen.findByTestId("page-look-dialog");
};

describe("AC-274 the Page and paper panel is in the main menu", () => {
  beforeEach(() => {
    localStorage.clear();
    setCurrentInk(NORMAL_INK);
  });

  afterEach(() => {
    setCurrentInk(NORMAL_INK);
  });

  it("AC-274 the menu has an entry that opens the panel", async () => {
    await mount();

    fireEvent.click(screen.getByTestId("main-menu-trigger"));

    const entry = await screen.findByTestId("page-look-button");

    // beside the canvas background, which is the colour of the board
    expect(screen.getByTestId("canvas-background-label")).not.toBeNull();
    expect(entry.textContent).toContain("Page and paper");

    fireEvent.click(entry);

    expect(await screen.findByTestId("page-look-dialog")).not.toBeNull();
    expect(h.state.openDialog).toEqual({ name: "pageLook" });
  });

  it("AC-274 the page's own controls are not in the properties panel any more", async () => {
    await mount();

    UI.clickTool("rectangle");

    expect(screen.queryByText("Show the page's frame")).toBeNull();
    expect(screen.queryByTestId("page-size-preset")).toBeNull();

    await openPanel();

    expect(screen.getByText("Show the page's frame")).not.toBeNull();
    expect(screen.getByText("Show the page's number")).not.toBeNull();
    expect(screen.getByTestId("page-size-preset")).not.toBeNull();
    expect(screen.getByTestId("page-width")).not.toBeNull();
    expect(screen.getByTestId("page-height")).not.toBeNull();
  });

  it("AC-274 the panel offers every type colour and look", async () => {
    await mount();
    await openPanel();

    const types = [
      ...(screen.getByTestId("paper-type") as HTMLSelectElement).options,
    ].map((option) => option.value);

    expect(types).toEqual([...PAPER_TYPES]);

    // the canvas colour and the twelve named ones
    expect(screen.getByTestId("paper-colors").children).toHaveLength(
      PAPER_COLORS.length + 1,
    );
    expect(screen.getByTestId("paper-grain")).not.toBeNull();
    expect(screen.getByTestId("paper-age")).not.toBeNull();

    for (const look of PAPER_LOOKS) {
      expect(screen.getByTestId(`paper-look-${look.id}`)).not.toBeNull();
    }
  });

  it("AC-274 choosing a paper sets it on the page and undo takes it back", async () => {
    await mount();
    await openPanel();

    act(() => {
      h.app.updateScene({ captureUpdate: CaptureUpdateAction.NEVER });
    });

    fireEvent.change(screen.getByTestId("paper-type"), {
      target: { value: "cornell" },
    });
    fireEvent.click(screen.getByTestId("paper-color-cream"));
    fireEvent.change(screen.getByTestId("paper-grain"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByTestId("paper-age"), {
      target: { value: "60" },
    });

    expect(h.state.pages[0].paper).toEqual({
      type: "cornell",
      color: "cream",
      grain: 35,
      age: 60,
    });
    // the other page is as it was
    expect(h.state.pages[1].paper).toBeUndefined();

    act(() => {
      Keyboard.undo();
    });
    act(() => {
      Keyboard.undo();
    });
    act(() => {
      Keyboard.undo();
    });
    act(() => {
      Keyboard.undo();
    });

    expect(h.state.pages[0].paper?.type ?? "plain").toBe("plain");
  });

  it("AC-274 the paper can be used on every page", async () => {
    await mount();
    await openPanel();

    fireEvent.change(screen.getByTestId("paper-type"), {
      target: { value: "music" },
    });
    expect(h.state.pages[1].paper).toBeUndefined();

    fireEvent.click(screen.getByTestId("paper-apply-all"));

    expect(h.state.pages[1].paper?.type).toBe("music");
    expect(h.state.pages[1].paper).toEqual(h.state.pages[0].paper);
  });

  it("AC-274 a look sets the paper and the ink of what is drawn next", async () => {
    await mount();
    await openPanel();

    fireEvent.click(screen.getByTestId("paper-look-green-chalkboard"));

    expect(h.state.pages[0].paper).toEqual(
      PAPER_LOOKS.find((look) => look.id === "green-chalkboard")!.paper,
    );
    expect(getCurrentInk().look).toBe("chalk");
    expect(h.state.currentItemStrokeColor).toBe("#f5f5f0");

    fireEvent.click(screen.getByTestId("paper-look-neon-night"));

    expect(h.state.pages[0].paper?.color).toBe("midnight");
    expect(getCurrentInk().look).toBe("neon");
    expect(h.state.currentItemStrokeColor).toBe("#00f0ff");
  });
});
