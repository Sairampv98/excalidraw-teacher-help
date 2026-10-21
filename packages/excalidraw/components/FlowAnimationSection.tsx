import React, { useMemo } from "react";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { actionFlowLayout } from "../actions/actionFlowLayout";
import { buildFlowGraph } from "../scene/flowOrder";

import { useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import {
  DEFAULT_FLOW_STEP_DURATION_MS,
  flowAnimationStateAtom,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "./FlowAnimationState";

import type { AppClassProperties } from "../types";

type FlowAnimationSectionProps = {
  /** the selection, with the bound text folded in */
  targetElements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  app: AppClassProperties;
};

/**
 * The properties-panel section that drives the flow animation.
 *
 * It is a `<fieldset>` + `<legend>`, like the Layers / Align / Actions
 * sections around it. Nothing it does touches `appState`: the settings and the
 * playing state live in a jotai atom, so nothing about the animation reaches
 * the saved document (D-63).
 */
export const FlowAnimationSection = ({
  targetElements,
  elementsMap,
  app,
}: FlowAnimationSectionProps) => {
  const state = useAtomValue(flowAnimationStateAtom);

  const steps = useMemo(
    () => buildFlowGraph(targetElements, elementsMap).steps,
    [targetElements, elementsMap],
  );

  // a one-element selection has no flow
  if (steps.length < 2) {
    return null;
  }

  return (
    <fieldset>
      <legend>{t("labels.flowAnimation")}</legend>
      <div className="buttonList">
        <label className="excalidraw__flow-animation-setting">
          <span>{t("labels.flowAnimationDuration")}</span>
          <input
            type="number"
            min={100}
            step={100}
            value={state.durationMs}
            onChange={(event) =>
              updateFlowAnimationSettings({
                durationMs:
                  Number(event.target.value) || DEFAULT_FLOW_STEP_DURATION_MS,
              })
            }
          />
        </label>
        <label className="excalidraw__flow-animation-setting">
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(event) =>
              updateFlowAnimationSettings({ loop: event.target.checked })
            }
          />
          <span>{t("labels.flowAnimationLoop")}</span>
        </label>
        <button
          type="button"
          onClick={() => {
            if (state.active) {
              stopFlowAnimation();
              return;
            }

            startFlowAnimation(steps, {
              durationMs: state.durationMs,
              loop: state.loop,
            });
          }}
        >
          {state.active
            ? t("labels.flowAnimationStop")
            : t("labels.flowAnimationPlay")}
        </button>
        <button
          type="button"
          onClick={() =>
            app.actionManager.executeAction(actionFlowLayout, "ui")
          }
        >
          {t("labels.flowAnimationLayout")}
        </button>
      </div>
    </fieldset>
  );
};
