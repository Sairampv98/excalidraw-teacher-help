# Animated Flowcharts

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 11 **Depends on:** `2026-10-20-canvas-panel-foundation-design.md`

---

## 1. Problem statement

The user wants flowcharts that **come alive**: the part of the flowchart currently being discussed enlarges or pops up, components animate, and the whole thing loops — the way React Flow / Svelte Flow style graph UIs behave.

They linked React Flow and asked for ideas from the wider ecosystem (awesome-react and similar collections).

## 2. What the research established

### 2.1 The repo already has a motion driver

`packages/excalidraw/renderer/animation.ts` — `AnimationController` (`:8-126`): `start:22-41`, `scheduleNextFrame:43-59` (rAF, or `setTimeout` when throttling is off), `tick:84-116` (passes `deltaTime`), `cancel:122-125`. A global keyed registry of per-frame callbacks.

Consumers today: `components/canvases/InteractiveCanvas.tsx:167-198` (calls `renderInteractiveScene({... deltaTime, animationState })` every frame) and `packages/excalidraw/animatedTrail.ts:95-112` (the laser trail). Tests: `packages/excalidraw/tests/animation.test.ts`.

**There is a motion driver, but no motion _data model_.** No keyframes, no timeline, no persisted interpolation. The only `animationState` today is `bindingHighlight`.

### 2.2 The canvas does not run a free rAF loop

The canvas repaints on state change: `App.tsx:4919-4928` `triggerRender`, and the scene pipeline is memoised on `canvasNonce` (`scene/Renderer.ts:161, 218-220`).

`packages/excalidraw/scene/animatedImages.ts:12-22` states the constraint outright: the canvas _"is otherwise only repainted when the app state changes, so an idle board freezes a GIF on its first frame"_ — which is why the GIF fix was a DOM overlay rather than more repaints.

**But:** because `AnimationController` calls the renderer **directly** each frame with a `deltaTime`, a per-frame canvas animation is architecturally possible **without a React re-render**. It requires (a) a render-config field and (b) a continuous repaint of the **static** canvas while an animation is live — the static canvas has no such driver today.

### 2.3 Frames and groups, for reference

- **Frames** (`types.ts:165-177`) link via a single `frameId` (`types.ts:74`); `packages/element/src/frame.ts` holds `getContainingFrame:428-437`, `getFrameChildren:237-248`, `addElementsToFrame:536-631`, `shouldApplyFrameClip:907-966`. **Frames do not nest** — there is no frame-in-frame tree. **No animation on frames**: only outline, clip and name rendering.
- **Groups** (`groupIds`, `types.ts:71-73`) have **no transform of their own** — a group move/resize is applied to member elements. `packages/element/src/groups.ts` and `packages/excalidraw/actions/actionGroup.tsx:86-260`.

### 2.4 Export is entirely static

`ExportType` (`packages/excalidraw/scene/types.ts:141-146`) = `png | clipboard | clipboard-svg | backend | svg`. **No time-based export exists** — no GIF, no video, no multi-frame. A frame exports as one PNG/SVG (`scene/export.ts:133-144` `getFrameRenderingConfig`). The multi-page PDF export (`excalidraw-app/pages/exportPages.ts`) is also static.

### 2.5 React Flow, honestly assessed

`@xyflow/react` (v12) is the library the user linked. Its **MIT-licensed core** gives built-in node and edge types, sub-flows, `NodeToolbar`, `NodeResizer`, animated edges, and auto-layout via `dagre` / `d3-hierarchy` / `elkjs`.

**But the examples that match the user's description — "Node Position Animation", "Auto Layout", "Dynamic Layouting" — are xyflow _Pro_ examples under the xyflow Pro License.** The MIT core is sufficient to _build_ the behaviour; it does not ship it for free.

More importantly: React Flow is a **separate graph engine** with its own node/edge model, its own renderer and its own layout system. Embedding it inside Excalidraw means maintaining **two scene models** and a translation layer between them.

## 3. Two possible architectures — and the honest trade-off

### Option A — overlay model (recommended for the first cut)

The flowchart is drawn with **ordinary Excalidraw elements**. The "aliveness" is a **runtime presentation** layered over them:

