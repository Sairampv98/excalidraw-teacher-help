/**
 * The flow animation's state — the one thing the properties-panel section and
 * the canvas overlay talk through.
 *
 * It is a **jotai atom** (the `PageSplitState.ts` pattern) and not `appState`,
 * so nothing about the animation is written into the application state — and
 * therefore nothing about it reaches the saved document (D-63).
 */

import { atom, editorJotaiStore } from "../editor-jotai";

import type { FlowStep } from "../scene/flowOrder";

/** how long a step is held, in milliseconds, unless the user says otherwise */
export const DEFAULT_FLOW_STEP_DURATION_MS = 1200;

export type FlowAnimationState = {
  /** whether the animation is playing */
  active: boolean;
  /** the steps, in the order the animation walks them */
  steps: FlowStep[];
  /** the step that is focused now */
  index: number;
  /** how long a step is held, in milliseconds */
  durationMs: number;
  /** whether the animation loops back to the first step */
  loop: boolean;
};

export const flowAnimationStateAtom = atom<FlowAnimationState>({
  active: false,
  steps: [],
  index: 0,
  durationMs: DEFAULT_FLOW_STEP_DURATION_MS,
  loop: true,
});

/** starts the animation at its first step */
export const startFlowAnimation = (
  steps: FlowStep[],
  options?: { durationMs?: number; loop?: boolean },
) => {
  editorJotaiStore.set(flowAnimationStateAtom, {
    active: true,
    steps,
    index: 0,
    durationMs: options?.durationMs ?? DEFAULT_FLOW_STEP_DURATION_MS,
    loop: options?.loop ?? true,
  });
};

/** ends the animation and gives the canvas back */
export const stopFlowAnimation = () => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  editorJotaiStore.set(flowAnimationStateAtom, {
    ...current,
    active: false,
    index: 0,
  });
};

/** whether the animation is playing right now */
export const isFlowAnimationActive = () =>
  editorJotaiStore.get(flowAnimationStateAtom).active;

/** changes one of the settings, without touching the playing state */
export const updateFlowAnimationSettings = (
  settings: Partial<Pick<FlowAnimationState, "durationMs" | "loop">>,
) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  editorJotaiStore.set(flowAnimationStateAtom, { ...current, ...settings });
};
