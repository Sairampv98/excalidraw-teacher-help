# Builder brief — Wave 6c, the flowchart animation from the properties panel

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's item 11:

> "i saw that there is a library called as reactflow or sveltflow which are used to create the animations in which flowcharts become live and the current part of flowchart that is shown becomes enlarged or pops up and there are components in it that animate and this entire thing is in a loop, think how we can implement that in this excalidraw fork/custom build?"

The owner's decision (2026-10-21, question 9): the animation is an **overlay model**, triggered from a **properties-panel section** — "no collaborator".

The full design is `docs/superpowers/specs/2026-10-21-flow-animation-design.md`. **Read it first.** It records where this **supersedes** the earlier `2026-10-20-animated-flowcharts-design.md`: that one proposed a dedicated flow _panel element_; the owner chose a properties-panel section and an overlay, so there is **no new element type** here and nothing is written into the document.

## What the code says (verified 2026-10-21)

Every line number below was read from the tree. This is the ground truth the design is written against — **do not re-derive it, and do not guess around it**.

### The properties panel

- The **inner** sections are `<fieldset>` + `<legend>` in `packages/excalidraw/components/Actions.tsx:246-313` ("Layers" `:246`, "Align" `:256`, "Actions" `:298`). `Section` (`packages/excalidraw/components/Section.tsx`) is only the **outer a11y landmark**, used in `LayerUI.tsx:242` — it is **not** used inside `Actions.tsx` at all. **So adding a section means adding a `<fieldset>`, and `Section.tsx` and the `headings.*` i18n keys do not change.**
- A section reads the selection through `targetElements = getTargetElements(elementsMap, appState)` (`Actions.tsx:147`, `packages/element/src/selection.ts:471-484`), and the `elementsMap` comes from `app.scene.getNonDeletedElementsMap()` (`LayerUI.tsx:278`).
- **`getTargetElements` folds the bound text element in** (`includeBoundTextElement: true`), so a labelled box yields **two** `targetElements` entries. A step resolver must dedupe on the _container_, not trust `targetElements.length`.
- `Island` (`packages/excalidraw/components/Island.tsx`) is **not** a portal — it is a styled `div` with a `--padding` variable. The section does not need to escape into the canvas.
- **The dock needs no change.** `excalidraw-app/dock/dockTypes.ts:37-50` binds the properties dock to the live DOM element by CSS selector (`.selected-shape-actions-container`), and `EdgeDocks.tsx:504-540` re-measures on mutation. A new section simply makes the panel taller. The dock is app-level, the panel is library-level, and the library does not know the dock exists.

### The step order

- An arrow holds its bindings: `startBinding` / `endBinding` → `FixedPointBinding.elementId` (`packages/element/src/types.ts:293-310, 346-354`); the shape holds `boundElements` back (`types.ts:35-38, 88-89`). **Read the graph from the arrow** — it is the edge.
- **There is NO helper that resolves an arrow to its two bound shapes.** `getHoveredElementForBinding` (`packages/element/src/collision.ts:341`) is hit-_testing_ for binding, not a way to read an arrow's bindings. The lookup is `arrow.startBinding?.elementId` / `endBinding?.elementId` into the `ElementsMap` — a five-line function that has to be written.
- The fork **already has** `packages/element/src/flowchart.ts` (725 lines) with `getNodeRelatives` `:64`, `getSuccessors` `:134`, `getPredecessors` `:142`, `addNewNode` `:240`, `createBindingArrow` `:371`, `isNodeInFlowchart` `:710`. `getSuccessors`/`getPredecessors` are **exported** and may be reusable for the step order; `getNodeRelatives` is **not** exported and is direction-filtered, so it cannot be used as-is.
- **A reading-order helper does not exist anywhere.** Searches for `readingOrder`, `sortByReading`, `topToBottom`, `byY` return nothing reusable; the only precedent is `packages/excalidraw/components/SearchMenu.tsx:807` — `texts.sort((a, b) => a.y - b.y)`, a **y-only** sort, local to the search results and not exported. It has to be written.

### The overlay

- `packages/excalidraw/components/AnimatedImageOverlay.tsx` is the pattern: an inline `HOST_STYLE` with `pointerEvents: "none"` (`:35-43`, and the comment at `:194-200` explains why it is inline — an overlay that took clicks would break selecting, dragging and the eraser), a value-comparing memo comparator (`:236-253`), and a mount at `App.tsx:2453-2473`.
- **But the position comes from the oracle, not from the GIF's transform.** The GIF re-derives `(scene + scroll) * zoom` by hand and omits the container offset (`packages/excalidraw/scene/animatedImageOverlay.ts:102-105`); `ElementCanvasButtons.tsx:27-28` uses the library's own `sceneCoordsToViewportCoords` and **subtracts** the offsets. Those are two conventions for the same layer. **D-34 settles it for panels: use `sceneCoordsToViewportCoords` (`packages/common/src/utils.ts:468-487`) and subtract `appState.offsetLeft`/`offsetTop`.**
- The oracle rule for the test: `packages/excalidraw/tests/animatedImageOverlay.test.ts:1-13` — assert through `sceneCoordsToViewportCoords` **and** through the produced transform string, parsed and applied with plain matrix maths. Never against the overlay's own arithmetic.

