/**
 * The teacher's own presets (D-228).
 *
 * A custom preset is **data**: a name, a description, an example script, a
 * layout, a colour set and a node shape. No code is run, nothing is sent
 * anywhere, and the layout names one of the geometries the built-in seven use,
 * which also decides the rules of the script.
 *
 * The functions here are pure, but for the three that read and write the
 * browser's own storage, which never throw.
 */

import { FLOW_NODE_SHAPES } from "./flowScript";

import type {
  FlowPalette,
  BuildFlowOptions,
  FlowChartShape,
} from "./flowPresets";
import type { FlowPresetId } from "./flowScript";

/** the geometries a custom preset can be laid out in (D-228) */
export type FlowCustomLayout =
  | "top-down"
  | "left-right"
  | "ring"
  | "tiers"
  | "hub";

export const FLOW_CUSTOM_LAYOUTS: readonly FlowCustomLayout[] = [
  "top-down",
  "left-right",
  "ring",
  "tiers",
  "hub",
];

/** what each layout is built as, and so the script rules it follows (D-164) */
export const BUILT_IN_OF_LAYOUT: Record<FlowCustomLayout, FlowPresetId> = {
  "top-down": "process",
  "left-right": "process",
  ring: "cycle",
  tiers: "tiers",
  hub: "integration",
};

export type FlowCustomPreset = {
  /** `custom-` and a short name that is unique among the teacher's presets */
  id: string;
  name: string;
  description: string;
  /** the example script that fills the box when the preset is chosen */
  example: string;
  layout: FlowCustomLayout;
  /** the five fills of the built-in presets, and the colour of the outlines */
  colours: { fills: string[]; outline: string };
  /** the shape of the nodes that a script line does not mark (D-229) */
  shape: FlowChartShape;
};

/** the key the teacher's presets are kept under in the browser's storage */
export const FLOW_CUSTOM_PRESETS_KEY = "excalidraw-flow-custom-presets";

/** what a preset file says it is, so that another kind of file is refused */
export const FLOW_PRESET_FILE_KIND = "excalidraw-flow-presets";

const MAX_TEXT = 400;
const MAX_EXAMPLE = 4000;
const MAX_PRESETS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** a colour read defensively; anything that is not a hex colour is the fallback */
const colourOf = (value: unknown, fallback: string) =>
  typeof value === "string" && HEX.test(value.trim()) ? value.trim() : fallback;

const DEFAULT_FILLS = ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#d0bfff"];

/** the id a name gives, made unique among the ids already taken (D-228) */
export const uniquePresetId = (
  name: string,
  taken: ReadonlySet<string>,
): string => {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "preset";
  let id = `custom-${slug}`;

  for (let n = 2; taken.has(id); n++) {
    id = `custom-${slug}-${n}`;
  }

  return id;
};

/** the name a preset gets when one is already in use: "Name", "Name 2", ... */
export const uniquePresetName = (
  name: string,
  taken: ReadonlySet<string>,
): string => {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  let candidate = name.trim() || "My preset";

  for (let n = 2; lower.has(candidate.toLowerCase()); n++) {
    candidate = `${name.trim() || "My preset"} ${n}`;
  }

  return candidate;
};

export type ReadPreset =
  | { ok: true; preset: Omit<FlowCustomPreset, "id"> }
  | { ok: false; error: string };

/**
 * One preset read defensively from whatever was in a file or in storage
 * (D-188). A preset with no name or no example, or with a layout that does not
 * exist, is refused with the reason.
 */
