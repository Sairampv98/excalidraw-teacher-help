# Builder brief — Wave 5c, the video panel (item 7)

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's item 7: a video on the canvas, with captions, a full-resolution screenshot, crop and OCR.

The owner's own words, from the 2026-10-21 test session:

> "the captions should if possible not be inside the video player but outside of the video player in a text box (the one that excalidraw natively has right now) and which gets refreshed / synced to the captions of the video"

and

> "if no caption no such option"

**This wave depends on the canvas-panel foundation** (Wave 5a): the `panel` element type, the `PanelOverlay`, the lock/crop/OCR pipeline and the shared `OcrRequest`/`OcrResult` contract. Read `docs/superpowers/specs/2026-10-20-canvas-panel-foundation-design.md` and the Wave 5a code before starting. If the foundation is not in the tree yet, **stop and report it**.

The full video design is `docs/superpowers/specs/2026-10-20-video-panel-design.md`. **Read it first** — it carries the measured OCR figures, the two source types and their two caption paths, and the benchmark gate.

## What is in scope for this wave, and what is not

**In scope — the local video path.** It needs no bridge, no service and no network:

- a video panel on the canvas, from a local file;
- playback (play, pause, seek, volume, mute);
- **sidecar** captions: a `.srt` / `.vtt` file next to the video, read by the browser;
- the caption shown in an **ordinary Excalidraw text element beside the panel**, refreshed as playback advances;
- lock → a poster at the video's **intrinsic** resolution; crop; OCR.

**Out of scope for this wave — the YouTube path.** It needs the bridge (Wave 5b) for two reasons, both stated in the design: the captions have to be fetched by a local helper (`yt-dlp`), and a YouTube embed is a cross-origin iframe the page **cannot** read, so its poster must come from the bridge too. The **types** and the **protocol messages** are in scope, so Wave 5b can fill them in without changing the panel. The **implementation** of the YouTube path is Wave 5b's job.

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-44 | A video panel is **live** (the canvas skips it, the DOM overlay draws the `<video>`) or **locked** (the canvas paints a poster at the video's **intrinsic** resolution). The on-canvas display size never affects the output resolution. |
| D-45 | The captions live in an **ordinary Excalidraw text element beside the panel**, not inside the player, and the binding is **scene data** — it survives a page switch and a reload. A video with no caption track gets **no caption element at all**. |
| D-46 | A **local** video's captions come from a **sidecar** `.srt` / `.vtt` the browser reads; they never touch the bridge. A YouTube video's captions come from the bridge, and a failure is reported honestly as "no captions available" rather than an empty track. |

Add these three rows to `SPEC.md` in the Decisions table, and the acceptance rows below to the **Acceptance — Wave 5** table.

## The content type

```ts
export type VideoPanelContent = {
  kind: "video";
  source:
    | { type: "file"; fileId: BinaryFileID; mimeType: string }
    | { type: "youtube"; videoId: string; title?: string };
  /** Caption track, resolved by the bridge (YouTube). */
  captions?: {
    language: string;
    cues: { start: number; end: number; text: string }[];
  };
  /** Local sidecar captions, for local files. */
  sidecarCaptions?: {
    language: string;
    cues: { start: number; end: number; text: string }[];
  };
  /** Current playback position, shared with the presenter. */
  playback?: { time: number; playing: boolean };
};
```

## The caption binding

```ts
export type CaptionBinding = {
  /** The text element that displays the caption. */
  elementId: ExcalidrawElementId;
  /** The video panel it is bound to. */
  panelId: ExcalidrawElementId;
  /** Language of the track. */
  language: string;
};
```

Behaviour:

- the caption element's text is replaced with the cue active at the current time;
- the binding is **scene data**, so it survives a page switch and a reload;
- the default language is **English**, and the user can switch the track;
- a video with **no captions** creates **no caption element** — the owner asked for exactly this;
- writing to the text element goes through the normal element machinery, and therefore through **undo**. Cue changes are infrequent (a few per minute of video), so this is not a hot path.

**Where does the binding live?** It must be scene data (it survives a reload) but it is not part of the panel's own payload — it points at another element. Put it in the element that the foundation's `PanelContent` already defines a home for, and **say in the code comment** why it is there and not in the panel.

## The OCR budget — a gate, not a hope

The design sets a budget that must be **measured on this machine** before the OCR path counts as done:

| case               | budget   |
| ------------------ | -------- |
| full 1080p frame   | < 1.5 s  |
| subtitle-band crop | < 250 ms |

The levers, in order: the **ROI crop** (free, and the biggest one), then the **SIMD** core, then the fast language data. The worker is created **once** and reused; language data is **not** uncached; and the core path is **not** pinned to a single `.js` file, so the loader can pick the SIMD core.

**Run the benchmark and record the numbers** (median and p95) in the close note. If the crop budget is missed, say so — do not quietly report the full-frame number.

## The files you own

Everything below is inside the task scope `packages/excalidraw,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/scene/panelContent.ts` | changed | the `video` kind of `PanelContent` |
| `packages/excalidraw/components/PanelOverlay.tsx` | changed | the `<video>` rendering, the playback controls |
| `packages/excalidraw/components/panelCaptions.ts` | new | the pure caption logic: which cue is active, the binding |
| `excalidraw-app/sidebar/` | changed | adding a video: the file picker, the sidecar picker, the caption element |
| `excalidraw-app/components/` | changed | the caption element's creation and its refresh |
| `packages/excalidraw/tests/`, `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-44, D-45, D-46 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-52 | `packages/excalidraw/tests/` | A video panel is created with the right `panelKind` and source, and the **live** panel is not painted by the canvas. |
| AC-53 | `packages/excalidraw/tests/` | A cue change replaces the **bound text element's** text, and the element is on the same page as the panel. |
| AC-54 | `packages/excalidraw/tests/` | A video with **no** caption track creates **no** caption element. |
| AC-55 | `packages/excalidraw/tests/` | Locking a local video panel produces a poster at the video's **intrinsic** size, not the on-canvas size. |
| AC-56 | `excalidraw-app/tests/` | The OCR request carries the **ROI region**, and the OCR benchmark is recorded (median and p95, full frame and subtitle crop). |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-53 a cue change replaces the bound text element', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## The house rules

- `yarn`, never `npm` or `bun`. **No new dependency** — the OCR engine is the bridge's (`tesseract.js` in the bridge's Node process), not the app's.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has (`getCommonBounds`, `sceneCoordsToViewportCoords`).
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your five new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the caption sync is removed, (b) the caption element is created even with no captions, (c) the poster is captured at the on-canvas size instead of the intrinsic size, (d) the ROI region is dropped from the OCR request. Record what you broke and what failed — the orchestrator needs that in the close note.
