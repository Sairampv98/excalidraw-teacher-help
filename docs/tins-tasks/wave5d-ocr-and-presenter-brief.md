# Builder brief — Wave 5d, OCR as an in-app capability, and the presenter panels (item 10)

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

Two things the owner asked for, that share the OCR service and the presenter channel.

**Item 10, part 1 — the presenter shows the panels.**

> "presenter should show these video playing like it does so for gif's right now and the live code editor"

**Item 10, part 2 — OCR as an in-app capability.**

The owner's decision (2026-10-21, question 7): OCR is a **separate capability built into the app**, offered as an option — not a service the user has to run.

**And the owner's decision on the presenter code panel (question 8): it is READ-ONLY.**

**This wave depends on the canvas-panel foundation** (Wave 5a). Read that design and the Wave 5a code before starting. If the foundation is not in the tree yet, **stop and report it**.

The two designs are `docs/superpowers/specs/2026-10-20-presenter-panels-design.md` and `docs/superpowers/specs/2026-10-20-video-panel-design.md` (§5.6 for the OCR contract and the benchmark). **Read both.**

## The good news: a read-only mirror needs no new transport

The presenter's channel already carries the whole scene. So:

- a **code card** is already real text elements — a read-only code mirror in the presenter is just more text elements, and it arrives with **no protocol change at all**;
- a **locked** video panel is an ordinary image element with a poster — it arrives over the existing scene path;
- only **live** panels need new transport, because a live panel's content is not scene geometry.

The presenter already mounts a **whole second Excalidraw instance** (`<Excalidraw viewModeEnabled>` in `PresenterView.tsx`), so **the panel overlay mounts there exactly as it does in the editor** — the overlay picks the panels up from the same renderable-element list the GIF overlay uses. **No new transport for panels.** That is the single biggest simplification in the design, and it is worth protecting.

## The video sync

A video panel's playback position is state that must be shared, so the panel element carries:

```ts
/** Playback position in seconds, for panels whose content is time-based. */
playback?: { time: number; playing: boolean };
```

- the **editor** writes it on a coarse tick (~4 Hz), not every frame — the scene message is throttled to 40 ms and carries the whole element list;
- the presenter **applies** it and **interpolates** locally between updates (using `video.playbackRate` and `requestVideoFrameCallback` if available), so the video stays smooth without flooding the channel;
- the presenter must **not** write playback back to the editor — otherwise the two windows fight;
- if the presenter has no video panel on the current page, it does nothing.

## The video bytes

**Blocker, and it is a real one:** `BinaryFileData.mimeType` is restricted to `IMAGE_MIME_TYPES` (`packages/element/src/types.ts`), so a video's mime type **cannot** travel the existing `presenter:files` message as it stands.

**Decision: widen `BinaryFileData` to accept video mime types.** The channel already has a working binary path; a second message type would duplicate it. Video files are large, so keep the transfer chunk-free but add a **size guard**.

A video panel does not have to ship its bytes at all if the presenter can reach the same source: a `file` source is a reference into the document's files store, and the presenter requests it exactly as it requests image files today.

## The live code panel in the presenter

The presenter is `viewModeEnabled`, so an interactive editor **cannot** be an Excalidraw element — it must be a separate DOM panel.

**Read-only is the default, and it is what this wave ships.** The panel shows the mirrored content and the presenter cannot type into it. **No protocol change.**

The interactive mode (a new `presenter:input` message, an editor-side handler, a presenter-side post path) is **explicitly out of scope**: input focus, cursor position, IME and undo are a meaningfully larger surface, and the owner asked for a read-only panel.

## OCR as an in-app capability

The owner asked for OCR "as a separate service" and then decided (question 7): a **separate capability built into the app**, offered as an option.

**Where it runs.** The OCR engine is `tesseract.js` (WASM) in the **bridge's Node process** — not in the browser. That is deliberate: no system-level install, which matters on a classroom machine; and the browser is not where a 10 MB WASM runtime belongs.

**But** the bridge is the VS Code extension's process, and a teacher who has not installed the extension has no OCR. So the app's OCR capability must work **with or without** the bridge:

- the app exposes an **OCR option** in the panel's chrome (and in the crop flow);
- the request goes over the bridge's `ocr:request` message when the bridge is connected;
- when it is not, the app says so plainly — "OCR needs the bridge" — rather than failing silently. **Do not add `tesseract.js` to the app.** A WASM OCR engine in the browser is a multi-megabyte download on a slow classroom connection, and the project rule is no new dependency without the owner's explicit approval.

### The OCR contract

