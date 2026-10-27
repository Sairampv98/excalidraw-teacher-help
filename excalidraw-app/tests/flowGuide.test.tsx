/**
 * AC-251 - a script guide for every kind of chart (D-225), and the Flow tab's
 * other authoring controls: the shape and fit choices, the live check, the
 * custom presets and the button that opens the script editor (D-222, D-224,
 * D-226, D-228, D-229).
 *
 * The tab is used the way a teacher uses it: buttons pressed, the script typed,
 * and the page read afterwards.
 */

import { Excalidraw } from "@excalidraw/excalidraw";
import { closeFlowScriptEditor } from "@excalidraw/excalidraw/components/FlowScriptEditorState";
import {
  FLOW_CUSTOM_PRESETS_KEY,
  writeStoredCustomPresets,
} from "@excalidraw/excalidraw/scene/flowCustomPresets";
import { FLOW_PRESETS } from "@excalidraw/excalidraw/scene/flowPresets";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { FlowCustomPreset } from "@excalidraw/excalidraw/scene/flowCustomPresets";
import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { FlowTab } from "../sidebar/FlowTab";

const { h } = window;

const ONE_PAGE: ExcalidrawPage[] = [{ id: "page-1", name: "Page 1" }];

const FISH: FlowCustomPreset = {
  id: "custom-fish-bone",
  name: "Fish bone",
  description: "Causes on the left, the effect on the right.",
  example: "Cause one\nCause two\nCause three",
  layout: "left-right",
  colours: { fills: ["#ffe3e3", "#d3f9d8"], outline: "#862e9c" },
  shape: "ellipse",
};

const renderStudio = async () => {
  const result = await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <FlowTab />
    </Excalidraw>,
  );

  act(() => {
    h.setState({ pages: ONE_PAGE, currentPageId: "page-1" });
  });

  return result;
};

const live = () => h.elements.filter((el) => !el.isDeleted);

const nodes = () =>
  live().filter(
    (el) =>
      el.type !== "arrow" &&
      el.type !== "text" &&
      el.customData?.flow?.role === "node",
  );

const setScript = (
  getByLabelText: (text: string) => HTMLElement,
  text: string,
) => fireEvent.change(getByLabelText("Script"), { target: { value: text } });

describe("AC-251 a script guide for every kind of chart", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      closeFlowScriptEditor();
    });
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("AC-251 the guide lists every preset with an example", async () => {
    writeStoredCustomPresets([FISH]);

    const { getByRole, getByTestId, container } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));

    const guide = getByTestId("flow-guide");

    // the seven, then the teacher's own
    const sections = [...guide.querySelectorAll("[data-guide-preset]")];

    expect(sections.map((s) => s.getAttribute("data-guide-preset"))).toEqual([
      ...FLOW_PRESETS.map((p) => p.id),
      "custom-fish-bone",
    ]);

    for (const preset of FLOW_PRESETS) {
      const section = guide.querySelector(
        `[data-guide-preset="${preset.id}"]`,
      )!;

      // its rules in words, what it looks like, and the worked example
      expect(section.querySelectorAll("li").length).toBeGreaterThan(0);
      expect(section.querySelector("pre")!.textContent).toBe(preset.example);
    }

    // the network's rules teach the arrow
    expect(
      guide.querySelector('[data-guide-preset="network"]')!.textContent,
    ).toMatch(/A -> B/);

    // the teacher's own preset is there, with its words, and says it is theirs
    const own = guide.querySelector('[data-guide-preset="custom-fish-bone"]')!;

    expect(own.textContent).toMatch(/Fish bone \(yours\)/);
    expect(own.querySelector("pre")!.textContent).toBe(FISH.example);
    // the rules are those of the layout it was made with
    expect(own.querySelectorAll("li").length).toBeGreaterThan(0);

    // the one-line hint is still under the script box, back on the chart
    fireEvent.click(getByRole("button", { name: "Back to the chart" }));
    expect(container.querySelector(".flow-tab__hint")!.textContent).toMatch(
      /One line for each step/,
    );
  });

  it("AC-251 use this example fills the script", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));
    fireEvent.click(getByRole("button", { name: "Use this example: Network" }));

    // back on the chart, with that preset and its example in the box
    expect(
      getByRole("radio", { name: /Network/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      FLOW_PRESETS.find((p) => p.id === "network")!.example,
    );

    // and it is a script that was chosen, so choosing another preset keeps it
    fireEvent.click(getByRole("radio", { name: /Process/ }));
    expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      FLOW_PRESETS.find((p) => p.id === "network")!.example,
    );
  });

  it("AC-251 the guide teaches the shape marks and the fit modes", async () => {
    const { getByRole, getByTestId } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));

    const guide = getByTestId("flow-guide");
    const shapes = guide.querySelector('[data-guide-section="shapes"]')!;

    for (const mark of [
      "[Plan]",
      "(Teach)",
      "((Review))",
      "{Practise}",
      "<Check>",
    ]) {
      expect(shapes.textContent).toContain(mark);
    }

    for (const shape of [
      "rectangle",
      "rounded",
      "ellipse",
      "circle",
      "diamond",
    ]) {
      expect(shapes.textContent).toContain(shape);
    }

    const fit = guide.querySelector('[data-guide-section="fit"]')!;

    for (const mode of [
      "Fit to page",
      "Spread over pages",
      "Allow larger than page",
    ]) {
      expect(fit.textContent).toContain(mode);
    }
  });

  it("AC-251 the guide needs no network", async () => {
    const fetched: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        throw new Error("no network in the guide");
      }),
    );

    const { getByRole } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));
    fireEvent.click(getByRole("button", { name: "Use this example: Cycle" }));

    expect(fetched).toEqual([]);
  });
});