### The dagre integration

- `dagre` is a dependency of **`packages/excalidraw` only** (`packages/excalidraw/package.json:97`). **The layout function must live in `packages/excalidraw/**`** — `packages/element/`and`excalidraw-app/` cannot import it without adding their own dependency.
- `g.node(id).x/y` is the node's **CENTRE**, so the conversion is `newX = node.x - element.width / 2`. The repo's own centre convention is `getCenterForBounds` (`packages/element/src/bounds.ts:1194-1198`).
- `dagre.layout()` does **not** tolerate cycles. `graphlib.alg.findCycles(g)` is available to detect one (`node_modules/@types/dagre/index.d.ts:63`).
- **The move template is `alignElements`** (`packages/element/src/align.ts:17-50`): it mutates each element and then calls `updateBoundElements(element, scene, { simultaneouslyUpdated: group })` for **every** moved element. That call is **mandatory** — without it the bound arrows stay behind and the flowchart falls apart.
- `reconcileElements` is **not** needed: the layout moves existing elements and creates none, so the fractional `index` machinery is not on its path.
- The action makes it undoable the way `actionAlign.tsx:79-95` does: `captureUpdate: CaptureUpdateAction.IMMEDIATELY`.
- The clock must **not** be React state. `packages/excalidraw/renderer/animation.ts`'s `AnimationController` is a static registry driven by `requestAnimationFrame`, and it is the right clock: a React `setState` per frame would re-render the whole app 60×/second.
- **There are no reusable keyframes.** `packages/excalidraw/css/` has no keyframes at all; every one lives next to its own component. The overlay needs **its own SCSS file**, imported by the component, per the library's convention.

## The auto-layout — approved, and in scope

**The owner approved this on 2026-10-21** ("ok install dagre"). It was previously listed as out of scope because it needed a new dependency; it no longer does.

**`dagre` (`0.8.5`) is installed** as a runtime dependency of `packages/excalidraw`, with `@types/dagre` (`0.7.54`) for its types. Locked as **D-31** in `SPEC.md`. **Use the installed copy — do not add the dependency again**, and do not fetch dagre from a CDN.

The layout is a **normal scene mutation**: it moves the elements, so it is undoable, saved, and visible in the editor. That is a real advantage over React Flow, where the layout is internal.

**Why the layout matters for the animation:** the step order comes from the arrows. A layout that is not the author's own would draw arrows between nodes that are not neighbours, so the order would be the layout's rather than the drawing's. So the layout is **one step the user asks for**, and the animation's order is read from the drawing afterwards.

**The layout is optional.** With no layout applied, the animation reads the drawing as it is — which is the point of the arrows. The properties-panel section offers "Lay this out" as a separate action from "Play".

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- | --- | --- |
| D-42 | The animation is **configured in a section of the properties panel** and **played as an overlay** over the canvas. It is not a panel element: the user's flowchart stays ordinary shapes and arrows, and playing the animation changes nothing in the document. |
| D-43 | The **steps are the selected elements**, ordered by the **arrows** between them (a topological sort over the arrow bindings), with reading order as the tie-break. A cycle is the animation's loop, not an error. |
| D-44 | The overlay **does not replace the canvas**: the canvas keeps drawing the flowchart, and the overlay adds the focus treatment on top. Its position comes from the library's own `sceneCoordsToViewportCoords` — the oracle — and not from a hand-derived transform (**D-34**). |
| D-60 | A step is a **container**, not a shape | locked | `getTargetElements` folds the **bound text** into the selection, so a labelled box yields two `targetElements` entries. A step is therefore the **container** and its bound text together, and the resolver must **dedupe on the container** rather than trust `targetElements.length`. The step's bounds are the union of the container's and its label's, which is what the focus treatment scales about. |
| D-61 | The reading order is a **row band**, then left to right | locked | There is no reading-order helper in the repository, so one is written. The rule: shapes whose vertical spans **overlap** are in the same band, and within a band they are ordered left to right; bands are ordered top to bottom. The band test is an **overlap**, not a tolerance — two shapes are in the same row when their vertical spans intersect, so a shape that is entirely below another is in a later band, and a shape that straddles two joins the band it overlaps most. That avoids a magic pixel tolerance, and it is stable when a shape is nudged. |
| D-62 | A **cycle is broken, not refused** | locked | The owner's own words are "this entire thing is in a loop", so a flowchart whose arrows form a cycle is **expected**, not an error — and `dagre.layout()` does not tolerate one. The layout therefore finds the cycle with `graphlib.alg.findCycles(g)`, **drops the back-edge** of each cycle, and lays out the remaining acyclic graph. The dropped edge is the loop, and the animation repeats that step, which is the behaviour the owner asked for. |
| D-63 | The animation is driven by `AnimationController`, not by React state | locked | The per-frame advance goes through `packages/excalidraw/renderer/animation.ts`'s `AnimationController` — a static registry keyed by string, driven by `requestAnimationFrame`. A React `setState` per frame would re-render the whole Excalidraw app 60 times a second, which is the difference between a smooth animation and a stalled one. The section and the overlay talk through a **jotai atom** (the `PageSplitState.ts` pattern), so nothing about the animation is written into `appState` — and therefore nothing into the saved document. |

