import { useState } from "react";

import {
  FLOW_CUSTOM_LAYOUTS,
  readCustomPreset,
} from "@excalidraw/excalidraw/scene/flowCustomPresets";
import { FLOW_NODE_SHAPES } from "@excalidraw/excalidraw/scene/flowScript";

import type {
  FlowCustomLayout,
  FlowCustomPreset,
} from "@excalidraw/excalidraw/scene/flowCustomPresets";
import type { FlowChartShape } from "@excalidraw/excalidraw/scene/flowPresets";

const LAYOUT_LABELS: Record<FlowCustomLayout, string> = {
  "top-down": "Top-down (a line of steps)",
  "left-right": "Left to right (a line of steps)",
  ring: "Ring (a loop)",
  tiers: "Tiers (stacked layers)",
  hub: "Hub (one in the middle)",
};

const SHAPE_LABELS: Record<FlowChartShape, string> = {
  own: "Each kind's own",
  rectangle: "Rectangle",
  rounded: "Rounded",
  ellipse: "Ellipse",
  circle: "Circle",
  diamond: "Diamond",
};

const DEFAULT_FILLS = ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#d0bfff"];

type FlowPresetFormProps = {
  /** the preset being edited; none makes a new one */
  initial?: FlowCustomPreset;
  onSave: (preset: Omit<FlowCustomPreset, "id">) => void;
  onCancel: () => void;
};

/** a six-digit colour for a colour input, which wants one */
const sixDigits = (colour: string) =>
  /^#[0-9a-f]{3}$/i.test(colour)
    ? `#${colour
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")}`
    : colour;

/**
 * The form that makes a custom preset (D-228): a name, a description, an example
 * script, a layout, five fills and an outline colour, and a default shape. It
 * makes data and runs nothing.
 */
export const FlowPresetForm = ({
  initial,
  onSave,
  onCancel,
}: FlowPresetFormProps) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [example, setExample] = useState(initial?.example ?? "");
  const [layout, setLayout] = useState<FlowCustomLayout>(
    initial?.layout ?? "top-down",
  );
  const [fills, setFills] = useState<string[]>(
    Array.from({ length: 5 }, (_, i) =>
      sixDigits(initial?.colours.fills[i] ?? DEFAULT_FILLS[i]),
    ),
  );
  const [outline, setOutline] = useState(
    sixDigits(initial?.colours.outline ?? "#1e1e1e"),
  );
  const [shape, setShape] = useState<FlowChartShape>(initial?.shape ?? "own");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const read = readCustomPreset({
      name,
      description,
      example,
      layout,
      colours: { fills, outline },
      shape,
    });

    if (!read.ok) {
      setError(read.error);
      return;
    }

    onSave(read.preset);
  };

  return (
    <form
      className="flow-preset-form"
      aria-label={initial ? "Edit preset" : "New preset"}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      // the canvas has single-key shortcuts; typing in this form must not use them
      onKeyDown={(event) => event.stopPropagation()}
    >
      <label>
        Name
        <input
          aria-label="Preset name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Description
        <input
          aria-label="Preset description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        Example script
        <textarea
          aria-label="Preset example"
          rows={5}
          value={example}
          spellCheck={false}
          onChange={(event) => setExample(event.target.value)}
        />
      </label>
      <label>
        Layout
        <select
          aria-label="Preset layout"
          value={layout}
          onChange={(event) =>
            setLayout(event.target.value as FlowCustomLayout)
          }
        >
          {FLOW_CUSTOM_LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {LAYOUT_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Colours</legend>
        <div className="flow-preset-form__colours">
          {fills.map((fill, index) => (
            <input
              key={index}
              type="color"
              aria-label={`Fill ${index + 1}`}
              value={fill}
              onChange={(event) =>
                setFills(
                  fills.map((f, i) => (i === index ? event.target.value : f)),
                )
              }
            />
          ))}
          <input
            type="color"
            aria-label="Outline colour"
            value={outline}
            onChange={(event) => setOutline(event.target.value)}
          />
        </div>
      </fieldset>
      <label>
        Shape
        <select
          aria-label="Preset shape"
          value={shape}
          onChange={(event) => setShape(event.target.value as FlowChartShape)}
        >
          {(["own", ...FLOW_NODE_SHAPES] as FlowChartShape[]).map((s) => (
            <option key={s} value={s}>
              {SHAPE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="flow-tab__message" data-kind="error" role="alert">
          {error}
        </p>
      )}
      <div className="flow-preset-form__buttons">
        <button type="submit">Save preset</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};