describe("the Flow tab's authoring controls (D-222, D-224, D-226, D-228, D-229)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      closeFlowScriptEditor();
    });
    localStorage.clear();
  });

  it("AC-255 the shape chosen in the tab is the shape of the chart", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.change(getByLabelText("Node shape"), {
      target: { value: "circle" },
    });
    setScript(getByLabelText, "[Plan]\nTeach\n<Review>");
    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    const kinds = nodes().map((n) =>
      n.type === "ellipse" && n.width === n.height ? "circle" : n.type,
    );

    // the chart's shape, and the marks that win over it
    expect(kinds).toEqual(["rectangle", "circle", "diamond"]);
  });

  it("AC-250 insert is off while a line cannot be read, and says why", async () => {
    const { getByRole, getByLabelText, getByRole: role } = await renderStudio();

    setScript(getByLabelText, "Plan\n[Teach\nReview");

    expect(
      (getByRole("button", { name: "Insert chart" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      role("list", { name: "Problems in the script" }).textContent,
    ).toMatch(/Line 2/);

    // the counts and the text size are shown
    setScript(getByLabelText, "Plan\nTeach\nReview");

    expect(
      (getByRole("button", { name: "Insert chart" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("AC-252 a chart that is spread makes the pages it needs", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.change(getByLabelText("Fit mode"), {
      target: { value: "spread" },
    });
    fireEvent.click(getByRole("radio", { name: /Process/ }));
    setScript(
      getByLabelText,
      Array.from(
        { length: 120 },
        (_, i) => `Step ${i + 1} of the long lesson plan`,
      ).join("\n"),
    );

    expect(h.state.pages).toHaveLength(1);

    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    await waitFor(() => {
      expect(h.state.pages.length).toBeGreaterThan(1);
    });

    // every node is on a page that exists, and the chart is on more than one
    const pageIds = new Set(h.state.pages.map((p) => p.id));
    const used = new Set(nodes().map((n) => n.pageId));

    expect(nodes()).toHaveLength(120);

    for (const id of used) {
      expect(pageIds.has(id)).toBe(true);
    }

    expect(used.size).toBeGreaterThan(1);
    expect(getByRole("status").textContent).toMatch(/pages/);
  });

  it("AC-254 a new preset is listed after the built-in seven and kept", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "New preset" }));
    fireEvent.change(getByLabelText("Preset name"), {
      target: { value: "Fish bone" },
    });
    fireEvent.change(getByLabelText("Preset example"), {
      target: { value: "Cause one\nCause two" },
    });
    fireEvent.change(getByLabelText("Preset layout"), {
      target: { value: "left-right" },
    });
    fireEvent.click(getByRole("button", { name: "Save preset" }));

    const radios = within(
      getByRole("radiogroup", { name: "Kind of chart" }),
    ).queryAllByRole("radio");

    expect(radios).toHaveLength(FLOW_PRESETS.length + 1);
    expect(radios[radios.length - 1].textContent).toMatch(/Fish bone/);
    expect(radios[radios.length - 1].getAttribute("aria-checked")).toBe("true");

    // it is kept in the browser's storage
    expect(
      JSON.parse(localStorage.getItem(FLOW_CUSTOM_PRESETS_KEY)!),
    ).toHaveLength(1);

    // a form that cannot make a preset says why and keeps the form
    fireEvent.click(getByRole("button", { name: "New preset" }));
    fireEvent.click(getByRole("button", { name: "Save preset" }));
    expect(getByRole("alert").textContent).toMatch(/no name/);
  });

  it("AC-248 the Flow tab's Edit script button opens the editor on the selected chart", async () => {
    const { getByRole, queryByRole, container } = await renderStudio();

    // nothing selected: it says what to do
    fireEvent.click(getByRole("button", { name: "Insert chart" }));
    act(() => {
      API.setSelectedElements([]);
    });
    fireEvent.click(container.querySelector(".flow-tab__edit") as HTMLElement);
    expect(getByRole("alert").textContent).toMatch(/Select a chart/);

    // a chart selected: the panel opens with its script
    act(() => {
      API.setSelectedElements([nodes()[0]]);
    });
    fireEvent.click(container.querySelector(".flow-tab__edit") as HTMLElement);

    expect(queryByRole("dialog", { name: "Edit script" })).not.toBeNull();
  });
});
