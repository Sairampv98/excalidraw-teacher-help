import { useCallback, useState } from "react";

import {
  CaptureUpdateAction,
  getPageRect,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { randomInteger } from "@excalidraw/common";
import {
  FLOW_PRESETS,
  buildFlowPreset,
} from "@excalidraw/excalidraw/scene/flowPresets";

import type { FlowPresetId } from "@excalidraw/excalidraw/scene/flowPresets";

import { appendElements, placementFor } from "./insertIntoScene";

import "./FlowTab.scss";

/** what a script line means for each preset, in a sentence (D-164) */
const SCRIPT_HINTS: Record<FlowPresetId, string> = {
  process: "One line for each step, in order.",
  decision:
    "One line for each step. A line that starts with ? is a question; the next two lines are its yes and no.",
  steps: "One line for each step. The steps are numbered for you.",
  cycle: "One line for each step. The last one leads back to the first.",
  tiers:
    "One line for each tier, top first. Separate the items in a tier with |.",
  integration:
    "The first line is the hub. Each line after it is something the hub connects to.",
  network:
    "One line for each node, or A -> B to join two. A node is made the first time its name appears.",
};

type Message = { kind: "error" | "ok"; text: string };

/**
 * The flow studio (D-161): presets for a chart that is made of ordinary shapes
 * and arrows, filled from a script of one line for each node.
 *
 * It does not draw anything itself: it asks `buildFlowPreset` for the elements
 * and puts them on the page the teacher is on, in one step that one undo takes
 * back.
 */
export const FlowTab = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [presetId, setPresetId] = useState<FlowPresetId>("process");
  const preset = FLOW_PRESETS.find((p) => p.id === presetId)!;

  const [script, setScript] = useState(preset.example);
  // a script the teacher has not touched follows the preset they pick
  const [edited, setEdited] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const choose = useCallback(
    (id: FlowPresetId) => {
      setPresetId(id);
      setMessage(null);

      if (!edited) {
        setScript(FLOW_PRESETS.find((p) => p.id === id)!.example);
      }
    },
    [edited],
  );

  const insert = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }

    const { pages, currentPageId } = excalidrawAPI.getAppState();
    const page = getPageRect(pages, currentPageId);

    const result = buildFlowPreset(presetId, script, {
      page,
      // the middle of what the teacher can see, kept on the page by the builder
      center: placementFor(excalidrawAPI, { width: 0, height: 0 }),
      pageId: currentPageId,
      // a second chart on the same page must not reuse the first one's ids
      seed: randomInteger(),
    });

    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }

    appendElements(
      excalidrawAPI,
      result.elements,
      {
        // the shapes and arrows: their labels come with them
        selectedElementIds: Object.fromEntries(
          result.elements
            .filter((el) => el.type !== "text")
            .map((el) => [el.id, true as const]),
        ),
      },
      currentPageId,
      CaptureUpdateAction.IMMEDIATELY,
    );

    setMessage({
      kind: "ok",
      text: `Added a ${preset.name.toLowerCase()} chart to this page.`,
    });
  }, [excalidrawAPI, presetId, script, preset.name]);

  return (
    <div className="flow-tab">
      {/*
        The body scrolls and the footer does not (D-176): the Insert button is
        always in reach, whatever the height of the window.
      */}
      <div className="flow-tab__body">
        <p className="flow-tab__intro">
          Pick a kind of chart, write one line for each part of it, and add it
          to this page. It is made of ordinary shapes and arrows, so you can
          change it afterwards.
        </p>

        <div
          className="flow-tab__presets"
          role="radiogroup"
          aria-label="Kind of chart"
        >
          {FLOW_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === presetId}
              className="flow-tab__preset"
              onClick={() => choose(p.id)}
            >
              <span className="flow-tab__preset-name">{p.name}</span>
              <span className="flow-tab__preset-description">
                {p.description}
              </span>
            </button>
          ))}
        </div>

        <label className="flow-tab__label" htmlFor="flow-tab-script">
          Script
        </label>
        <textarea
          id="flow-tab-script"
          className="flow-tab__script"
          rows={8}
          value={script}
          spellCheck={false}
          onChange={(event) => {
            setScript(event.target.value);
            setEdited(true);
            setMessage(null);
          }}
          // the canvas has single-key shortcuts; typing a script must not use them
          onKeyDown={(event) => event.stopPropagation()}
        />
        <p className="flow-tab__hint">{SCRIPT_HINTS[presetId]}</p>
      </div>

      <div className="flow-tab__footer">
        <button type="button" className="flow-tab__insert" onClick={insert}>
          Insert chart
        </button>

        {message && (
          <p
            className="flow-tab__message"
            data-kind={message.kind}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
};
