import React, { useEffect, useState } from "react";

import { isFlowColor } from "../../scene/flowLook";

/** "abc", "#abc", "aabbcc" or "#AABBCC" as "#aabbcc"; anything else is null */
export const parseHexCode = (text: string): string | null => {
  const hex = text.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex
      .split("")
      .map((digit) => digit + digit)
      .join("")}`.toLowerCase();
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return `#${hex}`.toLowerCase();
  }

  return null;
};

/**
 * A box to type the colour as a hex code, like the one of the editor's own
 * colour picker. A colour is set as soon as the code is a whole one; a code
 * that is not yet whole (or is not a colour) is kept in the box and marked, and
 * the colour stays as it was. An empty box is the default colour.
 */
export const FlowHexInput = ({
  label,
  value,
  onChange,
}: {
  /** names the box: "Shape hex code" */
  label: string;
  /** the colour now; `null` is the default */
  value: string | null;
  onChange: (color: string | null) => void;
}) => {
  const shown = value && isFlowColor(value) ? value.replace(/^#/, "") : "";
  const [text, setText] = useState(shown);

  // the colour changed elsewhere (a swatch, another part): the box follows it
  useEffect(() => {
    setText(shown);
  }, [shown, label]);

  const parsed = parseHexCode(text);
  const invalid = text.trim() !== "" && parsed === null;

  return (
    <label className="flow-hex-input">
      <span>Hex code</span>
      <span className="flow-hex-field" data-invalid={invalid ? "" : undefined}>
        <span aria-hidden="true">#</span>
        <input
          type="text"
          aria-label={label}
          aria-invalid={invalid}
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          placeholder="default"
          onChange={(event) => {
            const next = event.target.value;

            setText(next);

            if (next.trim() === "") {
              onChange(null);
              return;
            }

            const color = parseHexCode(next);

            if (color && color !== value) {
              onChange(color);
            }
          }}
          onBlur={() => setText(shown)}
          // typing a code must not reach the canvas's shortcuts
          onKeyDown={(event) => event.stopPropagation()}
        />
      </span>
    </label>
  );
};
