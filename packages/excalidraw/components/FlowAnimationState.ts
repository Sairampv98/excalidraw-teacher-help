/**
 * The flow animation's state — the one thing the properties-panel section and
 * the canvas overlay talk through.
 *
 * It is a **jotai atom** (the `PageSplitState.ts` pattern) and not `appState`,
 * so nothing about the animation is written into the application state — and
 * therefore nothing about it reaches the saved document (D-63).
 */

import { atom, editorJotaiStore } from "../editor-jotai";
import {
  choicesAt,
  currentIndex,
  downstreamSteps,
  presentChoose,
  presentNext,
  presentPrevious,
  startPath,
} from "../scene/flowPresent";

import type { FlowGraph, FlowStep } from "../scene/flowOrder";
import type { FlowStyle } from "../scene/flowStyles";

/** how long a step is held, in milliseconds, unless the user says otherwise */
export const DEFAULT_FLOW_STEP_DURATION_MS = 1200;

export type FlowAnimationMode =
  /** the steps follow each other on a clock, and may loop (wave 6c) */
  | "play"
  /** the teacher moves from step to step; nothing loops (D-167) */
  | "present";

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
  /** how the flow is drawn (D-166) */
  style: FlowStyle;
  /** whether the view flies to each step (D-170); off unless asked for */
  camera: boolean;
  mode: FlowAnimationMode;
  /** presenting: the steps visited, in order - the current step is the last */
  path: number[];
  /** the flow's arrows and steps, for choices, ends and the paths to draw along */
  graph: FlowGraph | null;
};

export const flowAnimationStateAtom = atom<FlowAnimationState>({
  active: false,
  steps: [],
  index: 0,
  durationMs: DEFAULT_FLOW_STEP_DURATION_MS,
  loop: true,
  style: "focus",
  camera: false,
  mode: "play",
  path: [],
  graph: null,
});

type StartOptions = {
  durationMs?: number;
  loop?: boolean;
  style?: FlowStyle;
  camera?: boolean;
  mode?: FlowAnimationMode;
  graph?: FlowGraph | null;
};

/** starts the animation at its first step */
export const startFlowAnimation = (
  steps: FlowStep[],
  options?: StartOptions,
) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);
  const mode = options?.mode ?? "play";

  editorJotaiStore.set(flowAnimationStateAtom, {
    active: true,
    steps,
    index: 0,
    durationMs: options?.durationMs ?? DEFAULT_FLOW_STEP_DURATION_MS,
    // presenting does not loop
    loop: mode === "present" ? false : options?.loop ?? true,
    style: options?.style ?? current.style,
    camera: options?.camera ?? current.camera,
    mode,
    path: mode === "present" ? [...startPath()] : [],
    graph: options?.graph ?? null,
  });
};

/** ends the animation and gives the canvas back */
export const stopFlowAnimation = () => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  editorJotaiStore.set(flowAnimationStateAtom, {
    ...current,
    active: false,
    index: 0,
    path: [],
  });
};

/** whether the animation is playing right now */
export const isFlowAnimationActive = () =>
  editorJotaiStore.get(flowAnimationStateAtom).active;

/** whether the flow is being presented (the arrow keys are ours only then) */
export const isFlowPresenting = () => {
  const state = editorJotaiStore.get(flowAnimationStateAtom);

  return state.active && state.mode === "present";
};

/** changes one of the settings, without touching the playing state */
export const updateFlowAnimationSettings = (
  settings: Partial<
    Pick<FlowAnimationState, "durationMs" | "loop" | "style" | "camera">
  >,
) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  editorJotaiStore.set(flowAnimationStateAtom, { ...current, ...settings });
};

/* ------------------------------------------------------------------ presenting */

const setPath = (path: readonly number[]) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  if (!current.active || current.mode !== "present") {
    return;
  }

  editorJotaiStore.set(flowAnimationStateAtom, {
    ...current,
    path: [...path],
    index: currentIndex(path),
  });
};

/** one step on, in the step order */
export const presentStepForward = () => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  setPath(presentNext(current.path, current.steps.length));
};

/** one step back along the path */
export const presentStepBack = () => {
  setPath(presentPrevious(editorJotaiStore.get(flowAnimationStateAtom).path));
};

/** the branch that was picked at a question becomes the next step */
export const presentPickBranch = (targetIndex: number) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  // only a branch the current question really offers can be picked
  if (
    !current.graph ||
    !choicesAt(current.graph, current.index).includes(targetIndex)
  ) {
    return;
  }

  setPath(presentChoose(current.path, targetIndex));
};

/**
 * Plays the current step and everything downstream of it, once, in the step
 * order - and leaves presenting for it (D-167).
 */
export const playFromCurrentStep = () => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  if (!current.graph) {
    return;
  }

  const steps = downstreamSteps(current.graph, current.index);

  if (steps.length) {
    startFlowAnimation(steps, {
      durationMs: current.durationMs,
      loop: false,
      mode: "play",
      graph: current.graph,
    });
  }
};
