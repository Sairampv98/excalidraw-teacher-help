# Builder brief — Wave 5a, the panel element foundation

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The foundation behind four of the fork owner's eleven items:

| Item | What was asked | The shape underneath |
| --- | --- | --- |
| 6 | Mirror a live VS Code editor onto the canvas; lock it into a screenshot; crop; OCR | a live surface on the canvas |
| 7 | Put a video on the canvas; captions beside it; lock into a screenshot; crop; OCR | a live surface on the canvas |
| 10 | Show the video and the live editor in the presenter window | live surfaces, mirrored to a second window |
| 11 | Make a flowchart come alive — the focused part enlarges, components animate, loops | a live surface on the canvas |

Building four separate mechanisms would write the same four pieces four times: placement, resize handles, a lock transition, a crop tool, a screenshot pipeline, and an OCR hook. **This wave specifies that machinery once.** The per-feature waves then only describe what a panel _contains_.

The full design is `docs/superpowers/specs/2026-10-20-canvas-panel-foundation-design.md`. **Read it first** — it carries the vocabulary, the element type, the rendering rules, the locking resolution rules and the test strategy.

The per-feature designs that build on this one (read the relevant one when you get to that wave): `2026-10-20-vscode-bridge-design.md`, `2026-10-20-video-panel-design.md`, `2026-10-20-presenter-panels-design.md`, `2026-10-20-animated-flowcharts-design.md`.

## The hard gate: the dispatch checklist comes FIRST

Adding an element type is the one change in this design that can break things **silently**. Before any panel code is written, the complete list of places that switch on element type must be enumerated, and each one must be given a decision: _handle it_, or _explicitly reject it_.

**Your first deliverable is that enumeration**, as a reviewable artefact:

```
docs/superpowers/specs/2026-10-20-panel-type-dispatch-checklist.md
```

One row per dispatch point: where it is (file:line), what it does today, and the decision for panels. A dispatch point that is silently skipped is how a panel ends up un-selectable, un-exportable or un-serialisable. Do not write panel code until the checklist is complete.

Find the dispatch points by searching the repository for switches on the element `type` — for example `element.type === "..."`, `case "..."` over a type union, and the type unions themselves (`ExcalidrawElement` and its members). The type union is in `packages/element/src/types.ts`; the renderer in `packages/element/src/renderElement.ts`; the rest are spread across the library and the app.

## The element type

```ts
export type ExcalidrawPanelElement = ExcalidrawElement & {
  type: "panel";
  /** Which content kind this panel hosts. */
  panelKind: PanelKind;
  /** Panel content state, keyed by kind. */
  panel: PanelContent;
  /** Live mode: content is rendered by the DOM overlay. */
  locked: false;
} & {
  /** Locked mode: the poster image replaces the live content. */
  locked: true;
  /** fileId of the poster image in the files store. */
  posterFileId: BinaryFileID;
  /** The live content this panel was locked from, kept so locking is reversible. */
  panel: PanelContent;
};
```

Discriminating on `locked` keeps the two modes mutually exclusive at the type level, so a panel can never be half-live and half-poster.

```ts
export type PanelKind = "code" | "video" | "flow" | "image";

export type PanelContent =
  | { kind: "code"; source: PanelSource }
  | { kind: "video"; source: PanelSource; captions?: CaptionTrack }
  | { kind: "flow"; source: PanelSource; doc: FlowDocument }
  | { kind: "image"; source: PanelSource };

export type PanelSource =
  | { type: "bridge"; sessionId: string } // live from the local bridge; not re-creatable after a reload
  | { type: "file"; fileId: BinaryFileID; mimeType: string } // in the document's files store; re-creatable
  | { type: "inline"; payload: unknown }; // document-local, serialisable; re-creatable
```

The `source.type` distinction is load-bearing: a **bridge** panel is a view onto a live session and cannot be re-created after a reload, so it saves as a placeholder plus its last poster image and shows a "reconnect" affordance until the bridge returns. A **file** or **inline** panel is self-contained and survives a reload.

## The rendering rules

Exactly the GIF pattern, extended:

- **live panel** — the canvas **skips** it (an early `break`, as for animated images) and the DOM overlay draws it, positioned from the element's scene coordinates through the **same** camera conversion the canvas uses;
- **locked panel** — the canvas paints the poster image at the panel's bounds, exactly as it paints an ordinary image element, and the overlay skips it.

The pattern to copy is `packages/excalidraw/components/AnimatedImageOverlay.tsx` plus `packages/excalidraw/scene/animatedImageOverlay.ts`, mounted from `App.tsx`. **The DOM layer is positioned from the same camera the canvas uses, so overlay and canvas cannot disagree.**

A locked panel is an image on the canvas, so it exports to PNG/SVG/PDF like any image.

## The component boundaries