export const readCustomPreset = (value: unknown): ReadPreset => {
  if (!isRecord(value)) {
    return { ok: false, error: "A preset must be an object with a name." };
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";

  if (!name) {
    return { ok: false, error: "A preset has no name." };
  }

  const example = typeof value.example === "string" ? value.example : "";

  if (!example.trim()) {
    return { ok: false, error: `The preset "${name}" has no example script.` };
  }

  if (!FLOW_CUSTOM_LAYOUTS.includes(value.layout as FlowCustomLayout)) {
    return {
      ok: false,
      error: `The preset "${name}" has a layout that does not exist: ${String(
        value.layout,
      )}. The layouts are ${FLOW_CUSTOM_LAYOUTS.join(", ")}.`,
    };
  }

  const colours = isRecord(value.colours) ? value.colours : {};
  const fills = Array.isArray(colours.fills)
    ? colours.fills.map((fill, i) =>
        colourOf(fill, DEFAULT_FILLS[i % DEFAULT_FILLS.length]),
      )
    : [];

  return {
    ok: true,
    preset: {
      name: name.slice(0, 80),
      description:
        typeof value.description === "string"
          ? value.description.slice(0, MAX_TEXT)
          : "",
      example: example.slice(0, MAX_EXAMPLE),
      layout: value.layout as FlowCustomLayout,
      colours: {
        fills: fills.length >= 1 ? fills.slice(0, 5) : [...DEFAULT_FILLS],
        outline: colourOf(colours.outline, "#1e1e1e"),
      },
      shape:
        value.shape === "own" ||
        FLOW_NODE_SHAPES.includes(
          value.shape as typeof FLOW_NODE_SHAPES[number],
        )
          ? (value.shape as FlowChartShape)
          : "own",
    },
  };
};

export type ImportedPresets =
  | { ok: true; presets: FlowCustomPreset[] }
  | { ok: false; error: string };

/**
 * The presets of a file, added to the ones the teacher has (D-228). A file that
 * is not JSON, is not a preset file, or has a preset that cannot be read is
 * **refused with the reason**, and nothing is added: it is all of the file or
 * none of it. A name already in use is made unique.
 */
export const importCustomPresets = (
  text: string,
  existing: readonly FlowCustomPreset[],
): ImportedPresets => {
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "That file is not a preset file: it is not JSON.",
    };
  }

  if (!isRecord(data) || data.kind !== FLOW_PRESET_FILE_KIND) {
    return {
      ok: false,
      error: "That file is not a preset file: it was not made by Export.",
    };
  }

  if (!Array.isArray(data.presets) || data.presets.length === 0) {
    return { ok: false, error: "That preset file has no presets in it." };
  }

  if (data.presets.length + existing.length > MAX_PRESETS) {
    return {
      ok: false,
      error: `There is room for ${MAX_PRESETS} presets, and that would make more.`,
    };
  }

  const names = new Set(existing.map((preset) => preset.name));
  const ids = new Set(existing.map((preset) => preset.id));
  const presets: FlowCustomPreset[] = [];

  for (const entry of data.presets) {
    const read = readCustomPreset(entry);

    if (!read.ok) {
      return { ok: false, error: read.error };
    }

    const name = uniquePresetName(read.preset.name, names);
    const id = uniquePresetId(name, ids);

    names.add(name);
    ids.add(id);
    presets.push({ ...read.preset, name, id });
  }

  return { ok: true, presets };
};

/** the presets as a file the teacher can keep and share */
export const exportCustomPresets = (
  presets: readonly FlowCustomPreset[],
): string =>
  JSON.stringify(
    {
      kind: FLOW_PRESET_FILE_KIND,
      version: 1,
      presets: presets.map(({ id, ...rest }) => rest),
    },
    null,
    2,
  );

/** a preset with the same words, a name of its own and an id of its own (D-228) */
export const duplicateCustomPreset = (
  preset: FlowCustomPreset,
  existing: readonly FlowCustomPreset[],
): FlowCustomPreset => {
  const name = uniquePresetName(
    `${preset.name} copy`,
    new Set(existing.map((p) => p.name)),
  );

  return {
    ...preset,
    colours: { ...preset.colours, fills: [...preset.colours.fills] },
    name,
    id: uniquePresetId(name, new Set(existing.map((p) => p.id))),
  };
};

/* ------------------------------------------------------------------ the storage */

/** the teacher's presets, read from the browser's storage; never throws */
export const readStoredCustomPresets = (): FlowCustomPreset[] => {
  try {
    const raw = window.localStorage.getItem(FLOW_CUSTOM_PRESETS_KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(data)) {
      return [];
    }

    const presets: FlowCustomPreset[] = [];
    const ids = new Set<string>();

    for (const entry of data) {
      const read = readCustomPreset(entry);

      if (!read.ok) {
        continue;
      }

      const id =
        isRecord(entry) &&
        typeof entry.id === "string" &&
        entry.id.startsWith("custom-")
          ? entry.id
          : uniquePresetId(read.preset.name, ids);

      if (ids.has(id)) {
        continue;
      }

      ids.add(id);
      presets.push({ ...read.preset, id });
    }

    return presets;
  } catch {
    // private windows and blocked storage: there are no presets, and that is fine
    return [];
  }
};

/** keeps the teacher's presets; the preset still works for this session if it cannot */
export const writeStoredCustomPresets = (
  presets: readonly FlowCustomPreset[],
): boolean => {
  try {
    window.localStorage.setItem(
      FLOW_CUSTOM_PRESETS_KEY,
      JSON.stringify(presets),
    );

    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------ building from one */

/** the built-in preset and the options a chart from this preset is built with */
export const buildSettingsOfCustom = (
  preset: FlowCustomPreset,
): {
  builtIn: FlowPresetId;
  options: Pick<BuildFlowOptions, "palette" | "direction" | "shape">;
} => {
  const palette: FlowPalette = {
    fills: preset.colours.fills,
    outline: preset.colours.outline,
  };

  return {
    builtIn: BUILT_IN_OF_LAYOUT[preset.layout],
    options: {
      palette,
      shape: preset.shape,
      ...(preset.layout === "top-down"
        ? { direction: "TB" as const }
        : preset.layout === "left-right"
        ? { direction: "LR" as const }
        : {}),
    },
  };
};