```ts
export type OcrRequest = {
  id: string;
  /** the image to read, base64 */
  imageBase64: string;
  /** the region of interest — only these pixels are processed */
  region?: { x: number; y: number; width: number; height: number };
  language?: string;
};

export type OcrResult = {
  id: string;
  text: string;
  /** per-line boxes, so the text can be placed as individual elements */
  lines: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  confidence?: number;
};
```

**The ROI crop is the biggest lever and it is free:** a subtitle band is a small fraction of a 1080p frame, so cropping turns a ~300 ms full-frame pass into a ~20–40 ms pass. The crop UI's region travels in `region`, and the result places the per-line text elements over the crop.

### The engine's rules

- **reuse the worker** — one worker, created once, surviving every recognition;
- **do not disable the language-data caching** (~2 MB for English, cached after the first run);
- **do not pin `corePath` to a single `.js` file** — the loader must be able to choose between the standard, the SIMD and the LSTM cores;
- use the **SIMD** core where the CPU supports it.

### The benchmark gate

Before the OCR path counts as done, the benchmark must be **run on this machine** over real frames, and the numbers recorded:

| case               | budget   |
| ------------------ | -------- |
| full 1080p frame   | < 1.5 s  |
| subtitle-band crop | < 250 ms |

Record the **median and p95** for both. If the crop budget is missed, the levers are, in order: the ROI crop, the fast language data (`tessdata_fast`), then the SIMD core. **Do not report the full-frame number and call the crop budget met.**

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-50 | The presenter renders the **same panel overlays** the editor does, because it already runs a whole second Excalidraw instance. A **read-only** code mirror and a **locked** video panel need **no protocol change** at all. |
| D-51 | The video's playback position travels **with the element** at about 4 Hz, and the presenter **interpolates** locally between updates. The presenter never writes playback back to the editor. |
| D-52 | `BinaryFileData` is **widened** to accept video mime types, so video bytes travel the existing `presenter:files` path, with a size guard. |
| D-53 | OCR is an **in-app capability that speaks the shared `OcrRequest`/`OcrResult` contract over the bridge**. The engine lives in the bridge's Node process, never in the browser. With no bridge, the app says so plainly. |

Add these four rows to `SPEC.md` in the Decisions table, and the acceptance rows below to the **Acceptance — Wave 5** table.

## The files you own

Everything below is inside the task scope `packages/element,packages/excalidraw,packages/vscode-bridge,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/element/src/types.ts` | changed | widen `BinaryFileData.mimeType` to accept video |
| `packages/vscode-bridge/bridge/src/ocr.ts` | new | the OCR service, against the shared contract |
| `packages/excalidraw/scene/panelContent.ts` | changed | the `playback` field on a video panel |
| `packages/excalidraw/components/PanelOverlay.tsx` | changed | the presenter's video playback |
| `excalidraw-app/presenter/presenterChannel.ts` | changed | the widened binary transfer, the size guard |
| `excalidraw-app/presenter/PresenterView.tsx` | changed | the presenter's panel chrome, the video playback |
| `excalidraw-app/presenter/usePresenterBroadcaster.ts` | changed | publishing the playback position |
| `excalidraw-app/` | changed | the OCR option in the panel chrome and the crop flow |
| `packages/excalidraw/tests/`, `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-50, D-51, D-52, D-53 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-63 | `excalidraw-app/tests/` | The presenter renders the **same panel overlay** the editor does, from the same element list. |
| AC-64 | `excalidraw-app/tests/` | A playback position of `t = 5` reaches the presenter, and the presenter does **not** write playback back. |
| AC-65 | `excalidraw-app/tests/` | A **video** binary file travels the `presenter:files` path, and a file **over the size guard** is refused with a clear error. |
| AC-66 | `excalidraw-app/tests/` | The OCR request carries the **ROI region**, and the result places **per-line** text elements over the crop. |
| AC-67 | `packages/vscode-bridge/` | With **no bridge**, the OCR option says the bridge is needed — it does not fail silently, and no OCR engine is bundled in the browser. |
| AC-68 | `packages/vscode-bridge/` | The OCR **benchmark** is recorded: median and p95, full frame and subtitle crop. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-64 the playback position reaches the presenter', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## The house rules

- `yarn`, never `npm` or `bun`. **No new dependency** — in particular **no OCR engine in the browser**. The engine is the bridge's.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your six new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the playback position is not published, (b) the presenter writes playback back, (c) the size guard is removed, (d) the ROI region is dropped from the OCR request. Record what you broke and what failed — the orchestrator needs that in the close note.
