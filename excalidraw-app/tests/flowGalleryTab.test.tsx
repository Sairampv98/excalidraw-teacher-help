/**
 * AC-264 - the Flow tab, the guide and custom presets offer the gallery
 * (D-232, D-233, D-231).
 *
 * The tab is used the way a teacher uses it: kinds picked, scripts typed,
 * buttons pressed, and the page read afterwards.
 */

import { expect } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  FLOW_CUSTOM_PRESETS_KEY,
  writeStoredCustomPresets,
} from "@excalidraw/excalidraw/scene/flowCustomPresets";
import { FLOW_PRESETS } from "@excalidraw/excalidraw/scene/flowPresets";
import {
  FLOW_GALLERY_IDS,
  FLOW_PRESET_IDS,
} from "@excalidraw/excalidraw/scene/flowScript";
import {
  act,
  fireEvent,
  render,
  within,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { FlowCustomPreset } from "@excalidraw/excalidraw/scene/flowCustomPresets";
import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { FlowTab } from "../sidebar/FlowTab";

const { h } = window;

const ONE_PAGE: ExcalidrawPage[] = [{ id: "page-1", name: "Page 1" }];

const CUSTOM: FlowCustomPreset = {
  id: "custom-staff",
  name: "Staff tree",
  description: "Who answers to whom.",
  example: "Head\n  Deputy\n  Bursar",
  layout: "hierarchy",
  colours: { fills: ["#ffe3e3"], outline: "#862e9c" },
  shape: "own",
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

const radios = (getByRole: (role: string, options?: object) => HTMLElement) =>
  within(getByRole("radiogroup", { name: "Kind of chart" })).queryAllByRole(
    "radio",
  );

const NAMES = [
  "Process",
  "Decision",
  "Step by step",
  "Cycle",
  "Tiers",
  "Integration",
  "Network",
  "List",
  "Grid",
  "Matrix",
  "Pyramid",
  "Funnel",
  "Timeline",
  "Target",
  "Venn",
  "Hierarchy",
];

describe("AC-264 the Flow tab, the guide and custom presets offer the gallery", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("AC-264 the tab lists the gallery", async () => {
    writeStoredCustomPresets([CUSTOM]);

    const { getByRole } = await renderStudio();
    const all = radios(getByRole);

    // the seven, then the nine, then the teacher's own
    expect(
      all.map((r) => r.querySelector(".flow-tab__preset-name")!.textContent),
    ).toEqual([...NAMES, "Staff tree"]);
    expect(FLOW_PRESETS.map((p) => p.id)).toEqual([
      ...FLOW_PRESET_IDS,
      ...FLOW_GALLERY_IDS,
    ]);

    // each has a description of its own
    for (const radio of all) {
      expect(
        radio.querySelector(".flow-tab__preset-description")!.textContent!
          .length,
      ).toBeGreaterThan(5);
    }
  });

  it("AC-264 every example builds", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    for (const preset of FLOW_PRESETS) {
      fireEvent.click(
        getByRole("radio", { name: new RegExp(`^${preset.name}`) }),
      );

      // the example is in the box, and it inserts
      expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
        preset.example,
      );

      const before = live().length;

      fireEvent.click(getByRole("button", { name: "Insert chart" }));

      expect(getByRole("status").textContent, preset.id).toMatch(
        new RegExp(`${preset.name.toLowerCase()} chart`),
      );
      expect(live().length, preset.id).toBeGreaterThan(before);
    }
  });

  it("AC-264 the arrows choice is in the tab", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    expect((getByLabelText("Arrows") as HTMLSelectElement).value).toBe("own");

    fireEvent.click(getByRole("radio", { name: /^Process/ }));
    fireEvent.change(getByLabelText("Arrows"), { target: { value: "none" } });

    // the counts say there are none
    expect(getByRole("radiogroup", { name: "Kind of chart" })).toBeTruthy();
    expect(
      (document.querySelector('[data-testid="flow-tab-counts"]') as HTMLElement)
        .textContent,
    ).toMatch(/0 arrows/);

    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(live().filter((el) => el.type === "arrow")).toHaveLength(0);
    expect(
      live().filter(
        (el) => el.type !== "text" && el.customData?.flow?.role === "node",
      ),
    ).toHaveLength(4);
  });

  it("AC-264 the guide teaches every layout", async () => {
    const { getByRole, getByTestId } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));

    const guide = getByTestId("flow-guide");

    for (const preset of FLOW_PRESETS) {
      const section = guide.querySelector(
        `[data-guide-preset="${preset.id}"]`,
      )!;

      expect(section, preset.id).toBeTruthy();
      expect(section.querySelectorAll("li").length, preset.id).toBeGreaterThan(
        0,
      );
      expect(section.querySelector("pre")!.textContent).toBe(preset.example);
    }

    // the rules that are new
    expect(
      guide.querySelector('[data-guide-preset="grid"]')!.textContent,
    ).toMatch(/#/);
    expect(
      guide.querySelector('[data-guide-preset="hierarchy"]')!.textContent,
    ).toMatch(/Indent/);
  });

  it("AC-264 a custom preset can use a gallery layout", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "New preset" }));

    // every layout is offered, the gallery's too
    const options = [
      ...(getByLabelText("Preset layout") as HTMLSelectElement).options,
    ].map((o) => o.value);

    for (const layout of FLOW_GALLERY_IDS) {
      expect(options).toContain(layout);
    }

    fireEvent.change(getByLabelText("Preset name"), {
      target: { value: "Staff tree" },
    });
    fireEvent.change(getByLabelText("Preset example"), {
      target: { value: CUSTOM.example },
    });
    fireEvent.change(getByLabelText("Preset layout"), {
      target: { value: "hierarchy" },
    });
    fireEvent.change(getByLabelText("Preset arrows"), {
      target: { value: "none" },
    });
    fireEvent.click(getByRole("button", { name: "Save preset" }));

    // it is kept with the layout and the arrows it was made with
    const kept = JSON.parse(localStorage.getItem(FLOW_CUSTOM_PRESETS_KEY)!);

    expect(kept[0]).toMatchObject({ layout: "hierarchy", arrows: "none" });

    // and it builds as that layout: a tree, with no connectors because it says none
    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    expect(
      live().filter(
        (el) => el.type !== "text" && el.customData?.flow?.role === "node",
      ),
    ).toHaveLength(3);
    expect(live().filter((el) => el.type === "arrow")).toHaveLength(0);
  });

  it("AC-264 choosing another kind keeps the words", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    fireEvent.click(getByRole("radio", { name: /^Process/ }));
    fireEvent.change(getByLabelText("Script"), {
      target: { value: "Warm up\nExplain\nPractise" },
    });

    // to a pyramid: the same words
    fireEvent.click(getByRole("radio", { name: /^Pyramid/ }));
    expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      "Warm up\nExplain\nPractise",
    );

    // to a grid: the words become the cells of a row
    fireEvent.click(getByRole("radio", { name: /^Grid/ }));
    expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      "Warm up | Explain | Practise",
    );

    // to a network from a process: the arrows it had
    fireEvent.click(getByRole("radio", { name: /^Process/ }));
    fireEvent.click(getByRole("radio", { name: /^Network/ }));
    expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      "Warm up -> Explain\nExplain -> Practise",
    );
  });
});
