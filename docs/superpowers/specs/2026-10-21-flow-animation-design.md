# Design — the flowchart animation, triggered from the properties panel

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

The fork owner's item 11:

> "i saw that there is a library called as reactflow or sveltflow which are used to create the animations in which flowcharts become live and the current part of flowchart that is shown becomes enlarged or pops up and there are components in it that animate and this entire thing is in a loop, think how we can implement that in this excalidraw fork/custom build?"

The owner's decision (2026-10-21, question 9):

> the animation is an **overlay model**, triggered from a **properties-panel section** — "no collaborator".

That decision changes the shape of the earlier design (`docs/superpowers/specs/2026-10-20-animated-flowcharts-design.md`), which proposed a dedicated **flow panel element**. This document records the shape the owner actually chose, and it supersedes that document on the two points where they differ:

| Point | The 2026-10-20 design | The owner's decision |
| --- | --- | --- |
| where the animation is configured | a panel element on the canvas | a **section in the properties panel** |
| what the animation is | a panel element's content | an **overlay** over the canvas |

**The consequences are good ones.** The animation needs no new element type, nothing is saved with the document, and the flowchart stays exactly what the user drew — ordinary shapes and arrows they can still edit.

## The shape of the flow

1. The user selects the shapes of a flowchart on the canvas.
2. The **properties panel** — the library's shape-actions panel (`packages/excalidraw/components/Actions.tsx`, rendered into `.selected-shape-actions-container`) — gains an **Animation** section. It appears when the selection holds **two or more** elements, because a one-element selection has no flow.
3. The section offers: the **step duration**, a **loop** toggle, and a **Play** button.
4. Pressing Play enters the **animation**: a DOM overlay over the canvas walks the flowchart's steps in turn. The focused step is **enlarged**, the elements in it **animate**, and when the last step is done the whole thing **loops** back to the first.
5. The overlay takes over the pointer, so the user cannot edit the canvas mid-animation. Pressing **Escape**, or clicking the overlay's close button, ends it and gives the canvas back.

## Reading the flow from the canvas

This is the part that needs a decision, because a flowchart on an Excalidraw canvas is ordinary shapes and ordinary arrows.

**The steps are the selected elements; the order comes from the arrows.**

- An **arrow** that is also in the selection, whose start and end are bound to two of the selected shapes, says "these two shapes are consecutive". Arrows carry their bindings in `element.startBinding` / `element.endBinding` (`boundElements` on the shapes point back).
- The order is therefore a **topological sort** of the shapes over those arrow edges.
- Where the arrows do not decide (a shape with no incoming arrow, or a cycle), the tie is broken by **reading order**: top to bottom, then left to right. A cycle — a flowchart that loops back on itself — is **not** an error: the loop is part of the animation, so a cycle is broken at its lowest-reading-order member and the animation repeats that step.

**When there are no arrows at all**, the steps are simply the selected elements in reading order. That makes the feature useful on a plain list of shapes, which is what a "flow" usually is before the user has drawn the arrows.

The reading order and the topological sort are **pure functions** in `packages/excalidraw/scene/flowOrder.ts`, so they can be tested without a canvas.

## The overlay

The overlay is a **DOM layer over the canvas**, exactly like the animated-image overlay (`packages/excalidraw/components/AnimatedImageOverlay.tsx`):

- the canvas keeps drawing the flowchart as usual — the overlay does **not** replace the canvas;
- the overlay draws the **focus** treatment: the focused step's shapes are outlined, and the overlay's own copy of them is **scaled up** about their centre;
- the overlay's position is computed with the library's own `sceneCoordsToViewportCoords` — the same oracle the animated-image overlay uses, so the overlay and the canvas cannot disagree about where a shape is;
- the "components animate" part is a small, fixed set of entrance transitions (a fade and a rise), applied to the elements of the focused step. It is deliberately simple: the point is that the focused part **comes alive**, not that there is a physics engine.

The overlay is mounted from `App.tsx`, next to the animated-image overlay, and it is **transient**: nothing about the animation is written into the document, so the user's file is unchanged by playing it.

## The properties-panel section

The section lives in the library's shape-actions panel (`packages/excalidraw/components/Actions.tsx`), because that is where Fill, Stroke, Sliders and the rest live, and the owner asked for "a section in the properties panel".

It shows only when:

- the selection holds **two or more** elements, and
- the app has not turned the feature off.

The controls are: a **step duration** (a number input, in milliseconds, defaulting to 1200), a **loop** toggle (on by default), and a **Play** button.

**The section is the fork's, so it needs the fork's own labels** — the strings go in `packages/excalidraw/locales/en.json` next to the other fork strings.

## The locked decisions

| Row | The decision in one line |
| --- | --- |
| D-42 | The animation is **configured in a section of the properties panel** and **played as an overlay** over the canvas. It is not a panel element: the user's flowchart stays ordinary shapes and arrows, and playing the animation changes nothing in the document. |
| D-43 | The **steps are the selected elements**, ordered by the **arrows** between them (a topological sort over the arrow bindings), with reading order as the tie-break. A cycle is the animation's loop, not an error. |
| D-44 | The overlay **does not replace the canvas**: the canvas keeps drawing the flowchart, and the overlay adds the focus treatment on top. Its position comes from the library's own `sceneCoordsToViewportCoords`. |

Add these three rows to `SPEC.md` in the Decisions table, and the acceptance rows below to the acceptance table for this wave.

## The files

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

| Row | What it checks | File |
| --- | --- | --- |
| AC-48 | The step order follows the **arrows**: a shape with an arrow into it comes after the shape the arrow leaves. | `packages/excalidraw/tests/` |
| AC-49 | With no arrows, the steps are the selected elements in **reading order**. | `packages/excalidraw/tests/` |
| AC-50 | The overlay's position for a shape equals the position the canvas would use, **through `sceneCoordsToViewportCoords`** — an oracle, never a re-derivation. | `packages/excalidraw/tests/` |
| AC-51 | Playing the animation **changes nothing in the document**: no element is added, changed or removed. | `packages/excalidraw/tests/` |

## Rejected alternatives

- **A dedicated flow panel element.** Rejected by the owner (question 9): the trigger is a properties-panel section, and the animation is an overlay.
- **A separate animation window.** Rejected: the owner wants the flowchart to come alive _on the canvas_, and a second window would have to re-render the document.
- **A real physics / tweening engine.** Rejected: no new dependency, and a fixed set of transitions conveys the same thing.
- **Auto-layout with `dagre`.** Out of scope for this wave: it needs a **new dependency**, which the project's rules forbid without the owner's explicit approval. The animation does not need it — the user draws the flowchart, arrows and all.
- **Reading the flow from a code block.** Deferred: it is a refinement on top of a working animation, and it needs the parsing the panel element would have carried.
