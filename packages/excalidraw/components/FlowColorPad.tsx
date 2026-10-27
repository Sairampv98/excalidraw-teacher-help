import React, { useRef } from "react";

import { FLOW_ACCENT_COLOR, colorInputValue } from "../scene/flowLook";
import {
  FLOW_COLOR_PRESETS,
  FLOW_SWATCHES,
  presetColorsFor,
  presetIsChosen,
  swatchOf,
} from "../scene/flowPalette";

import "./FlowColorPad.scss";

import type { FlowPresetColors } from "../scene/flowPalette";

type FlowColorPadProps = {
  /** what the pad is for: it names the group and every swatch in it */
  label: string;
  /** the colour now; `null` is the default (the accent colour, D-189) */
  value: string | null;
  onChange: (color: string | null) => void;
};

/**
 * A pad of swatches to choose a colour from (D-207): the default, the
 * colours, black, white and grey, and a last swatch that opens the browser's own
 * picker for anything else. The current choice is ringed, and it is one radio
 * group: the arrow keys move from swatch to swatch and choose as they go.
 */
export const FlowColorPad = ({ label, value, onChange }: FlowColorPadProps) => {
  const groupRef = useRef<HTMLDivElement>(null);

  const current = swatchOf(value);
  // a colour that is none of the swatches is the custom one
  const isCustom = value !== null && !current;
  const anyChecked = value === null || !!current;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";

    if (!forward && !backward) {
      return;
    }

    const radios = [
      ...(groupRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="radio"]',
      ) ?? []),
    ];
    const at = radios.indexOf(document.activeElement as HTMLButtonElement);

    if (at < 0) {
      return;
    }

    event.preventDefault();

    const next =
      radios[(at + (forward ? 1 : -1) + radios.length) % radios.length];

    next.focus();
    next.click();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className="excalidraw__flow-swatches"
      onKeyDown={onKeyDown}
    >
      {FLOW_SWATCHES.map((swatch, i) => {
        const checked =
          swatch.color === null ? value === null : current?.id === swatch.id;

        // one stop for the tab key: the choice, or the first when none is
        const stop = checked || (i === 0 && !anyChecked);

        return (
          <button
            key={swatch.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${label}: ${swatch.name}`}
            title={swatch.name}
            tabIndex={stop ? 0 : -1}
            data-swatch={swatch.id}
            className={`excalidraw__flow-swatch${
              swatch.color === null ? " excalidraw__flow-swatch--default" : ""
            }`}
            style={swatch.color ? { backgroundColor: swatch.color } : undefined}
            onClick={() => onChange(swatch.color)}
          />
        );
      })}
      <label
        className="excalidraw__flow-swatch excalidraw__flow-swatch--custom"
        data-swatch="custom"
        data-checked={isCustom ? "" : undefined}
        title="Custom colour"
      >
        <input
          type="color"
          aria-label={`${label}: custom`}
          value={colorInputValue(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
};

type FlowColorPresetsProps = {
  look: FlowPresetColors;
  /** the page's background: it decides which variant of a preset is applied */
  background?: string | null;
  onPick: (colors: FlowPresetColors) => void;
};

/**
 * The colour presets (D-206): each is two dots - the highlight and what
 * travels - and one press sets both, in the variant that reads on this page.
 */
export const FlowColorPresets = ({
  look,
  background,
  onPick,
}: FlowColorPresetsProps) => (
  <div
    role="group"
    aria-label="Colour presets"
    className="excalidraw__flow-presets"
  >
    {FLOW_COLOR_PRESETS.map((preset) => {
      const colors = presetColorsFor(preset, background);

      return (
        <button
          key={preset.id}
          type="button"
          aria-pressed={presetIsChosen(preset, look, background)}
          aria-label={`Colour preset: ${preset.name}`}
          title={preset.name}
          data-preset={preset.id}
          className="excalidraw__flow-preset"
          onClick={() => onPick(colors)}
        >
          <span
            className="excalidraw__flow-preset-dot"
            style={{ backgroundColor: colors.nodeColor ?? FLOW_ACCENT_COLOR }}
          />
          <span
            className="excalidraw__flow-preset-dot"
            style={{ backgroundColor: colors.markColor ?? FLOW_ACCENT_COLOR }}
          />
        </button>
      );
    })}
  </div>
);
