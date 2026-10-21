/**
 * The app side of "Reformat as..." — AC-26, AC-27 and AC-28.
 *
 * The library owns the *offer*: the context menu entry that appears on a
 * selection of text elements and hands the selection over (D-21). The app owns
 * everything behind it — the chooser and the two reformats (D-22, D-23) —
 * because a syntax-highlighted code card needs the app's own highlighter.
 *
 * The assertions go through the library's own helpers (`getCommonBounds` for
 * the selection's bounds) rather than re-deriving a formula here.
 */

import { vi } from "vitest";

import { FONT_FAMILY } from "@excalidraw/common";
import { getCommonBounds } from "@excalidraw/element";
import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { reformatSelection } from "../sidebar/reformat";

/** the context menu's entry for the reformat */
const REFORMAT_ENTRY = 'li[data-testid="reformatSelection"]';

const renderEditor = async (
  onReformatSelection?: (params: {
    selectedElements: readonly ExcalidrawElement[];
  }) => void,
) => {
  let api: ExcalidrawImperativeAPI | null = null;

  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      onReformatSelection={onReformatSelection}
      onExcalidrawAPI={(next) => {
        api = next;
      }}
    />,
  );

  await waitFor(() => expect(api).toBeTruthy());

  return api!;
};

/** the scene's live (not deleted) elements */
const liveElements = (api: ExcalidrawImperativeAPI) => api.getSceneElements();

describe("reformatting a selection", () => {
  it("AC-26 the context menu offers Reformat as... on a selection of text elements, and not otherwise", async () => {
    const onReformatSelection = vi.fn();

    await renderEditor(onReformatSelection);

    // a rectangle is selected: there is nothing to reformat
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 10,
      clientY: 10,
    });

    const canvasMenu = UI.queryContextMenu();

    expect(canvasMenu).not.toBeNull();
    expect(canvasMenu!.querySelector(REFORMAT_ENTRY)).toBeNull();

    // a text element is selected: the entry shows up
    const text = API.createElement({
      type: "text",
      text: "some code",
      x: 0,
      y: 0,
    });

    API.setElements([text]);
    API.setSelectedElements([text]);

    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 10,
      clientY: 10,
    });

    const elementMenu = UI.queryContextMenu();

    expect(elementMenu).not.toBeNull();

    const entry = elementMenu!.querySelector(REFORMAT_ENTRY);

    expect(entry).not.toBeNull();

    // and picking it hands the selection over to the app
    fireEvent.click(entry!);

    expect(onReformatSelection).toHaveBeenCalledTimes(1);
    expect(onReformatSelection.mock.calls[0][0].selectedElements).toEqual([
      text,
    ]);
  });

  it("AC-27 reformatting a selection as a code card replaces the selection with a code card at the selection's position", async () => {
    const api = await renderEditor();

    const code = "def second_largest(nums):\n    return sorted(nums)[-2]";

    const text = API.createElement({
      type: "text",
      text: code,
      x: 100,
      y: 200,
    });

    API.setElements([text]);
    API.setSelectedElements([text]);

    const [expectedX, expectedY] = getCommonBounds([text]);

    await act(async () => {
      await reformatSelection(api, [text], "codeCard");
    });

    const elements = liveElements(api);

    // the reformatted content replaces the selection
    expect(elements.find((element) => element.id === text.id)).toBeUndefined();

    // the card is the app's code card: a dark rectangle with the code on it
    const card = elements.find((element) => element.type === "rectangle");

    expect(card).toBeTruthy();
    expect(card!.backgroundColor).toBe("#1e1e1e");

    // and it sits where the selection was
    expect(card!.x).toBe(expectedX);
    expect(card!.y).toBe(expectedY);

    // the code is on the card, in the code font, as real text
    const runs = elements.filter((element) => element.type === "text");

    // the card came out highlighted: one run per line, not one blob of text
    expect(runs.length).toBe(2);

    for (const run of runs) {
      expect(run.fontFamily).toBe(FONT_FAMILY.Cascadia);
    }

    expect(runs.map((run) => run.text).join("\n")).toContain("second_largest");
  });

  it("AC-28 reformatting a selection as a table recovers the cells and draws a grid of selectable text cells", async () => {
    const api = await renderEditor();

    const lines = [
      "| Name | Age |",
      "| --- | --- |",
      "| Ada | 36 |",
      "| Alan | 41 |",
    ];

    const texts = lines.map((line, index) =>
      API.createElement({
        type: "text",
        text: line,
        x: 100,
        y: 200 + index * 30,
      }),
    );

    API.setElements(texts);
    API.setSelectedElements(texts);

    const [expectedX, expectedY] = getCommonBounds(texts);

    await act(async () => {
      await reformatSelection(api, texts, "table");
    });

    const elements = liveElements(api);

    // the reformatted content replaces the selection
    for (const text of texts) {
      expect(
        elements.find((element) => element.id === text.id),
      ).toBeUndefined();
    }

    const cells = elements.filter((element) => element.type === "text");

    // the separator row is not a row of the table: the header and the two
    // data rows are, and nothing else
    expect(cells.map((cell) => cell.text).sort()).toEqual([
      "36",
      "41",
      "Ada",
      "Age",
      "Alan",
      "Name",
    ]);

    // every cell is drawn
    const rectangles = elements.filter(
      (element) => element.type === "rectangle",
    );

    expect(rectangles.length).toBe(cells.length);

    // the cells are behind the text in the z-order
    const lastRectangle = elements
      .map((element) => element.type)
      .lastIndexOf("rectangle");
    const firstText = elements.findIndex((element) => element.type === "text");

    expect(lastRectangle).toBeLessThan(firstText);

    // the table starts where the selection was
    expect(Math.min(...cells.map((cell) => cell.x))).toBeGreaterThanOrEqual(
      expectedX,
    );
    expect(Math.min(...cells.map((cell) => cell.y))).toBeGreaterThanOrEqual(
      expectedY,
    );

    // the cells are laid out on a grid: two columns, three rows
    const columnXs = [...new Set(cells.map((cell) => cell.x))].sort(
      (a, b) => a - b,
    );
    const rowYs = [...new Set(cells.map((cell) => cell.y))].sort(
      (a, b) => a - b,
    );

    expect(columnXs.length).toBe(2);
    expect(rowYs.length).toBe(3);

    // and every cell is an ordinary, selectable text element
    for (const cell of cells) {
      expect(cell.locked).toBe(false);
      expect(cell.containerId).toBeNull();
      expect(api.getAppState().selectedElementIds[cell.id]).toBe(true);
    }
  });
});