Add these **seven** rows (D-42, D-43, D-44, D-60, D-61, D-62, D-63) to `SPEC.md` in the Decisions table, and the four acceptance rows below to the acceptance table for this wave.

## The shape of the flow

1. The user selects the shapes of a flowchart on the canvas.
2. The **properties panel** — the library's shape-actions panel (`packages/excalidraw/components/Actions.tsx`, rendered into `.selected-shape-actions-container`) — gains an **Animation** section. It appears when the selection holds **two or more** elements, because a one-element selection has no flow.
3. The section offers: the **step duration** (a number input, milliseconds, default 1200), a **loop** toggle (on by default), and a **Play** button.
4. Pressing Play enters the **animation**: a DOM overlay over the canvas walks the steps in turn. The focused step is **enlarged**, the elements in it **animate** (a fade and a rise — a small, fixed set of transitions, deliberately), and when the last step is done the whole thing **loops** back to the first.
5. The overlay takes over the pointer, so the canvas cannot be edited mid-animation. **Escape**, or the overlay's close button, ends it and gives the canvas back.

## Reading the flow from the canvas

The one decision that needs care: a flowchart on an Excalidraw canvas is ordinary shapes and ordinary arrows.

**The steps are the selected elements; the order comes from the arrows.**

- an **arrow** that is also in the selection, whose start and end are bound to two of the selected shapes, says "these two shapes are consecutive". The bindings live in `element.startBinding` / `element.endBinding` on the arrow, and `boundElements` on the shapes point back;
- the order is a **topological sort** of the shapes over those arrow edges;
- where the arrows do not decide, the tie is broken by **reading order**: top to bottom, then left to right;
- a **cycle** is not an error — the loop is part of the animation — so a cycle is broken at its lowest-reading-order member and that step is repeated.

**With no arrows at all**, the steps are the selected elements in reading order. That makes the feature useful on a plain list of shapes, which is what a flow usually is before the arrows are drawn.

The reading order and the topological sort are **pure functions** in `packages/excalidraw/scene/flowOrder.ts`, so they are testable without a canvas.

## The overlay

The overlay is a **DOM layer over the canvas**, exactly like the animated-image overlay (`packages/excalidraw/components/AnimatedImageOverlay.tsx`):

- the canvas keeps drawing the flowchart — the overlay does **not** replace the canvas;
- the overlay draws the **focus** treatment: the focused step's shapes are outlined, and the overlay's own copy of them is scaled up about their centre;
- the overlay's position is computed with the library's own `sceneCoordsToViewportCoords` — the same oracle the animated-image overlay uses;
- the overlay is mounted from `App.tsx`, next to the animated-image overlay;
- the overlay is **transient**: nothing about the animation is written into the document.

## The files you own

Everything below is inside the task scope `packages/excalidraw,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/scene/flowOrder.ts` | new | the pure step order: arrows first, reading order as the tie-break |
| `packages/excalidraw/components/FlowAnimationOverlay.tsx` | new | the DOM overlay |
| `packages/excalidraw/components/FlowAnimationSection.tsx` | new | the properties-panel section |
| `packages/excalidraw/components/Actions.tsx` | changed | mount the section |
| `packages/excalidraw/components/App.tsx` | changed | mount the overlay |
| `packages/excalidraw/locales/en.json` | changed | the strings |
| `packages/excalidraw/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-42, D-43, D-44 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-48 | `packages/excalidraw/tests/` | The step order follows the **arrows**: a shape with an arrow into it comes after the shape the arrow leaves. |
| AC-49 | `packages/excalidraw/tests/` | With no arrows, the steps are the selected elements in **reading order**. |
| AC-50 | `packages/excalidraw/tests/` | The overlay's position for a shape equals the position the canvas would use, **through `sceneCoordsToViewportCoords`** — an oracle, never a re-derivation. |
| AC-51 | `packages/excalidraw/tests/` | Playing the animation **changes nothing in the document**: no element is added, changed or removed. |
| AC-70 | `packages/excalidraw/tests/` | The auto-layout **moves the selected shapes** into a layered arrangement and does so as a normal, undoable scene mutation — and the animation's step order still follows the drawing's arrows afterwards. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-48 the step order follows the arrows', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## The house rules

- `yarn`, never `npm` or `bun`. **No new dependency beyond the approved `dagre`** — and no tweening library. `dagre` is already installed; use the installed copy.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has (`getCommonBounds`, `sceneCoordsToViewportCoords`).
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your four new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the arrows are ignored in the step order, (b) the overlay is positioned with a re-derived formula instead of the oracle, (c) playing the animation mutates the scene. Record what you broke and what failed — the orchestrator needs that in the close note.
