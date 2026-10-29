import {
  ocrBridgeConnectedAtom,
  ocrEngineChoiceAtom,
  useAtom,
  useAtomValue,
} from "../app-jotai";
import { DEFAULT_PANEL_OCR_ENGINE, OCR_ENGINE_CHOICES } from "../ocr/engines";

import type { OcrEngineName } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * The engine that reads, chosen where a page is read (D-300).
 *
 * A panel has its own picker in its properties. Everywhere else a read is asked
 * for - the PDF toolbar, the question about the area, the crop - this is the
 * same choice: each engine with the speed that was measured for it, as a colour
 * and in milliseconds, and what an engine needs when it needs the bridge.
 */
export const OcrEnginePickerView = ({
  value,
  onChange,
  bridgeConnected,
}: {
  /** the engine chosen, or null when none was and the default is shown */
  value: OcrEngineName | null;
  onChange: (engine: OcrEngineName) => void;
  bridgeConnected: boolean;
}) => {
  const chosen = value ?? DEFAULT_PANEL_OCR_ENGINE;
  const engine =
    OCR_ENGINE_CHOICES.find((choice) => choice.id === chosen) ??
    OCR_ENGINE_CHOICES[0];

  return (
    <label
      className="app-ocr-engine"
      data-testid="ocr-engine-picker"
      title="The engine that reads the text"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <span
        aria-hidden="true"
        data-testid="ocr-engine-dot"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          flex: "0 0 auto",
          background: engine.color,
        }}
      />
      <select
        data-testid="ocr-engine-select"
        aria-label="Reading engine"
        value={chosen}
        onChange={(event) => onChange(event.target.value as OcrEngineName)}
      >
        {OCR_ENGINE_CHOICES.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {`${choice.label} - ${Math.round(choice.measuredMs)} ms${
              choice.id === "indra" && !bridgeConnected
                ? " (needs the bridge)"
                : ""
            }`}
          </option>
        ))}
      </select>
    </label>
  );
};

/** the picker that keeps the teacher's choice for every read of a page or a picture */
export const OcrEnginePicker = () => {
  const [choice, setChoice] = useAtom(ocrEngineChoiceAtom);
  const bridgeConnected = useAtomValue(ocrBridgeConnectedAtom);

  return (
    <OcrEnginePickerView
      value={choice}
      onChange={setChoice}
      bridgeConnected={bridgeConnected}
    />
  );
};
