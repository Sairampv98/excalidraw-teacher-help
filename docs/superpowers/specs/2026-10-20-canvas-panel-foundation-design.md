# Canvas Panel Foundation

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** the shared primitive behind user items 6, 7, 10 and 11 **Depends on:** `2026-10-20-page-document-model-design.md` (Wave 1)

---

## 1. Why this document exists

Four of the user's requests are, underneath, the same request:

| Item | What was asked | The shape underneath |
| --- | --- | --- |
| 6 | Mirror a live VS Code editor onto the canvas; lock it into a screenshot; crop; OCR | a live surface on the canvas |
| 7 | Put a video on the canvas; captions beside it; lock into a screenshot; crop; OCR | a live surface on the canvas |
| 10 | Show the video and the live editor in the presenter window | live surfaces, mirrored to a second window |
| 11 | Make a flowchart come alive — the focused part enlarges, components animate, loops | a live surface on the canvas |

Building four separate mechanisms would write the same four pieces four times: placement, resize handles, a lock transition, a crop tool, a screenshot pipeline, and an OCR hook. This document specifies that machinery **once**. The per-feature specs then only describe what a panel _contains_.

The shared vocabulary this document introduces:

- **Panel** — a canvas-resident, resizable, positionable object whose content is a live DOM/React subtree rather than scene geometry.
- **Panel content** — one of a small set of _kinds_ (code mirror, video, flowchart, image viewer).
- **Lock** — a panel transitioning from _live_ to _locked_. Locked panels render a static poster image and become ordinary, exportable, OCR-able canvas content.

## 2. Goals

1. One primitive serves items 6, 7 and 11, and is what the presenter (item 10) mirrors.
2. A panel is a **first-class canvas citizen**: selectable, movable, resizable, on a page, undoable, saveable, and exportable.
3. Locking a panel produces a **full-resolution** poster image — not a screen-grab of the small on-canvas rectangle.
4. Locking is reversible.
5. Locked panels can be cropped, and the crop can be OCR'd.

## 3. Non-goals

- The content kinds themselves. Those are specified in the per-feature documents.
- Wave 1's page model. This document assumes pages exist and that a panel belongs to one page.
- Any new dependency. The panel primitive uses only what the repo already has.

## 4. The existing pattern this is built on

The fork already has exactly one thing of this shape: **animated images**.

`packages/element/src/renderElement.ts` deliberately **skips** animated images on the canvas (an early `break`, ~908-921), and `packages/excalidraw/components/AnimatedImageOverlay.tsx` draws them as DOM `<img>` elements layered over the canvas, positioned by `packages/excalidraw/scene/animatedImageOverlay.ts` `animatedImageTransform` (~92-118).

Three properties of that pattern are directly reusable:

- The canvas **skips** the object, so there is no half-drawn double image.
- The DOM layer is positioned from the **same** camera the canvas uses, so overlay and canvas cannot disagree. (`HANDOVER.md` §2 records the bug this prevents: `pages.ts` once used the wrong scroll sign while `packages/common/src/utils.ts` was correct.)
- The overlay is mounted once, in `App.tsx` (~2390-2411), and driven from the renderable-element list.

What the GIF pattern does **not** have, and what a panel needs:

- It is **viewport-space**: the overlay tracks the camera; it is not placed at a scene coordinate.
- It has **no** user-facing chrome (no selection, no resize handles, no lock).
- It **cannot** be exported — the canvas has no pixels for it.

## 5. Design

### 5.1 The panel element

A panel is a **new element type**, `panel`. It lives in the normal element array, carries a `pageId` like every other element, and participates in selection, movement, resizing, undo and z-order with no special-casing beyond the type dispatch points that every new type must learn.

```ts
export type ExcalidrawPanelElement = ExcalidrawElement & {
  type: "panel";
  /** Which content kind this panel hosts. */
  panelKind: PanelKind;
  /** Panel content state, keyed by kind. See 5.3. */
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

**Why a new element type rather than a side table in `appState`:** a panel must be selectable with the normal tools, must move and resize, must be undoable, must land on the right page, and must appear in the export. Those are all element behaviours. An `appState` side table would have to re-implement selection, hit-testing, bounds and export for a second object model — strictly more work than teaching the type dispatch about one more type.

The cost is the enumeration of every dispatch point that switches on element type. That enumeration is the single largest risk in this design and is the reason §8 makes it an explicit, gated step.

### 5.2 Rendering

Exactly the GIF pattern, extended:

- **Live panel** — `renderElement.ts` skips it (an early `break`, as for animated images). The DOM overlay renders the content, positioned from the element's scene coordinates through the **same** camera conversion the canvas uses.
- **Locked panel** — the canvas paints the poster image at the panel's bounds, exactly as it paints an ordinary image element. The overlay skips it.

This gives the user the behaviour they asked for with no new render path: a locked panel is an image on the canvas, so it exports to PNG/SVG/PDF like any image, and the existing code-card and image insertion machinery already knows how to place one.

### 5.3 Panel content

```ts
export type PanelKind = "code" | "video" | "flow" | "image";

