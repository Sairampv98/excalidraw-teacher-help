/**
 * AC-254 - the teacher can define custom presets (D-228).
 *
 * The presets are data, so they are tested as data: made, kept in the browser's
 * storage, listed, exported and imported as a file, refused when the file is
 * wrong, and used to build a chart that opens without them.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { applyFlowScript } from "../scene/flowApply";
import { readChartRecord } from "../scene/flowChart";
import {
  FLOW_CUSTOM_PRESETS_KEY,
  FLOW_PRESET_FILE_KIND,
  buildSettingsOfCustom,
  duplicateCustomPreset,
  exportCustomPresets,
  importCustomPresets,
  readCustomPreset,
  readStoredCustomPresets,
  uniquePresetName,
  writeStoredCustomPresets,
} from "../scene/flowCustomPresets";
import {
  FLOW_PRESETS,
  buildFlowPreset,
  listFlowPresets,
} from "../scene/flowPresets";

import type { FlowCustomPreset } from "../scene/flowCustomPresets";

const FISH: FlowCustomPreset = {
  id: "custom-fish-bone",
  name: "Fish bone",
  description: "Causes on the left, the effect on the right.",
  example: "Cause one\nCause two\nCause three",
  layout: "left-right",
  colours: {
    fills: ["#ffe3e3", "#d3f9d8", "#fff3bf", "#e5dbff", "#c5f6fa"],
    outline: "#862e9c",
  },
  shape: "ellipse",
};

const LOOP: FlowCustomPreset = {
  id: "custom-class-loop",
  name: "Class loop",
  description: "A lesson that comes round again.",
  example: "Start\nTeach\nCheck",
  layout: "ring",
  colours: { fills: ["#a5d8ff"], outline: "#1e1e1e" },
  shape: "own",
};

beforeEach(() => {
  window.localStorage.removeItem(FLOW_CUSTOM_PRESETS_KEY);
});

afterEach(() => {
  window.localStorage.removeItem(FLOW_CUSTOM_PRESETS_KEY);
});

describe("AC-254 the teacher can define custom presets", () => {
  it("AC-254 a custom preset is kept and listed after the built-in seven", () => {
    expect(readStoredCustomPresets()).toEqual([]);

    expect(writeStoredCustomPresets([FISH, LOOP])).toBe(true);

    // kept under its own key, and read back as it was
    expect(window.localStorage.getItem(FLOW_CUSTOM_PRESETS_KEY)).not.toBeNull();
    expect(readStoredCustomPresets()).toEqual([FISH, LOOP]);

    // listed after the built-in seven
    const listed = listFlowPresets(readStoredCustomPresets());

    expect(listed).toHaveLength(FLOW_PRESETS.length + 2);
    expect(listed.slice(0, FLOW_PRESETS.length).map((p) => p.id)).toEqual(
      FLOW_PRESETS.map((p) => p.id),
    );
    expect(listed.slice(FLOW_PRESETS.length).map((p) => p.name)).toEqual([
      "Fish bone",
      "Class loop",
    ]);
    expect(listed.filter((p) => p.custom)).toHaveLength(2);

    // storage that cannot be read gives no presets, and does not throw
    window.localStorage.setItem(FLOW_CUSTOM_PRESETS_KEY, "{not json");
    expect(readStoredCustomPresets()).toEqual([]);
  });

  it("AC-254 it can be edited, duplicated and deleted", () => {
    const stored = [FISH, LOOP];

    // edited: the same preset with other words, kept under its own id
    const read = readCustomPreset({ ...FISH, name: "Fishbone chart" });

    expect(read.ok).toBe(true);

    const edited = stored.map((p) =>
      p.id === FISH.id && read.ok ? { ...read.preset, id: p.id } : p,
    );

    writeStoredCustomPresets(edited);
    expect(readStoredCustomPresets()[0]).toMatchObject({
      id: "custom-fish-bone",
      name: "Fishbone chart",
    });

    // duplicated: a name of its own and an id of its own, and the same words
    const copy = duplicateCustomPreset(FISH, stored);

    expect(copy.name).toBe("Fish bone copy");
    expect(copy.id).not.toBe(FISH.id);
    expect(copy.example).toBe(FISH.example);
    expect(duplicateCustomPreset(FISH, [...stored, copy]).name).toBe(
      "Fish bone copy 2",
    );
    // the colours are its own: changing the copy does not change the original
    copy.colours.fills[0] = "#000000";
    expect(FISH.colours.fills[0]).toBe("#ffe3e3");

    // deleted
    writeStoredCustomPresets(stored.filter((p) => p.id !== FISH.id));
    expect(readStoredCustomPresets().map((p) => p.id)).toEqual([LOOP.id]);
  });

  it("AC-254 it exports and imports as JSON", () => {
    const file = exportCustomPresets([FISH, LOOP]);
    const data = JSON.parse(file);

    // a small file that says what it is
    expect(data.kind).toBe(FLOW_PRESET_FILE_KIND);
    expect(data.presets).toHaveLength(2);
    expect(file.length).toBeLessThan(4000);

    const imported = importCustomPresets(file, []);

    expect(imported.ok).toBe(true);

    if (imported.ok) {
      expect(imported.presets.map((p) => ({ ...p, id: "" }))).toEqual(
        [FISH, LOOP].map((p) => ({ ...p, id: "" })),
      );
      expect(new Set(imported.presets.map((p) => p.id)).size).toBe(2);
    }

    // a file from another machine: what is not a colour is the default, and
    // what is unknown is left out
    const loose = importCustomPresets(
      JSON.stringify({
        kind: FLOW_PRESET_FILE_KIND,
        version: 1,
        presets: [
          {
            name: "Loose",
            example: "A\nB",
            layout: "tiers",
            colours: { fills: ["red", "#abc"], outline: "not a colour" },
            shape: "hexagon",
            script: "run this",
          },
        ],
      }),
      [],
    );

    expect(loose.ok).toBe(true);

    if (loose.ok) {
      expect(loose.presets[0].colours.fills).toEqual(["#a5d8ff", "#abc"]);
      expect(loose.presets[0].colours.outline).toBe("#1e1e1e");
      expect(loose.presets[0].shape).toBe("own");
      expect(loose.presets[0]).not.toHaveProperty("script");
    }
  });

  it("AC-254 a bad file is refused with the reason and changes nothing", () => {
    const existing = [FISH];

    const refused = (text: string) => {
      const result = importCustomPresets(text, existing);

      expect(result.ok).toBe(false);

      return result.ok ? "" : result.error;
    };
    const file = (presets: unknown) =>
      JSON.stringify({ kind: FLOW_PRESET_FILE_KIND, version: 1, presets });

    expect(refused("not json at all")).toMatch(/not JSON/);
    expect(refused(JSON.stringify({ some: "other file" }))).toMatch(
      /not a preset file/,
    );
    expect(refused(file([]))).toMatch(/no presets/);
    expect(refused(file([{ example: "A", layout: "ring" }]))).toMatch(
      /no name/,
    );
    expect(refused(file([{ name: "X", layout: "ring" }]))).toMatch(
      /no example/,
    );
    expect(
      refused(file([{ name: "X", example: "A", layout: "spiral" }])),
    ).toMatch(/layout that does not exist: spiral/);

    // all of the file or none of it: a good preset beside a bad one is not added
    expect(
      refused(
        file([
          { name: "Good", example: "A", layout: "ring" },
          { name: "Bad", example: "A", layout: "nope" },
        ]),
      ),
    ).toMatch(/Bad/);

    // and what the teacher has is as it was
    expect(existing).toEqual([FISH]);
    expect(readStoredCustomPresets()).toEqual([]);
  });

  it("AC-254 a name in use is made unique", () => {
    expect(uniquePresetName("Fish bone", new Set())).toBe("Fish bone");
    expect(uniquePresetName("Fish bone", new Set(["Fish bone"]))).toBe(
      "Fish bone 2",
    );
    expect(
      uniquePresetName("fish BONE", new Set(["Fish bone", "Fish bone 2"])),
    ).toBe("fish BONE 3");

    // the same file twice: the second time every name is taken
    const file = exportCustomPresets([FISH, LOOP]);
    const first = importCustomPresets(file, []);

    expect(first.ok).toBe(true);

    if (!first.ok) {
      return;
    }

    const second = importCustomPresets(file, first.presets);

    expect(second.ok).toBe(true);

    if (second.ok) {
      expect(second.presets.map((p) => p.name)).toEqual([
        "Fish bone 2",
        "Class loop 2",
      ]);

      const ids = [...first.presets, ...second.presets].map((p) => p.id);

      expect(new Set(ids).size).toBe(4);
    }
  });

  it("AC-254 a chart from it opens without it", () => {
    const { builtIn, options } = buildSettingsOfCustom(FISH);

    // its layout decides the rules of the script
    expect(builtIn).toBe("process");

    const built = buildFlowPreset(builtIn, FISH.example, {
      seed: 5,
      chartId: "chart-fish",
      custom: FISH,
      ...options,
    });

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }

    const shapes = built.elements.filter(
      (e) => e.type !== "arrow" && e.type !== "text",
    );

    // the colours and the shape are the preset's, and the layout runs left to right
    expect(shapes.every((s) => s.type === "ellipse")).toBe(true);
    expect(shapes.every((s) => s.strokeColor === "#862e9c")).toBe(true);
    expect(shapes[0].backgroundColor).toBe("#ffe3e3");
    expect(
      new Set(shapes.map((s) => Math.round(s.y + s.height / 2))).size,
    ).toBe(1);

    // the chart remembers the preset by name and by value
    const record = built.elements
      .map((e) => readChartRecord(e))
      .find((r) => r !== null)!;

    expect(record.preset).toBe("custom-fish-bone");
    expect(record.custom).toEqual(FISH);

    // the teacher's storage is empty - another machine - and the chart still
    // edits, from what it remembers
    expect(readStoredCustomPresets()).toEqual([]);

    const result = applyFlowScript({
      elements: built.elements,
      chartId: "chart-fish",
      preset: builtIn,
      script: `${FISH.example}\nCause four`,
      fit: "page",
      shape: record.shape,
      custom: record.custom,
      page: { x: 0, y: 0, width: 1920, height: 1080 },
      seed: 6,
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      const nodes = result.elements.filter(
        (e): e is ExcalidrawElement =>
          !e.isDeleted &&
          e.type !== "arrow" &&
          e.type !== "text" &&
          e.customData?.flow?.role === "node",
      );
      const labels = result.elements
        .filter(
          (e): e is ExcalidrawTextElement => e.type === "text" && !e.isDeleted,
        )
        .map((t) => t.originalText);

      expect(nodes).toHaveLength(4);
      expect(labels).toContain("Cause four");
      // in place: the first three are the shapes they were
      expect(result.rebuilt).toBe(false);
      expect(nodes.slice(0, 3).map((n) => n.id)).toEqual(
        shapes.map((s) => s.id),
      );
      // and the new one is in the preset's colours too
      expect(nodes[3].strokeColor).toBe("#862e9c");
    }
  });
});
