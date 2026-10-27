import { BUILT_IN_OF_LAYOUT } from "@excalidraw/excalidraw/scene/flowCustomPresets";

import type { FlowCustomPreset } from "@excalidraw/excalidraw/scene/flowCustomPresets";
import type { FlowPresetListing } from "@excalidraw/excalidraw/scene/flowPresets";
import type { FlowPresetId } from "@excalidraw/excalidraw/scene/flowScript";

import {
  FIT_MODE_GUIDE,
  FLOW_GUIDE,
  GUIDE_OF_LAYOUT,
  SHAPE_MARKS,
} from "./guideText";

type FlowGuideProps = {
  presets: readonly FlowPresetListing[];
  customs: readonly FlowCustomPreset[];
  /** puts a preset's example into the script box and goes back to the chart */
  onUse: (presetId: string, example: string) => void;
  onBack: () => void;
};

/**
 * The guide (D-225): for every preset - the seven and the teacher's own - the
 * rules of its script in plain words, a worked example and a button that puts
 * the example into the script box. It also teaches the shape marks and the fit
 * modes. It needs no network: it is all in the code.
 */
export const FlowGuide = ({
  presets,
  customs,
  onUse,
  onBack,
}: FlowGuideProps) => (
  <div className="flow-guide" data-testid="flow-guide">
    <div className="flow-guide__header">
      <button type="button" className="flow-guide__back" onClick={onBack}>
        Back to the chart
      </button>
      <h3>Guide to scripts</h3>
    </div>

    <p className="flow-tab__intro">
      A script is the words of a chart: one line for each part. Pick a kind of
      chart below to see what its lines mean.
    </p>

    {presets.map((preset) => {
      const custom = customs.find((c) => c.id === preset.id);
      const rulesOf: FlowPresetId = custom
        ? GUIDE_OF_LAYOUT[custom.layout] ?? BUILT_IN_OF_LAYOUT[custom.layout]
        : (preset.id as FlowPresetId);
      const guide = FLOW_GUIDE[rulesOf];

      return (
        <section
          key={preset.id}
          className="flow-guide__preset"
          data-guide-preset={preset.id}
        >
          <h4>
            {preset.name}
            {custom ? " (yours)" : ""}
          </h4>
          <p>{preset.description}</p>
          <ul>
            {guide.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p>{guide.looks}</p>
          <pre className="flow-guide__example">{preset.example}</pre>
          <button
            type="button"
            aria-label={`Use this example: ${preset.name}`}
            onClick={() => onUse(preset.id, preset.example)}
          >
            Use this example
          </button>
        </section>
      );
    })}

    <section className="flow-guide__marks" data-guide-section="shapes">
      <h4>Shapes</h4>
      <p>
        Every box has the shape of the chart. To give one line a shape of its
        own, wrap it in a mark:
      </p>
      <ul>
        {SHAPE_MARKS.map((mark) => (
          <li key={mark.mark}>
            <code>{mark.example}</code> is a {mark.shape}.
          </li>
        ))}
      </ul>
      <p>
        The marks go with the rest of the script: <code>? (Ready?)</code> is a
        question in a rounded box, and <code>[A] -&gt; {"{B}"}</code> joins a
        rectangle to a circle. A box grows to hold its words.
      </p>
    </section>

    <section className="flow-guide__fit" data-guide-section="fit">
      <h4>When the chart is big</h4>
      <ul>
        {FIT_MODE_GUIDE.map((mode) => (
          <li key={mode.name}>
            <strong>{mode.name}.</strong> {mode.says}
          </li>
        ))}
      </ul>
    </section>
  </div>
);