- a `flow` panel (or a presentation mode) drives an `AnimationController`;
- each frame, the controller computes a transform per element from the flow's step schedule;
- the transform is applied through the existing DOM-overlay pattern (`components/AnimatedImageOverlay.tsx` / `scene/animatedImageOverlay.ts`), so it does **not** go through the React state machine;
- the focus step's element scales up and pops; other elements dim; the sequence loops.

**Advantages:** reuses the existing overlay + animation infrastructure; no new element type; no dispatch-point risk; the flowchart stays ordinary, editable, exportable Excalidraw content.

**Costs:** the animation is a **presentation, not data**. It is not saved, not shared, not exported, and not visible in the presenter unless separately mirrored. The schedule lives in the panel's configuration.

### Option B — element model

A new element type (or a persisted animation descriptor on elements) that stores the schedule, so animations are saved, undoable, collab-synced and exportable.

**Advantages:** the animation is real document data.

**Costs:** the full element-type dispatch surface (see the video spec's §A7 list) plus a continuous static-canvas repaint driver, plus per-frame interpolation in the render path, plus undo/collab/ restore/export handling. It is the largest single piece of work in this entire plan.

### Recommendation

**Option A first.** The user's description — "the current part of the flowchart that is shown becomes enlarged or pops up and there are components in it that animate and this entire thing is in a loop" — is a _presentation_ behaviour, and Option A delivers it with a fraction of the risk. If the animation later needs to persist, be shared, or be exported, Option B becomes the follow-up, and the schedule data model can then be designed deliberately rather than retrofitted.

This mirrors the decision already taken for GIFs and for panels: **live content is a DOM overlay; locked or persisted content becomes scene data.**

## 4. Goals

1. A flowchart can be "played": steps advance on a loop, the active step enlarges, components animate.
2. The flowchart itself remains ordinary, editable Excalidraw content.
3. No new element type in the first cut.
4. The behaviour works in the presenter (item 10).

## 5. Design

### 5.1 The flow panel

A **flow panel** from the canvas-panel foundation, `panelKind: "flow"`.

Its content is a **flow document** — a serialisable description of the animation, referencing the Excalidraw elements it animates:

```ts
export type FlowDocument = {
  /** Ordered steps of the presentation. */
  steps: FlowStep[];
  /** Loop forever, or stop at the end. */
  loop: boolean;
  /** Milliseconds per step. */
  stepDurationMs: number;
};

export type FlowStep = {
  /** Elements that are the focus of this step. */
  focusElementIds: ExcalidrawElementId[];
  /** Scale applied to the focused elements (1 = unchanged). */
  focusScale: number;
  /** Optional elements that animate (e.g. a pulsing edge). */
  animateElementIds?: ExcalidrawElementId[];
  /** Caption for the step, shown in the panel. */
  caption?: string;
};
```

The flow panel's DOM renders the flowchart view. Two options for what it shows:

- **(a) A live mirror** of the selected elements, re-laid-out by the panel. This is what React Flow would give.
- **(b) A transparent overlay** over the actual Excalidraw elements, which are drawn by the canvas and merely transformed/scaled by the overlay.

**(b) is preferred**: the user gets the real flowchart, in the real canvas, with the real editing tools — and the overlay only adds the focus animation. It also sidesteps the entire "second scene model" problem that embedding React Flow would create.

### 5.2 The animation loop

Using the existing `AnimationController` (`renderer/animation.ts`):

1. the panel starts an animation keyed on the flow document;
2. each tick, the controller computes `t` within the current step and derives a transform (scale, opacity, y-offset) per element;
3. the transforms are applied to overlay copies positioned from the elements' real scene coordinates through the library's own conversion — the same discipline the GIF overlay follows, and the same discipline the handover records as the lesson from the scroll-sign bug;
4. the active step's elements are enlarged and the others dimmed;
5. at the end of a step the controller advances; with `loop`, it wraps.

Because the overlay bypasses React state, this does not re-render the app per frame. The one thing it does need is that the elements it overlays are **not** also painted by the canvas in the same place, or the result doubles up. Two sub-options:

- the canvas skips the flow's elements while the flow is playing (they are re-painted by the overlay), or
- the overlay only draws the _scaled-up_ focus copy on top, leaving the originals visible underneath (a "magnifier" look).

The second is simpler and reads well; the first is cleaner. The first is preferred.

### 5.3 Auto-layout

If the user wants the flow to arrange itself, the layout engines from the React Flow ecosystem are usable **independently of React Flow**:

- **`dagre`** — hierarchical layered layout, MIT.
- **`d3-hierarchy`** — tree layout, MIT.
- **`elkjs`** — layered graph layout, MIT (and used by React Flow's own examples).

Applying a layout means **moving the elements**, which is a normal scene mutation — undoable, saved, and visible in the editor. That is a genuine advantage over React Flow, where layout is internal.

Recommendation: start with **`dagre`** for a first-cut auto-layout, since hierarchical flowcharts are the teaching case and dagre is a single small dependency.

> **Approved by the owner, 2026-10-21** ("ok install dagre"). `dagre` (`0.8.5`) is installed as a runtime dependency of `packages/excalidraw`, with `@types/dagre` (`0.7.54`) for its types — the only dependencies the fork adds to the pre-existing toolchain. Locked as **D-31** in `SPEC.md`.
>
> **This design's shape is superseded on two points** by the owner's later decision (question 9): the animation is triggered from a **properties-panel section** and played as an **overlay**, not from a flow panel element. See `docs/superpowers/specs/2026-10-21-flow-animation-design.md` for the shape that was chosen; the auto-layout this section describes is part of it.

### 5.4 Presenter support

The presenter channel (`presenterChannel.ts:140-152`) is a `BroadcastChannel` carrying structured-clone data, so it _can_ carry an animation field. But it publishes on editor **state change**, not per frame, so a live animation needs its own clock in the presenter.

Recommendation: the presenter **mirrors the flow panel's DOM** — the same overlay, the same `AnimationController`, started at the same step index — rather than streaming per-frame transform updates. Both windows then run the same animation locally and stay in step.

### 5.5 Export

There is **no time-based export today** (PNG/SVG/clipboard/backend only). So a flow animation cannot be exported as an animated GIF without new work: a frame-capture loop plus a GIF encoder (a new dependency, and `gifenc`/`gif.js` are the usual candidates).

Out of scope for the first cut. What _is_ in scope: exporting the flowchart **statically** (it is ordinary elements) and exporting a **single step** as a still, which is often what a teacher actually wants for a slide.

## 6. Test coverage

| Test | Asserts |
| --- | --- |
| flow panel creation | a flow panel with a valid `FlowDocument` is created and restored |
| step advance | the flow advances steps on the configured duration, and loops when `loop` is set |
| focus transform | during a step, the focused elements' overlay transform matches the expected scale and position — asserted through the library's own `sceneCoordsToViewportCoords` |
| no double paint | while a flow is playing, the canvas does not paint the flow's elements |
| overlay does not re-render React | playing a flow does not increase the app's React render count per frame |
| auto-layout | applying `dagre` layout moves the elements and the result is a normal, undoable scene mutation |
| presenter sync | the presenter's flow is at the same step index as the editor's |

**Teeth check:** removing the loop must fail the step-advance test; removing the focus transform must fail the focus-transform test.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| The overlay's transforms drift from the canvas's geometry | Both use the library's own conversion; the focus-transform test asserts through it |
| Per-frame overlay work is costly with many elements | The overlay only touches the flow's elements, not the whole scene; it bypasses React state |
| The animation is not saved | Accepted for the first cut — see §3. Option B is the follow-up if it matters |
| `dagre` is a new dependency | It is the smallest of the three layout engines and does only layout, not rendering. The repo rule requires an explicit justification, which this is |
| Users expect React Flow parity | Stated plainly in the UI: this is an animated _presentation_ of an Excalidraw flowchart, not a graph editor |
| The xyflow Pro examples the user linked are licensed | The behaviour is implemented directly against the MIT core and Excalidraw's own animation controller, so no Pro code is used |

## 8. Success criteria

1. A flowchart can be played: steps advance on a loop, the active step enlarges, elements animate.
2. The flowchart remains ordinary editable Excalidraw content.
3. Auto-layout can arrange a flowchart hierarchically, and the arrangement is undoable.
4. The presenter shows the same flow at the same step.
5. The four gates are green.

## 9. Ordering

**Wave 4.** It depends on the canvas-panel foundation, and it is the last of the feature waves because it is the most open-ended.
