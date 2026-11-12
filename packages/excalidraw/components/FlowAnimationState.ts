/**
 * The flow animation's state — the one thing the floating bar and the canvas
 * overlay talk through.
 *
 * It is a **jotai atom** (the `PageSplitState.ts` pattern) and not `appState`,
 * so nothing about the animation is written into the application state — and
 * therefore nothing about it reaches the saved document (D-63).
 *
 * The **settings** (how the nodes and the arrows are animated, how fast, the
 * camera and the loop) are remembered between sessions in the browser's own
 * storage, and only there: they are the teacher's preferences, not part of any
 * document (D-178).
 */

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

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
import {
  FLOW_LOOK_DEFAULTS,
  readFlowColor,
  readFlowLook,
  readGlowLevels,
} from "../scene/flowLook";
import { flowOfSelection } from "../scene/flowSelection";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  FLOW_SPEED,
  clampFlowSpeed,
  splitFlowStyle,
} from "../scene/flowStyles";

import type { FlowLook } from "../scene/flowLook";
import type { FlowGraph, FlowStep } from "../scene/flowOrder";
import type {
  FlowArrowStyle,
  FlowNodeStyle,
  FlowStyle,
} from "../scene/flowStyles";

/** how long a step is held, in milliseconds, unless the user says otherwise */
export const DEFAULT_FLOW_STEP_DURATION_MS = 1200;

export type FlowAnimationMode =
  /** the steps follow each other on a clock, and may loop (wave 6c) */
  | "play"
  /** the teacher moves from step to step; nothing loops (D-167) */
  | "present";

/** the teacher's preferences: the part of the state that outlives a session */
export type FlowAnimationSettings = FlowLook & {
  /** how long a step is held, in milliseconds */
  durationMs: number;
  /** whether the animation loops back to the first step */
  loop: boolean;
  /** what the shapes do while a step is current (D-178) */
  nodeStyle: FlowNodeStyle;
  /** what is drawn along the arrows (D-178) */
  arrowStyle: FlowArrowStyle;
  /** how fast the marks travel, in scene units a second (D-179) */
  speed: number;
  /** whether the view flies to each step (D-170); off unless asked for */
  camera: boolean;
};

export type FlowAnimationState = FlowAnimationSettings & {
  /** whether the animation is playing */
  active: boolean;
  /** the steps, in the order the animation walks them */
  steps: FlowStep[];
  /** the step that is focused now */
  index: number;
  mode: FlowAnimationMode;
  /** presenting: the steps visited, in order - the current step is the last */
  path: number[];
  /** the flow's arrows and steps, for choices, ends and the paths to draw along */
  graph: FlowGraph | null;
  /**
   * The state is a **mirror** of another window's (the presenter, D-181): the
   * steps are moved by that window, so this one runs no step clock, flies no
   * camera, listens to no key and has no control to press.
   */
  mirror: boolean;
};

/* ------------------------------------------------------------------- settings */

export const FLOW_SETTINGS_STORAGE_KEY = "excalidraw-flow-animation-settings";

const DEFAULT_SETTINGS: FlowAnimationSettings = {
  ...FLOW_LOOK_DEFAULTS,
  durationMs: DEFAULT_FLOW_STEP_DURATION_MS,
  loop: true,
  nodeStyle: "focus",
  arrowStyle: "none",
  speed: FLOW_SPEED,
  camera: false,
};

