/**
 * AC-198 - the studio puts the chart on the current page (D-161, D-164).
 *
 * The chart is checked as the document sees it: which elements exist, which
 * page they are stamped to, what survives an undo.
 */

import fs from "node:fs";
import path from "node:path";

import { Excalidraw } from "@excalidraw/excalidraw";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";
import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { FlowTab } from "../sidebar/FlowTab";

const { h } = window;

const TWO_PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const renderStudio = async (currentPageId = "page-2") => {
  const result = await render(
    // undo is a key press, and the editor only hears one on the document
    // when it is asked to
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <FlowTab />
    </Excalidraw>,
  );

  act(() => {
    h.setState({ pages: TWO_PAGES, currentPageId });
  });

  return result;
};

const live = () => h.elements.filter((el) => !el.isDeleted);

const labels = () =>
  live()
    .filter((el): el is ExcalidrawTextElement => el.type === "text")
    .map((el) => el.originalText);

const setScript = (
  getByLabelText: (text: string) => HTMLElement,
  text: string,
) => fireEvent.change(getByLabelText("Script"), { target: { value: text } });

describe("the flow studio (AC-198)", () => {
  const fetched: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    fetched.length = 0;
    // the studio must not need the network: any request is recorded
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        throw new Error("no network in the studio");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-198 a preset inserts onto the current page", async () => {
    const { getByRole, getByText } = await renderStudio("page-2");

    // choosing a preset shows what it is
    fireEvent.click(getByRole("radio", { name: /Decision/ }));
    expect(
      getByText(
        "A question with a yes branch and a no branch that join up again.",
      ),
    ).toBeTruthy();
    expect(
      getByRole("radio", { name: /Decision/ }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(live().length).toBeGreaterThan(0);

    // every element of the chart is on the page the teacher is on - a chart
    // that landed on page 1 would be invisible on page 2
    expect(live().every((el) => el.pageId === "page-2")).toBe(true);

    // they are ordinary elements, and the shapes and arrows are selected
    expect(new Set(live().map((el) => el.type))).toEqual(
      new Set(["rectangle", "diamond", "text", "arrow"]),
    );
    expect(
      live()
        .filter((el) => el.type !== "text")
        .every((el) => h.state.selectedElementIds[el.id]),
    ).toBe(true);

    // and it says so
    expect(getByRole("status").textContent).toMatch(/decision chart/i);
  });

  it("AC-198 the script fills the chart", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.click(getByRole("radio", { name: /Process/ }));
    setScript(getByLabelText, "  First \n\nSecond\nThird ");
    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(labels()).toEqual(["First", "Second", "Third"]);
    expect(live().filter((el) => el.type === "arrow")).toHaveLength(2);

    // a different preset reads the same words differently: a tier chart has no arrows
    fireEvent.click(getByRole("radio", { name: /Tiers/ }));
    setScript(getByLabelText, "Web | Mobile\nAPI");
    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(labels()).toEqual([
      "First",
      "Second",
      "Third",
      "Web",
      "Mobile",
      "API",
    ]);
    expect(live().filter((el) => el.type === "arrow")).toHaveLength(2);

    // two charts on one page never share an id
    const ids = live().map((el) => el.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("AC-198 undo removes the whole chart", async () => {
    const { getByRole } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(live().length).toBeGreaterThan(4);

    // one undo takes back the shapes, the arrows and the labels together
    act(() => {
      Keyboard.undo();
    });

    expect(live()).toHaveLength(0);

    // and redo brings the same chart back
    act(() => {
      Keyboard.redo();
    });

    expect(live().length).toBeGreaterThan(4);
  });

  it("AC-198 an empty script adds nothing and says why", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    setScript(getByLabelText, "  \n \n");
    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(live()).toHaveLength(0);
    expect(getByRole("alert").textContent).toMatch(/nothing to build/i);

    // writing something clears the message
    setScript(getByLabelText, "One step");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("AC-198 nothing leaves the machine", async () => {
    const { getByRole } = await renderStudio();

    for (const name of [/Process/, /Tiers/, /Integration/, /Network/]) {
      fireEvent.click(getByRole("radio", { name }));
      fireEvent.click(getByRole("button", { name: "Insert chart" }));
    }

    expect(live().length).toBeGreaterThan(0);
    expect(fetched).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("wave 7r: the tab fits any window (AC-207)", () => {
  const stylesheet = fs.readFileSync(
    path.resolve(__dirname, "../sidebar/FlowTab.scss"),
    "utf8",
  );

  /** the declarations of one rule of the tab's stylesheet */
  const rule = (selector: string) => {
    const start = stylesheet.indexOf(`${selector} {`);

    expect(start).toBeGreaterThanOrEqual(0);

    return stylesheet.slice(start, stylesheet.indexOf("\n}", start) + 2);
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it("AC-207 the button is outside the scrolling body", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    const button = getByRole("button", { name: "Insert chart" });

    expect(button.closest(".flow-tab__body")).toBeNull();
    expect(button.closest(".flow-tab__footer")).not.toBeNull();

    // and what it says is with it, not inside what scrolls
    setScript(getByLabelText, "  ");
    fireEvent.click(button);

    expect(getByRole("alert").closest(".flow-tab__footer")).not.toBeNull();

    // the presets and the script are what scrolls
    expect(getByLabelText("Script").closest(".flow-tab__body")).not.toBeNull();
    expect(
      getByRole("radiogroup", { name: "Kind of chart" }).closest(
        ".flow-tab__body",
      ),
    ).not.toBeNull();
  });

  it("AC-207 the body scrolls and the footer does not", () => {
    const body = rule(".flow-tab__body");
    const footer = rule(".flow-tab__footer");

    expect(body).toMatch(/overflow-y: auto/);
    expect(body).toMatch(/flex: 1 1 auto/);
    expect(body).toMatch(/min-height: 0/);

    expect(footer).toMatch(/flex: 0 0 auto/);
    expect(footer).not.toMatch(/overflow/);
  });

  it("AC-207 the script has a minimum height and no maximum", () => {
    const script = rule(".flow-tab__script");

    expect(script).toMatch(/min-height: *[0-9.]+rem/);
    expect(script).not.toMatch(/max-height/);
  });

  it("AC-207 the button is clickable in a short window", async () => {
    // a short window: the whole editor is a few lines high
    const original = window.innerHeight;

    window.innerHeight = 240;
    window.dispatchEvent(new Event("resize"));

    try {
      const { getByRole } = await renderStudio();
      const button = getByRole("button", {
        name: "Insert chart",
      }) as HTMLButtonElement;

      expect(button.disabled).toBe(false);

      fireEvent.click(button);

      expect(live().length).toBeGreaterThan(0);
    } finally {
      window.innerHeight = original;
    }
  });
});
