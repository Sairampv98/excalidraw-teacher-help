import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  getPageRect,
  reconcileElements,
  translateContentForPageLayout,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { randomId, randomInteger } from "@excalidraw/common";
import { updateFlowAnimationSettings } from "@excalidraw/excalidraw/components/FlowAnimationState";
import { FlowPreview } from "@excalidraw/excalidraw/components/FlowPreview";
import { openFlowScriptEditor } from "@excalidraw/excalidraw/components/FlowScriptEditorState";
import { checkFlowScript } from "@excalidraw/excalidraw/scene/flowCheck";
import { convertScript } from "@excalidraw/excalidraw/scene/flowConvert";
import { FLOW_FIT_MODES } from "@excalidraw/excalidraw/scene/flowChart";
import {
  BUILT_IN_OF_LAYOUT,
  buildSettingsOfCustom,
  duplicateCustomPreset,
  exportCustomPresets,
  importCustomPresets,
  readStoredCustomPresets,
  uniquePresetId,
  uniquePresetName,
  writeStoredCustomPresets,
} from "@excalidraw/excalidraw/scene/flowCustomPresets";
import {
  flowPagesOf,
  planChartPages,
} from "@excalidraw/excalidraw/scene/flowPagesFor";
import {
  buildFlowPreset,
  listFlowPresets,
} from "@excalidraw/excalidraw/scene/flowPresets";
import { FLOW_NODE_SHAPES } from "@excalidraw/excalidraw/scene/flowScript";
import { flowKindPreview } from "@excalidraw/excalidraw/scene/flowPreview";
import { getPageIndex } from "@excalidraw/excalidraw/scene/pages";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { FlowFitMode } from "@excalidraw/excalidraw/scene/flowChart";
import type { FlowCustomPreset } from "@excalidraw/excalidraw/scene/flowCustomPresets";
import type { FlowChartShape } from "@excalidraw/excalidraw/scene/flowPresets";
import type { FlowPresetId } from "@excalidraw/excalidraw/scene/flowScript";

import { FlowGuide } from "./FlowGuide";
import { FlowPresetForm } from "./FlowPresetForm";
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
  list: "One line for each block, in order. Nothing joins them.",
  grid: "One line for each row, with a | between the cells. Start a line with # for the header row.",
  matrix: "One line for each row, with a | between its two cells.",
  pyramid:
    "One line for each layer, the top one first. Each is wider than the last.",
  funnel:
    "One line for each stage, the widest first. Each is narrower than the last.",
  timeline: "One line for each moment, in order.",
  target: "One line for each ring, the outermost first. Six rings at most.",
  venn: "One line for each circle. Two to four.",
  hierarchy:
    "One line for each node. Indent a line once to put it under the line above.",
};

const FIT_LABELS: Record<FlowFitMode, string> = {
  page: "Fit to page",
  spread: "Spread over pages",
  larger: "Allow larger than page",
};

const SHAPE_LABELS: Record<FlowChartShape, string> = {
  own: "Preset's own",
  rectangle: "Rectangle",
  rounded: "Rounded",
  ellipse: "Ellipse",
  circle: "Circle",
  diamond: "Diamond",
};

type Message = { kind: "error" | "ok"; text: string };

type View = "chart" | "guide" | "form";

/** hands a file to the browser to save */
const downloadFile = (name: string, text: string) => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * The flow studio (D-161): presets for a chart that is made of ordinary shapes
 * and arrows, filled from a script of one line for each node.
 *
 * It does not draw anything itself: it asks `buildFlowPreset` for the elements
 * and puts them on the page the teacher is on - and on the pages after it when
 * the chart is spread (D-226) - in one step that one undo takes back.
 */
