# Builder brief — Wave 6c, the flowchart animation from the properties panel

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's item 11:

> "i saw that there is a library called as reactflow or sveltflow which are used to create the animations in which flowcharts become live and the current part of flowchart that is shown becomes enlarged or pops up and there are components in it that animate and this entire thing is in a loop, think how we can implement that in this excalidraw fork/custom build?"

The owner's decision (2026-10-21, question 9): the animation is an **overlay model**, triggered from a **properties-panel section** — "no collaborator".

The full design is `docs/superpowers/specs/2026-10-21-flow-animation-design.md`. **Read it first.** It records where this **supersedes** the earlier `2026-10-20-animated-flowcharts-design.md`: that one proposed a dedicated flow _panel element_; the owner chose a properties-panel section and an overlay, so there is **no new element type** here and nothing is written into the document.

## The auto-layout — approved, and in scope

**The owner approved this on 2026-10-21** ("ok install dagre"). It was previously listed as out of scope because it needed a new dependency; it no longer does.

**`dagre` (`0.8.5`) is installed** as a runtime dependency of `packages/excalidraw`, with `@types/dagre` (`0.7.54`) for its types. Locked as **D-31** in `SPEC.md`. **Use the installed copy — do not add the dependency again**, and do not fetch dagre from a CDN.

The layout is a **normal scene mutation**: it moves the elements, so it is undoable, saved, and visible in the editor. That is a real advantage over React Flow, where the layout is internal.

**Why the layout matters for the animation:** the step order comes from the arrows. A layout that is not the author's own would draw arrows between nodes that are not neighbours, so the order would be the layout's rather than the drawing's. So the layout is **one step the user asks for**, and the animation's order is read from the drawing afterwards.

**The layout is optional.** With no layout applied, the animation reads the drawing as it is — which is the point of the arrows. The properties-panel section offers "Lay this out" as a separate action from "Play".

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-42 | The animation is **configured in a section of the properties panel** and **played as an overlay** over the canvas. It is not a panel element: the user's flowchart stays ordinary shapes and arrows, and playing the animation changes nothing in the document. |
| D-43 | The **steps are the selected elements**, ordered by the **arrows** between them (a topological sort over the arrow bindings), with reading order as the tie-break. A cycle is the animation's loop, not an error. |
| D-44 | The overlay **does not replace the canvas**: the canvas keeps drawing the flowchart, and the overlay adds the focus treatment on top. Its position comes from the library's own `sceneCoordsToViewportCoords`. |

Add these three rows to `SPEC.md` in the Decisions table, and the four acceptance rows below to the acceptance table for this wave.

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