export type PanelContent =
  | { kind: "code"; source: PanelSource }
  | { kind: "video"; source: PanelSource; captions?: CaptionTrack }
  | { kind: "flow"; source: PanelSource; doc: FlowDocument }
  | { kind: "image"; source: PanelSource };

/** Where the content comes from, and whether it can be re-created after a reload. */
export type PanelSource =
  /** Live from the local bridge process (item 6). Not re-creatable after a reload. */
  | { type: "bridge"; sessionId: string }
  /** A file in the document's files store. Re-creatable. */
  | { type: "file"; fileId: BinaryFileID; mimeType: string }
  /** A document-local, serialisable payload. Re-creatable. */
  | { type: "inline"; payload: unknown };
```

The `source.type` distinction is load-bearing:

- A **bridge** panel is a _view onto a live session_. Reloading the document cannot re-create it, because the bridge is a separate process. A bridge panel therefore saves as a placeholder plus its last poster image, and shows a "reconnect" affordance until the bridge returns.
- A **file** or **inline** panel is fully self-contained and survives a reload.

### 5.4 Locking — the full-resolution requirement

The user was explicit that a locked panel must not be a grainy screen-grab of a small on-canvas rectangle. The fix is structural: **a lock never captures the DOM**.

- **Video panel** — the `<video>` element's frame is drawn into an offscreen canvas at the video's **intrinsic** resolution (`videoWidth` x `videoHeight`), then cropped from there. The on-canvas display size is irrelevant to the output resolution.
- **Code panel** — the content is rendered from the **source text** at an export scale (or read directly as text), not screen-grabbed.
- **Flow panel** — the flow document is rendered to a canvas at export scale.

Only a panel whose content genuinely exists as pixels (an arbitrary third-party DOM) has to fall back to DOM capture, and that fallback is explicitly lower quality.

Locking therefore produces a poster image at the content's native resolution, stored in the existing files store as a normal binary file. Locking is reversible because `panel` content is retained on the element (§5.1).

### 5.5 Cropping

Cropping operates on the **poster image**, not on the live content — so it works identically for a locked panel and for an image the user captured from anywhere.

The crop UI is a modal with a darkened backdrop, as the user described: drag a region over the poster, confirm, and the result becomes a **new image element** on the current page. The panel itself is left untouched, so cropping a locked panel gives you a copy without destroying the panel.

### 5.6 OCR

OCR is a **service call**, not an in-page operation. The panel spec therefore defines only the contract:

```ts
export type OcrRequest = {
  imageFileId: BinaryFileID;
  /** Optional region of interest, in image pixels. */
  region?: { x: number; y: number; width: number; height: number };
  language?: string;
};

export type OcrResult = {
  text: string;
  /** Per-line boxes, so the result can be placed as individual text elements. */
  lines: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  confidence: number;
  durationMs: number;
};
```

The result can be placed as a text element, or split into per-line text elements positioned over the cropped image — which is the "extract the text and paste it in" flow the user described.

The **implementation and cost of the OCR service** belong to the video/editor specs, not here.

### 5.7 Selection chrome

Panels need the same affordances the user's dock system already provides for editor chrome (`excalidraw-app/dock/`): a selection outline, a move handle, and a **lock** toggle.

Per the user: "clicking the lock button to revert back from locked state". The lock control is a button on the panel's floating toolbar, alongside the existing hide/move affordances so the interaction is consistent with the dock system the user already knows.

When a panel is selected, the toolbar also offers a **preset position and size** menu (the user asked for "a preset of positions and its size") — half-left, half-right, half-top, half-bottom, full page.

### 5.8 Presenter support (item 10)

The presenter already mirrors the scene and already has a template for showing live content: the GIF overlay. The presenter therefore gains the same panel overlay, driven by the same scene state, and a **video panel in the presenter plays the same video in sync** — because the video element's current time is part of the panel's state, and the presenter applies the same offset.

This is specified in detail in `2026-10-20-presenter-panels-design.md`.

## 6. Component boundaries

Each box below is a unit with one job.

| Component | Lives in | Job |
| --- | --- | --- |
| `PanelElement` | `packages/element/src/types.ts` | The element type and its payload |
| `panelContent.ts` | `packages/excalidraw/scene/` | Pure helpers: resolve a panel's source into something renderable |
| `PanelOverlay` | `packages/excalidraw/components/` | The DOM layer, mirroring `AnimatedImageOverlay` |
| `PanelChrome` | `packages/excalidraw/components/` | Selection outline, move handle, lock button, preset menu |
| `lockPanel.ts` | `packages/excalidraw/scene/` | Pure: panel + content -> poster image spec (resolution rules live here) |
| `cropModal` | `excalidraw-app/components/` | The dark-backdrop crop UI |
| `ocrClient` | `excalidraw-app/` | Speaks the `OcrRequest`/`OcrResult` contract to the service |

The split rule: **anything that decides geometry is pure and lives in `packages/`; anything that touches the DOM lives in `components/`; anything that talks to a local process lives in `excalidraw-app/`.**

## 7. Data flow

```
user action (lock)
   -> lockPanel.ts (pure): decides target resolution, returns a poster spec
   -> the content owner draws into an offscreen canvas at that resolution
   -> the result is stored in the files store as a binary file
   -> the element is mutated: locked = true, posterFileId = <fileId>
   -> normal element machinery takes over (selection, export, undo)

