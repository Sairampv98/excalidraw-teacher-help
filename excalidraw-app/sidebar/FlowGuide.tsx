import { BUILT_IN_OF_LAYOUT } from "@excalidraw/excalidraw/scene/flowCustomPresets";

import type { FlowCustomPreset } from "@excalidraw/excalidraw/scene/flowCustomPresets";
import type { FlowPresetListing } from "@excalidraw/excalidraw/scene/flowPresets";
import type { FlowPresetId } from "@excalidraw/excalidraw/scene/flowScript";

import {
  FIT_MODE_GUIDE,
  FLOW_ANIMATED_EXAMPLE,
  FLOW_GUIDE,
  GUIDE_OF_LAYOUT,
  SHAPE_MARKS,
} from "./guideText";

type FlowGuideProps = {
  presets: readonly FlowPresetListing[];
  customs: readonly FlowCustomPreset[];
  /** puts a preset's example into the script box and goes back to the chart */
  onUse: (presetId: string, example: string) => void;
  /**
   * puts the animated example into the script box, sets the arrows' animation
   * the example is made to show, and goes back to the chart (D-380)
   */
  onUseAnimated: (example: typeof FLOW_ANIMATED_EXAMPLE) => void;
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
  onUseAnimated,
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

    <section
      className="flow-guide__animated"
      data-guide-section="animated"
      data-testid="flow-guide-animated"
    >
      <h4>{FLOW_ANIMATED_EXAMPLE.title}</h4>
      <p>
        A chart that moves: boxes that call a gateway, the gateway that calls
        the services, and dashes that run along every arrow. It is a network
        chart, so you can change any line and it still works.
      </p>
      <pre className="flow-guide__example">{FLOW_ANIMATED_EXAMPLE.script}</pre>
      <ol>
        {FLOW_ANIMATED_EXAMPLE.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button
        type="button"
        aria-label="Use this animated example"
        onClick={() => onUseAnimated(FLOW_ANIMATED_EXAMPLE)}
      >
        Use this animated example
      </button>
    </section>

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
            <code>{mark.example}</code> or <code>{mark.keyword}</code> is a{" "}
            {mark.shape}.
          </li>
        ))}
      </ul>
      <p>
        The marks go with the rest of the script: <code>? (Ready?)</code> is a
        question in a rounded box, and <code>[A] -&gt; {"{B}"}</code> joins a
        rectangle to a circle. The word after @ is the shape: rectangle,
        rounded, ellipse, circle or diamond. A box grows to hold its words. To
        change one box later, select it and use This node's shape in Edit
        script.
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
