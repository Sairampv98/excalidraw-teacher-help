import React, { useState } from "react";

import {
  BUILT_IN_OF_LAYOUT,
  readCustomPreset,
  readStoredCustomPresets,
  uniquePresetId,
  uniquePresetName,
  writeStoredCustomPresets,
} from "../../scene/flowCustomPresets";

import type { FlowChartRecord } from "../../scene/flowChart";
import type { FlowCustomLayout } from "../../scene/flowCustomPresets";

export const FlowPresetSave = ({ record }: { record: FlowChartRecord }) => {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const existing = readStoredCustomPresets();
        const layout =
          record.custom?.layout ??
          (Object.keys(BUILT_IN_OF_LAYOUT) as FlowCustomLayout[]).find(
            (key) => BUILT_IN_OF_LAYOUT[key] === record.preset,
          ) ??
          "top-down";
        const result = readCustomPreset({
          name,
          description: "A chart template saved from the board",
          example: record.script,
          layout,
          colours: record.custom?.colours ?? {
            fills: ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#d0bfff"],
            outline: "#1e1e1e",
          },
          shape: record.shape,
          ...(record.arrows === "none" ? { arrows: "none" } : {}),
        });
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        const unique = uniquePresetName(
          result.preset.name,
          new Set(existing.map((preset) => preset.name)),
        );
        const id = uniquePresetId(
          unique,
          new Set(existing.map((preset) => preset.id)),
        );
        writeStoredCustomPresets([
          ...existing,
          { ...result.preset, id, name: unique },
        ]);
        window.dispatchEvent(new Event("flow-presets-changed"));
        setMessage(
          readStoredCustomPresets().some((preset) => preset.id === id)
            ? `Saved ${unique}. Open the Flow sidebar to insert or manage it.`
            : "This browser could not save the preset. Allow local storage and try again.",
        );
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p>
        Save the script, layout and default shape as a template. Hand-moved
        positions are not part of this template.
      </p>
      <label>
        Preset name
        <input
          aria-label="Preset name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button type="submit">Save as preset</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
};