/** what the browser's storage holds, kept to what is valid; never throws */
const readStoredSettings = (): FlowAnimationSettings => {
  try {
    const raw = window.localStorage.getItem(FLOW_SETTINGS_STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : null;

    if (!stored || typeof stored !== "object") {
      return DEFAULT_SETTINGS;
    }

    // the look is read defensively: a colour that is not one is the default
    const settings = { ...DEFAULT_SETTINGS, ...readFlowLook(stored) };

    if (Number.isFinite(stored.durationMs) && stored.durationMs >= 100) {
      settings.durationMs = stored.durationMs;
    }

    if (typeof stored.loop === "boolean") {
      settings.loop = stored.loop;
    }

    if (typeof stored.camera === "boolean") {
      settings.camera = stored.camera;
    }

    if (Number.isFinite(stored.speed)) {
      settings.speed = clampFlowSpeed(stored.speed);
    }

    if (FLOW_NODE_STYLES.some((style) => style.id === stored.nodeStyle)) {
      settings.nodeStyle = stored.nodeStyle;
    }

    if (FLOW_ARROW_STYLES.some((style) => style.id === stored.arrowStyle)) {
      settings.arrowStyle = stored.arrowStyle;
    }

    return settings;
  } catch {
    // private windows and blocked storage: the defaults are fine
    return DEFAULT_SETTINGS;
  }
};

const storeSettings = (settings: FlowAnimationSettings) => {
  try {
    window.localStorage.setItem(
      FLOW_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // nothing to do: the setting still applies for this session
  }
};

const settingsOf = (state: FlowAnimationState): FlowAnimationSettings => ({
  nodeColor: state.nodeColor,
  textColor: state.textColor,
  glowShape: state.glowShape,
  glowText: state.glowText,
  glowMark: state.glowMark,
  glowArrow: state.glowArrow,
  ...readGlowLevels(state),
  markColor: state.markColor,
  arrowColor: state.arrowColor,
  hideArrow: state.hideArrow,
  nodeTarget: state.nodeTarget,
  durationMs: state.durationMs,
  loop: state.loop,
  nodeStyle: state.nodeStyle,
  arrowStyle: state.arrowStyle,
  speed: state.speed,
  camera: state.camera,
});

export const flowAnimationStateAtom = atom<FlowAnimationState>({
  active: false,
  steps: [],
  index: 0,
  ...readStoredSettings(),
  mode: "play",
  path: [],
  graph: null,
  mirror: false,
});

type StartOptions = Partial<FlowAnimationSettings> & {
  /** a single style, read as the node and arrow animations it stands for */
  style?: FlowStyle;
  mode?: FlowAnimationMode;
  graph?: FlowGraph | null;
};

/** a single style turned into the pair of animations (D-178) */
const stylesOf = (options: {
  style?: FlowStyle;
  nodeStyle?: FlowNodeStyle;
  arrowStyle?: FlowArrowStyle;
}): { nodeStyle?: FlowNodeStyle; arrowStyle?: FlowArrowStyle } => {
  if (!options.style) {
    return { nodeStyle: options.nodeStyle, arrowStyle: options.arrowStyle };
  }

  const { node, arrow } = splitFlowStyle(options.style);

  return {
    nodeStyle: options.nodeStyle ?? node,
    arrowStyle: options.arrowStyle ?? arrow,
  };
};

/** the look a run starts with: what it was asked for, else what is set (D-189) */
const lookOf = (
  options: Partial<FlowLook> | undefined,
  current: FlowLook,
): FlowLook => ({
  nodeColor:
    options && "nodeColor" in options
      ? readFlowColor(options.nodeColor)
      : current.nodeColor,
  markColor:
    options && "markColor" in options
      ? readFlowColor(options.markColor)
      : current.markColor,
  arrowColor:
    options && "arrowColor" in options
      ? readFlowColor(options.arrowColor)
      : current.arrowColor,
  textColor:
    options && "textColor" in options
      ? readFlowColor(options.textColor)
      : current.textColor,
  glowShape: options?.glowShape ?? current.glowShape,
  glowText: options?.glowText ?? current.glowText,
  glowMark: options?.glowMark ?? current.glowMark,
  glowArrow: options?.glowArrow ?? current.glowArrow,
  ...readGlowLevels({ ...readGlowLevels(current), ...(options ?? {}) }),
  hideArrow: options?.hideArrow ?? current.hideArrow,
  nodeTarget: options?.nodeTarget ?? current.nodeTarget,
});

/** starts the animation at its first step */
export const startFlowAnimation = (
  steps: FlowStep[],
  options?: StartOptions,
) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);
  const mode = options?.mode ?? "play";
  const styles = stylesOf(options ?? {});

  editorJotaiStore.set(flowAnimationStateAtom, {
    active: true,
    steps,
    index: 0,
    durationMs: options?.durationMs ?? DEFAULT_FLOW_STEP_DURATION_MS,
    // presenting does not loop
    loop: mode === "present" ? false : options?.loop ?? true,
    nodeStyle: styles.nodeStyle ?? current.nodeStyle,
    arrowStyle: styles.arrowStyle ?? current.arrowStyle,
    speed: clampFlowSpeed(options?.speed ?? current.speed),
    camera: options?.camera ?? current.camera,
    ...lookOf(options, current),
    mode,
    path: mode === "present" ? [...startPath()] : [],
    graph: options?.graph ?? null,
    mirror: false,
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

/**
 * Changes one of the settings, without touching the playing state - a changed
 * speed is felt at once and does not restart the animation (D-179). The
 * settings are remembered for the next session.
 */
export const updateFlowAnimationSettings = (
  settings: Partial<FlowAnimationSettings> & { style?: FlowStyle },
) => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);
  const { style, nodeStyle, arrowStyle, ...rest } = settings;
  const styles = stylesOf({ style, nodeStyle, arrowStyle });

  const next: FlowAnimationState = {
    ...current,
    ...rest,
    // a colour that is not one is the default, whoever asks (D-189)
    ...lookOf(rest, current),
    ...(styles.nodeStyle ? { nodeStyle: styles.nodeStyle } : {}),
    ...(styles.arrowStyle ? { arrowStyle: styles.arrowStyle } : {}),
  };

  if (rest.speed !== undefined) {
    next.speed = clampFlowSpeed(rest.speed);
  }

  editorJotaiStore.set(flowAnimationStateAtom, next);
  storeSettings(settingsOf(next));
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

/* --------------------------------------------------------- the presenter (D-181) */

/**
 * What the presenter needs to draw the same animation: plain data, no element
 * and no graph - the presenter has its own copy of the scene, and the steps
 * are found in it by their ids. It is what travels the presenter channel.
 */
export type FlowAnimationSnapshot = {
  mode: FlowAnimationMode;
  /** the container ids of the steps, in the order they are walked */
  stepIds: string[];
  index: number;
  path: number[];
  durationMs: number;
  loop: boolean;
  nodeStyle: FlowNodeStyle;
  arrowStyle: FlowArrowStyle;
  speed: number;
} & FlowLook;

/** the animation as the presenter should see it; `null` when nothing plays */
export const getFlowAnimationSnapshot = (): FlowAnimationSnapshot | null => {
  const state = editorJotaiStore.get(flowAnimationStateAtom);

  // a mirror is somebody else's animation: it is never sent on
  if (!state.active || state.mirror || !state.steps.length) {
    return null;
  }

  return {
    mode: state.mode,
    stepIds: state.steps.map((step) => step.containerId),
    index: state.index,
    path: [...state.path],
    durationMs: state.durationMs,
    loop: state.loop,
    nodeStyle: state.nodeStyle,
    arrowStyle: state.arrowStyle,
    speed: state.speed,
    nodeColor: state.nodeColor,
    textColor: state.textColor,
    glowShape: state.glowShape,
    glowText: state.glowText,
    glowMark: state.glowMark,
    glowArrow: state.glowArrow,
    ...readGlowLevels(state),
    markColor: state.markColor,
    arrowColor: state.arrowColor,
    hideArrow: state.hideArrow,
    nodeTarget: state.nodeTarget,
  };
};

/**
 * Calls `listener` whenever what the presenter should see changes, and only
 * then: the state also changes for reasons the presenter has no use for.
 */
export const subscribeToFlowAnimation = (
  listener: (snapshot: FlowAnimationSnapshot | null) => void,
) => {
  let last = JSON.stringify(getFlowAnimationSnapshot());

  return editorJotaiStore.sub(flowAnimationStateAtom, () => {
    const snapshot = getFlowAnimationSnapshot();
    const next = JSON.stringify(snapshot);

    if (next !== last) {
      last = next;
      listener(snapshot);
    }
  });
};

/**
 * Puts the editor's animation on this window's overlay, as a **mirror**.
 *
 * The steps are found among this window's own elements by the ids the snapshot
 * names, so a shape that moved is followed here too. Returns `false` when they
 * cannot be found yet (the scene has not arrived): the caller tries again with
 * the next scene. A `null` snapshot ends a mirrored animation, and leaves an
 * animation that is this window's own alone.
 */
export const applyFlowAnimationSnapshot = (
  snapshot: FlowAnimationSnapshot | null,
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): boolean => {
  const current = editorJotaiStore.get(flowAnimationStateAtom);

  if (!snapshot) {
    if (current.mirror && current.active) {
      editorJotaiStore.set(flowAnimationStateAtom, {
        ...current,
        active: false,
        index: 0,
        path: [],
      });
    }

    return true;
  }

  const graph = flowOfSelection(
    Object.fromEntries(snapshot.stepIds.map((id) => [id, true])),
    elements,
    elementsMap,
  );

  const steps = graph
    ? snapshot.stepIds
        .map((id) => graph.steps.find((step) => step.containerId === id))
        .filter((step): step is FlowStep => Boolean(step))
    : [];

  if (!graph || steps.length !== snapshot.stepIds.length) {
    return false;
  }

  const next: FlowAnimationState = {
    active: true,
    mirror: true,
    steps,
    graph,
    mode: snapshot.mode,
    index: snapshot.index,
    path: [...snapshot.path],
    durationMs: snapshot.durationMs,
    loop: snapshot.loop,
    nodeStyle: snapshot.nodeStyle,
    arrowStyle: snapshot.arrowStyle,
    speed: snapshot.speed,
    ...readFlowLook(snapshot),
    // the presenter's camera is the editor's, mirrored: it never flies its own
    camera: false,
  };

  const same =
    current.mirror &&
    current.active &&
    JSON.stringify(boxesOf(current)) === JSON.stringify(boxesOf(next)) &&
    JSON.stringify({ ...current, steps: [], graph: null }) ===
      JSON.stringify({ ...next, steps: [], graph: null });

  if (!same) {
    editorJotaiStore.set(flowAnimationStateAtom, next);
  }

  return true;
};

/** the ids and boxes of the steps: what makes two mirrored states the same */
const boxesOf = (state: FlowAnimationState) =>
  state.steps.map((step) => [step.containerId, step.box]);

/* ------------------------------------------------------------- the preview (D-193) */

/**
 * Whether the class loop plays in the edit view too. It is a setting of this
 * editor only: it is **not stored** and **not sent** to the presenter, so it is
 * an atom of its own and no part of the animation's state or of its snapshot.
 */
export const flowClassPreviewAtom = atom(false);

export const setFlowClassPreview = (on: boolean) => {
  editorJotaiStore.set(flowClassPreviewAtom, on);
};

/** whether anything of the animation runs in this editor: it plays, or the class loop is previewed (D-214) */
export const isFlowRunning = () =>
  isFlowAnimationActive() || editorJotaiStore.get(flowClassPreviewAtom);

/** ends whatever runs - the animation and the preview - and gives the canvas back (D-214) */
export const stopFlowEverything = () => {
  stopFlowAnimation();
  setFlowClassPreview(false);
};