export const FlowTab = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [customs, setCustoms] = useState<FlowCustomPreset[]>(
    readStoredCustomPresets,
  );
  const listing = useMemo(() => listFlowPresets(customs), [customs]);
  useEffect(() => {
    const refresh = () => setCustoms(readStoredCustomPresets());
    window.addEventListener("flow-presets-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("flow-presets-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const [presetId, setPresetId] = useState<string>("process");
  const preset = listing.find((p) => p.id === presetId) ?? listing[0];
  const custom = customs.find((c) => c.id === presetId);
  const builtIn: FlowPresetId = custom
    ? BUILT_IN_OF_LAYOUT[custom.layout]
    : (presetId as FlowPresetId);

  const [script, setScript] = useState(preset.example);
  // a script the teacher has not touched follows the preset they pick
  const [edited, setEdited] = useState(false);
  const [fit, setFit] = useState<FlowFitMode>("page");
  const [shape, setShape] = useState<FlowChartShape>("own");
  const [arrows, setArrows] = useState<"own" | "none">("own");
  const [message, setMessage] = useState<Message | null>(null);
  const [view, setView] = useState<View>("chart");
  const [editing, setEditing] = useState<FlowCustomPreset | null>(null);

  const fileInput = useRef<HTMLInputElement | null>(null);

  // the small picture of a kind, from the chart its example builds (D-239)
  const pictureOf = (p: { id: string; example: string }) => {
    const own = customs.find((c) => c.id === p.id);

    return flowKindPreview(
      own ? BUILT_IN_OF_LAYOUT[own.layout] : (p.id as FlowPresetId),
      p.example,
      own ? buildSettingsOfCustom(own).options : {},
    );
  };

  const choose = useCallback(
    (id: string) => {
      const next = listing.find((p) => p.id === id);
      const picked = customs.find((c) => c.id === id);

      setPresetId(id);
      setMessage(null);
      // a preset brings the shape and the arrows it was made with
      setShape(picked ? picked.shape : "own");
      setArrows(picked?.arrows ?? "own");

      if (!edited && next) {
        setScript(next.example);
      } else if (edited) {
        // the words come across to the new kind, written for it (D-233)
        const target: FlowPresetId = picked
          ? BUILT_IN_OF_LAYOUT[picked.layout]
          : (id as FlowPresetId);

        setScript(convertScript(builtIn, script, target));
      }
    },
    [edited, listing, customs, builtIn, script],
  );

  const options = useMemo(() => {
    const state =
      excalidrawAPI && !excalidrawAPI.isDestroyed
        ? excalidrawAPI.getAppState()
        : null;
    const page = state?.pages?.length
      ? getPageRect(state.pages, state.currentPageId)
      : undefined;

    return {
      page,
      fit,
      ...(custom ? buildSettingsOfCustom(custom).options : {}),
      shape,
      arrows,
    };
  }, [excalidrawAPI, fit, shape, arrows, custom]);

  // the script is checked as it is typed (D-224)
  const check = useMemo(
    () => checkFlowScript(builtIn, script, options),
    [builtIn, script, options],
  );

  const insert = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }

    const state = excalidrawAPI.getAppState();
    const { pages, currentPageId } = state;
    const page = getPageRect(pages, currentPageId);
    const settings = custom ? buildSettingsOfCustom(custom).options : {};

    // a spread chart goes on the pages that follow, made when they are missing
    const plan =
      fit === "spread" && check.pages > 1
        ? planChartPages({ pages, currentPageId, count: check.pages })
        : null;

    const result = buildFlowPreset(builtIn, script, {
      ...settings,
      page,
      // the middle of what the teacher can see, kept on the page by the builder
      center: plan
        ? undefined
        : placementFor(excalidrawAPI, { width: 0, height: 0 }),
      pageId: currentPageId,
      pageNumber: getPageIndex(pages, currentPageId) + 1,
      pages: plan ? flowPagesOf(plan) : undefined,
      // a second chart on the same page must not reuse the first one's ids
      seed: randomInteger(),
      chartId: `chart-${randomId()}`,
      fit,
      custom,
      shape,
      arrows,
    });

    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }

    const selected = {
      // the shapes and arrows: their labels come with them
      selectedElementIds: Object.fromEntries(
        result.elements
          .filter((el) => el.type !== "text")
          .map((el) => [el.id, true as const]),
      ),
    };

    if (plan && plan.created > 0) {
      // the pages that were made, and what they push along, are one step with the chart
      const translated = translateContentForPageLayout({
        elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
        previousPages: pages,
        nextPages: plan.pages,
      });

      excalidrawAPI.updateScene({
        elements: reconcileElements(
          translated as RemoteExcalidrawElement[],
          [...translated, ...result.elements] as RemoteExcalidrawElement[],
          state,
        ),
        appState: { ...selected, pages: plan.pages },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    } else {
      appendElements(
        excalidrawAPI,
        result.elements,
        selected,
        currentPageId,
        CaptureUpdateAction.IMMEDIATELY,
        result.pages > 1,
      );
    }

    setMessage({
      kind: "ok",
      text:
        result.pages > 1
          ? `Added a ${preset.name.toLowerCase()} chart over ${
              result.pages
            } pages.`
          : `Added a ${preset.name.toLowerCase()} chart to this page.`,
    });
  }, [
    builtIn,
    check.pages,
    custom,
    excalidrawAPI,
    fit,
    preset.name,
    script,
    shape,
    arrows,
  ]);

  const editScript = useCallback(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }

    const [first] = Object.keys(excalidrawAPI.getAppState().selectedElementIds);

    if (!first) {
      setMessage({
        kind: "error",
        text: "Select a chart on the page first, then press Edit chart.",
      });
      return;
    }

    openFlowScriptEditor(first);
  }, [excalidrawAPI]);

  /* --------------------------------------------------------- custom presets */

  const keep = (next: FlowCustomPreset[]) => {
    setCustoms(next);
    writeStoredCustomPresets(next);
  };

  const savePreset = (saved: Omit<FlowCustomPreset, "id">) => {
    if (editing) {
      keep(
        customs.map((c) => (c.id === editing.id ? { ...saved, id: c.id } : c)),
      );
    } else {
      const name = uniquePresetName(
        saved.name,
        new Set(customs.map((c) => c.name)),
      );
      const id = uniquePresetId(name, new Set(customs.map((c) => c.id)));

      keep([...customs, { ...saved, name, id }]);
      choose(id);
      // the new preset is not in the list this render has: what it brings is set here
      setShape(saved.shape);
      setArrows(saved.arrows ?? "own");

      if (!edited) {
        setScript(saved.example);
      }
    }

    setEditing(null);
    setView("chart");
  };

  const importFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    const imported = importCustomPresets(await file.text(), customs);

    if (!imported.ok) {
      // all of the file or none of it: what the teacher has is as it was
      setMessage({ kind: "error", text: imported.error });
      return;
    }

    keep([...customs, ...imported.presets]);
    setMessage({
      kind: "ok",
      text: `Added ${imported.presets.length} preset${
        imported.presets.length === 1 ? "" : "s"
      }.`,
    });
  };

  if (view === "guide") {
    return (
      <div className="flow-tab">
        <div className="flow-tab__body">
          <FlowGuide
            presets={listing}
            customs={customs}
            onBack={() => setView("chart")}
            onUse={(id, example) => {
              choose(id);
              setScript(example);
              setEdited(true);
              setView("chart");
            }}
            onUseAnimated={(example) => {
              choose(example.preset);
              setScript(example.script);
              setEdited(true);
              // the animation the example is made to show (D-380)
              updateFlowAnimationSettings({
                arrowStyle: example.arrowStyle,
                nodeStyle: example.nodeStyle,
              });
              setView("chart");
            }}
          />
        </div>
      </div>
    );
  }

  if (view === "form") {
    return (
      <div className="flow-tab">
        <div className="flow-tab__body">
          <FlowPresetForm
            initial={editing ?? undefined}
            onSave={savePreset}
            onCancel={() => {
              setEditing(null);
              setView("chart");
            }}
          />
        </div>
      </div>
    );
  }

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

        <div className="flow-tab__tools">
          <button type="button" onClick={() => setView("guide")}>
            Guide
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setView("form");
            }}
          >
            New preset
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <button
            type="button"
            disabled={customs.length === 0}
            onClick={() =>
              downloadFile("flow-presets.json", exportCustomPresets(customs))
            }
          >
            Export
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Import presets"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <div
          className="flow-tab__presets"
          role="radiogroup"
          aria-label="Kind of chart"
        >
          {listing.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === presetId}
              className="flow-tab__preset"
              onClick={() => choose(p.id)}
            >
              <span className="flow-tab__preset-picture">
                <FlowPreview preview={pictureOf(p)} />
              </span>
              <span className="flow-tab__preset-name">{p.name}</span>
              <span className="flow-tab__preset-description">
                {p.description}
              </span>
            </button>
          ))}
        </div>

        {custom && (
          <div className="flow-tab__tools" aria-label="Your preset">
            <button
              type="button"
              onClick={() => {
                setEditing(custom);
                setView("form");
              }}
            >
              Edit preset
            </button>
            <button
              type="button"
              onClick={() => {
                const copy = duplicateCustomPreset(custom, customs);

                keep([...customs, copy]);
                choose(copy.id);
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => {
                keep(customs.filter((c) => c.id !== custom.id));
                choose("process");
              }}
            >
              Delete preset
            </button>
          </div>
        )}

        <div className="flow-tab__options">
          <label>
            Fit
            <select
              aria-label="Fit mode"
              value={fit}
              onChange={(event) => setFit(event.target.value as FlowFitMode)}
            >
              {FLOW_FIT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {FIT_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shape
            <select
              aria-label="Node shape"
              value={shape}
              onChange={(event) =>
                setShape(event.target.value as FlowChartShape)
              }
            >
              {(["own", ...FLOW_NODE_SHAPES] as FlowChartShape[]).map((s) => (
                <option key={s} value={s}>
                  {SHAPE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flow-tab__options">
          <label>
            Arrows
            <select
              aria-label="Arrows"
              value={arrows}
              onChange={(event) =>
                setArrows(event.target.value as "own" | "none")
              }
            >
              <option value="own">As the preset</option>
              <option value="none">None</option>
            </select>
          </label>
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
        <p className="flow-tab__hint">{SCRIPT_HINTS[builtIn]}</p>

        {check.problems.length > 0 && (
          <ul
            className="flow-tab__problems"
            aria-label="Problems in the script"
          >
            {check.problems.map((problem, index) => (
              <li key={index} data-line={problem.line}>
                Line {problem.line}: {problem.message}
              </li>
            ))}
          </ul>
        )}
        <p className="flow-tab__hint" data-testid="flow-tab-counts">
          {check.nodes} nodes, {check.arrows} arrows
          {check.fontSize !== null ? `, text size ${check.fontSize}` : ""}
          {check.pages > 1 ? `, ${check.pages} pages` : ""}
        </p>
      </div>

      <div className="flow-tab__footer">
        <button
          type="button"
          className="flow-tab__insert"
          disabled={check.problems.length > 0}
          title={check.problems.length > 0 ? check.reason ?? "" : undefined}
          onClick={insert}
        >
          Insert chart
        </button>
        <button type="button" className="flow-tab__edit" onClick={editScript}>
          Edit chart
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