The split rule: **anything that decides geometry is pure and lives in `packages/`; anything that touches the DOM lives in `components/`; anything that talks to a local process lives in `excalidraw-app/`.**

| Component | Lives in | Job |
| --- | --- | --- |
| `PanelElement` | `packages/element/src/types.ts` | the element type and its payload |
| `panelContent.ts` | `packages/excalidraw/scene/` | pure helpers: resolve a panel's source into something renderable |
| `PanelOverlay` | `packages/excalidraw/components/` | the DOM layer, mirroring `AnimatedImageOverlay` |
| `PanelChrome` | `packages/excalidraw/components/` | selection outline, move handle, lock button, preset menu |
| `lockPanel.ts` | `packages/excalidraw/scene/` | pure: panel + content -> poster image spec |
| `cropModal` | `excalidraw-app/components/` | the dark-backdrop crop UI |
| `ocrClient` | `excalidraw-app/` | speaks the `OcrRequest`/`OcrResult` contract |

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-30 | A panel is a **new element type** (`panel`), not a side table in appState: it must be selectable with the normal tools, move and resize, be undoable, land on the right page, and appear in the export — all of which are element behaviours. |
| D-31 | A panel is **live or locked, never both**: the type discriminates on `locked`, so a panel cannot be half-live and half-poster. The live content is kept so locking is reversible. |
| D-32 | The **DOM overlay** renders the live panel, positioned through the **same** camera conversion the canvas uses — the same rule the animated-image overlay follows, so overlay and canvas cannot disagree. |
| D-33 | Locking a panel **never captures the DOM**: the poster is produced from the content's own source at the content's **native** resolution, so a locked panel is not a grainy screen-grab of the on-canvas rectangle. |
| D-34 | The **crop** operates on the poster image, not on the live content, and produces a **new image element** on the current page — the panel itself is left untouched, so cropping a locked panel gives a copy without destroying the panel. |

Add these five rows to `SPEC.md` in the Decisions table, and the acceptance rows below to a new **Acceptance — Wave 5** table.

## The acceptance rows

| Row | What it checks | File |
| --- | --- | --- |
| AC-35 | A panel **survives save -> restore** with `locked`, `panelKind`, the `panel` payload and `posterFileId` intact. | `packages/excalidraw/tests/` |
| AC-36 | A **live** panel is not painted by the canvas, and a **locked** panel is painted at the panel's bounds. | `packages/excalidraw/tests/` |
| AC-37 | The panel overlay's screen position equals the position the canvas would use, **through `sceneCoordsToViewportCoords`** — an oracle, never a re-derivation. | `packages/excalidraw/tests/` |
| AC-38 | Locking a panel produces a poster at the content's **native** resolution, regardless of the on-canvas display size, and locking is **reversible**. | `packages/excalidraw/tests/` |
| AC-39 | Cropping a poster yields a **new image element on the current page** and leaves the panel untouched. | `excalidraw-app/tests/` |
| AC-40 | For **every** entry in the dispatch checklist, a test asserts the panel behaves as the recorded decision says. | `packages/excalidraw/tests/` |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-35 a panel survives a save and restore round trip', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## The files you own

Everything below is inside the task scope `packages/element,packages/excalidraw,excalidraw-app,SPEC.md,docs/superpowers/specs`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/element/src/types.ts` | changed | the `panel` element type |
| `packages/excalidraw/scene/panelContent.ts` | new | pure helpers |
| `packages/excalidraw/scene/lockPanel.ts` | new | pure: the poster image spec |
| `packages/excalidraw/components/PanelOverlay.tsx` | new | the DOM layer |
| `packages/excalidraw/components/PanelChrome.tsx` | new | the selection chrome |
| `packages/excalidraw/components/App.tsx` | changed | mount the overlay, and the dispatch points the checklist names |
| `packages/element/src/renderElement.ts` | changed | skip a live panel, paint a locked one |
| `excalidraw-app/components/cropModal.tsx` | new | the crop UI |
| `excalidraw-app/ocrClient.ts` | new | the OCR service client (against a stub service) |
| `docs/superpowers/specs/2026-10-20-panel-type-dispatch-checklist.md` | new | the gate artefact |
| `packages/excalidraw/tests/`, `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-30..D-34 and the acceptance rows |

The dispatch checklist will name further files — every one of them must be inside the scope above. If the checklist turns up a file outside it, **stop and report it** rather than editing it.

## The house rules

- `yarn`, never `npm` or `bun`. **No new dependency.** Everything the foundation needs is already in the repo.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your six new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the live panel is painted by the canvas, (b) the overlay is positioned with a re-derived formula instead of the oracle, (c) the poster is captured from the DOM instead of at the content's native resolution, (d) the crop deletes the panel. Record what you broke and what failed — the orchestrator needs that in the close note.