user action (crop)
   -> cropModal reads the poster image
   -> user drags a region
   -> the cropped region becomes a new image element on the current page

user action (OCR)
   -> ocrClient posts an OcrRequest to the OCR service
   -> the service returns OcrResult
   -> the app places the text (as one element, or per-line elements over the crop)
```

## 8. The gate: enumerate every element-type dispatch before writing code

Adding an element type is the one change in this document that can break things silently. Before any implementation begins, the complete list of places that switch on element type must be enumerated and each one must be given a decision: _handle it_, or _explicitly reject it_.

The enumeration is produced as a dedicated, reviewable artefact before implementation:

```
docs/superpowers/specs/2026-10-20-panel-type-dispatch-checklist.md
```

That checklist is a **hard gate**: no panel code is written until every dispatch point has a recorded decision. A dispatch point that is silently skipped is how a panel ends up un-selectable, un-exportable or un-serialisable.

## 9. Testing strategy

Per the project rules: oracle-based assertions, and **teeth checks** — every fix is verified by reverting it and confirming the test fails.

| Test | Asserts |
| --- | --- |
| panel element round-trip | a panel survives save -> restore with `locked`, `panelKind`, `panel` payload and `posterFileId` intact |
| live panel is not painted | the canvas render for a live panel draws nothing (the overlay draws it) |
| locked panel is painted | the canvas render for a locked panel draws the poster at the panel's bounds |
| overlay position | the panel overlay's screen position equals the position the canvas would use, **through `sceneCoordsToViewportCoords`** (oracle-based, never a re-derivation) |
| lock resolution | locking a video panel produces a poster at the video's `videoWidth` x `videoHeight`, regardless of the on-canvas display size |
| lock reversibility | locking then unlocking restores the live panel and its content |
| crop | cropping a poster yields a new image element on the current page and leaves the panel untouched |
| OCR contract | the app's request/response shape matches the service contract; a failed OCR is reported, not swallowed |
| dispatch coverage | for every entry in the §8 checklist, a test asserts the panel behaves as the recorded decision says |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| A missed element-type dispatch leaves the panel half-functional | The §8 checklist gate, plus the dispatch-coverage test |
| The DOM overlay and the canvas disagree about position | Both use the library's own conversion; the overlay test asserts against `sceneCoordsToViewportCoords` |
| A live panel is invisible in exported PNG/PDF | Locked panels are images and export normally; live panels are documented as export-as-poster |
| A bridge panel is meaningless after a reload | `source.type` makes this explicit; a bridge panel saves its poster and shows a reconnect affordance |
| The panel overlay adds per-frame cost | The overlay must not re-render per pointermove; it is keyed on the panel set, not on every scene change |
| New element type breaks the published library API | Acceptable in a fork; the type is additive and upstream-compatible (unknown props are preserved) |

## 11. Success criteria

1. A panel can be placed on a page, moved, resized, and locked; locking produces a poster at the content's native resolution.
2. Locking is reversible.
3. A locked panel exports to PNG/SVG/PDF like an ordinary image.
4. A crop of a locked panel produces a new image element.
5. The OCR contract is implemented end to end against a stub service.
6. Every element-type dispatch has a recorded decision, and a test asserts each one.

## 12. Ordering

This foundation is **Wave 3**, after Wave 1 (page model) and Wave 2 (the image-stamping and draw-performance bugs). The per-feature specs that build on it:

- `2026-10-20-vscode-bridge-design.md` — item 6
- `2026-10-20-video-panel-design.md` — item 7
- `2026-10-20-presenter-panels-design.md` — item 10
- `2026-10-20-animated-flowcharts-design.md` — item 11
