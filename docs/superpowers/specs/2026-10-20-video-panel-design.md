# Video Panel

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 7 **Depends on:** `2026-10-20-canvas-panel-foundation-design.md`

---

## 1. Problem statement

The user wants to put a **video** on the canvas — from a local file or a pasted YouTube link — as a resizable object, with **captions displayed outside the player** in an ordinary text box and kept in sync with playback. The panel can be **locked** into a screenshot, **cropped**, and **OCR'd**, so the teacher can draw on top of a frame.

## 2. What the research established

### 2.1 YouTube captions cannot be fetched from the browser

This is the finding that shapes the whole design.

- The official **YouTube Data API** `captions.download` requires OAuth **and** ownership of the video — a third-party public video returns **403**. Not usable.
- The internal `youtubei/v1/player` + `api/timedtext` path works from a **residential IP** for many videos, but since late 2024 YouTube requires a **PO token** (`pot=`, minted by botguard inside the player JS) for videos whose caption URL carries `&exp=xpe`. Without it, `timedtext` returns **HTTP 200 with an empty body** — a silent failure that looks like "this video has no captions".
- **Datacenter IPs are blocked outright** (`RequestBlocked` / `IpBlocked`), so no cloud function can fetch captions reliably.
- What _does_ work: **`yt-dlp`**, whose JS runtime solves the player challenges and mints PO tokens (`--write-auto-subs` succeeds on videos that defeat every plain HTTP approach). A browser-driving approach also works but is far heavier.

**Consequence:** captions for YouTube videos must be fetched by a **local process on the teacher's machine** — which is exactly the bridge service already being built for item 6. The browser cannot do this itself.

### 2.2 The local-video path needs no service at all

A local video file with a sidecar `.srt` / `.vtt` is fully readable in the browser, with no CORS involvement. This is the zero-setup path and should be the default.

### 2.3 OCR performance

Measured figures for `tesseract.js` (the WASM build), from the project's own benchmarks:

| Build | Time per page | Note |
| --- | --- | --- |
| standard WASM | ~325 ms | baseline |
| **SIMD WASM** | ~160-220 ms | 1.5-2x faster, supported on all modern CPUs |
| SIMD + LSTM | similar to SIMD | more accurate on complex scripts |
| native Tesseract | ~580 ms/image | CPU-only, best accuracy (CER 0.912 in one benchmark) |
| EasyOCR | ~810 ms/image | better CER (0.142) but 11x the cost of raw Tesseract |

Practical rules that follow, from the tesseract.js performance guide:

- **Reuse the worker.** Creating a worker per image is always wrong; the worker survives recognition.
- **Do not disable language-data caching** (~2 MB for English, cached after the first run).
- **Do not pin `corePath` to a single `.js` file** — the loader must be able to choose between the standard, SIMD and LSTM cores.
- **Crop before OCR.** This is the biggest lever and it is free: a subtitle band is a small fraction of a 1080p frame, so cropping to the region of interest typically turns a ~300 ms full-frame pass into a ~20-40 ms pass.

### 2.4 The user's screenshot-quality requirement, solved

The user was explicit that the screenshot must be of the video **playing full screen**, even though it appears small on the canvas, so that cropping is not grainy.

The answer is structural: **the lock never captures the DOM**. The `<video>`'s current frame is drawn into an offscreen canvas at the video's **intrinsic** resolution (`videoWidth` x `videoHeight`), and the crop is taken from that. The on-canvas display size is irrelevant to the output resolution.

## 3. Goals

1. A video panel on the canvas: local file or YouTube link.
2. Resizable, movable, on a page, with the usual panel chrome.
3. Captions in a **separate, ordinary text box** beside the panel, synchronised to playback.
4. Lock -> a full-resolution poster; crop; OCR.
5. No service required for local videos.

## 4. Non-goals

- Editing video.
- Subtitles burned into the video.
- A general-purpose transcription service.

## 5. Design

### 5.1 The panel

A **video panel** from the canvas-panel foundation, with `panelKind: "video"`.

Content is a `<video>` element rendered by the panel overlay. A `<video>` cannot be painted into a canvas, so — exactly like the GIF overlay — the canvas **skips** a live video panel and the DOM layer draws it.

```ts
export type VideoPanelContent = {
  kind: "video";
  source:
    | { type: "file"; fileId: BinaryFileID; mimeType: string }
    | { type: "youtube"; videoId: string; title?: string };
  /** Caption track, resolved by the bridge. */
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

### 5.2 Two sources, two caption paths

| Source | Playback | Captions |
| --- | --- | --- |
| **Local file** | `video.src` = object URL of the file in the document's files store | a sidecar `.srt` / `.vtt` read locally, or **no captions** |
| **YouTube** | embedded `<iframe>` of `youtube.com/embed/<id>` | fetched by the **bridge** (see 5.3) |

A YouTube video **cannot** be played from a local file, so it uses the embed. That also means the "full-resolution poster" rule needs care for YouTube: the embed is a cross-origin iframe and cannot be read by the page. So for YouTube panels, the poster comes from the bridge, which uses `yt-dlp` to fetch a real frame at full resolution. For local videos, the poster comes from the `<video>` element itself.

This is a real asymmetry and it is stated rather than hidden.

### 5.3 Captions for YouTube — the bridge

The bridge (item 6's process) gains a `captions:fetch` capability:

1. try `yt-dlp --write-auto-subs --skip-download --sub-format vtt <url>` — handles PO-token videos;
2. fall back to the `youtubei` + `timedtext` path, which works for non-PO-token videos from a residential IP;
3. parse the WebVTT into the `cues` array.

Failures are reported as _"no captions available"_ — the exact wording matters, because a PO-token block produces an **empty** response that would otherwise look like "this video has no captions".

**Local videos never touch the bridge for captions.** A sidecar `.srt` / `.vtt` next to the video file is read by the browser.

### 5.4 Captions live outside the player

The user was explicit: _"the captions should if possible not be inside the video player but outside of the video player in a text box (the one that excalidraw natively has right now) and which gets refreshed / synced to the captions of the video"_.

So the caption is an **ordinary Excalidraw text element**, positioned beside the video panel, and it is **not** part of the panel's own DOM. It is updated as playback advances.

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

- The caption element's text is replaced with the cue active at the current time.
- The binding survives a page switch and a reload (it is scene data).
- Default language is **English**; the user can switch the track, and the panel then writes the new language's cue.
- If there are **no captions**, the caption element is simply not created — the user asked for exactly this ("if no caption no such option").

Writing to a text element on every cue change is a scene mutation, so it goes through the normal element machinery (and therefore through undo). Cue changes are infrequent (a few per minute of video), so this is not a hot path.

### 5.5 Lock, crop, OCR

Per the canvas-panel foundation:

- **Lock** draws the current frame into an offscreen canvas at `videoWidth` x `videoHeight`, then stores it as a poster. For a YouTube panel, the frame comes from the bridge at full resolution.
- **Crop** operates on the poster and produces a new image element.
- **OCR** sends the poster (or the cropped region) to the OCR service.

### 5.6 The OCR service

The user asked for OCR "as a separate service". Given the bridge already exists, the service is a capability of the bridge process, not a new daemon:

- **Engine**: `tesseract.js` (WASM, in the bridge's Node process) — no system-level install, which matters for a classroom machine.
- **Worker lifecycle**: one worker, created at bridge start, reused for every request.
- **SIMD** core where the CPU supports it.
- **ROI cropping**: the crop UI's region is passed to the OCR service as `region`, so only the interesting pixels are processed. This is the difference between ~300 ms and ~30 ms.
- **Output**: the shared `OcrResult` contract from the foundation spec, with per-line boxes so the extracted text can be placed as individual text elements over the crop.

**A benchmark gate.** Before the OCR path is considered done, a benchmark must be run on this machine over real frames — a 1080p video frame, and the same frame cropped to its subtitle band — recording median and p95 latency. The budget this spec proposes:

| Case               | Budget   |
| ------------------ | -------- |
| Full 1080p frame   | < 1.5 s  |
| Subtitle-band crop | < 250 ms |

If the crop budget is missed, the lever is the ROI crop and the fast language data (`tessdata_fast`), in that order.

### 5.7 Presenter support

Handled by the presenter spec (§5.2): the video panel's playback position is part of the element and travels over the existing scene message; the presenter interpolates locally so playback stays smooth.

## 6. Test coverage

| Test | Asserts |
| --- | --- |
| panel creation | a video panel element is created with the right `panelKind` and source |
| local playback | the panel renders a `<video>` whose `src` is the file's object URL |
| youtube playback | the panel renders an embed iframe for a YouTube id |
| caption binding | a cue change replaces the bound text element's text; the element is on the same page |
| no captions | a video with no caption track creates **no** caption element |
| caption language switch | switching the track updates the bound element and the stored language |
| lock resolution | locking a local video panel produces a poster at `videoWidth` x `videoHeight`, not the on-canvas size |
| youtube poster | a YouTube panel's poster arrives from the bridge at full resolution |
| crop | cropping a poster yields a new image element on the current page |
| OCR contract | the OCR request carries the ROI region and the result places per-line text elements |

**Teeth check:** removing the caption sync must fail the caption test; removing the intrinsic-resolution capture must fail the lock-resolution test.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| YouTube captions are unavailable for some videos (PO token) | The bridge uses `yt-dlp` first; failure is reported honestly as "no captions available" rather than a silent empty track |
| `yt-dlp` is an extra dependency of the bridge | It is optional: the bridge falls back to the plain `youtubei` path, and captions are a progressive enhancement |
| A YouTube embed cannot be captured by the page | The poster comes from the bridge for YouTube panels; only local videos are captured in-page |
| Writing the caption into a scene text element pollutes undo | Cue changes are infrequent; they are grouped so one undo step reverts a whole caption sequence |
| Large video files in the document store | The files store is already IndexedDB; the transfer path is the same one images use |
| OCR too slow | ROI crop first, SIMD second, fast language data third; a benchmark gate before "done" |

## 8. Success criteria

1. A local video plays on the canvas, resizable and movable.
2. A YouTube link plays on the canvas.
3. Captions appear in a separate text box beside the panel and follow playback; no captions means no caption box.
4. Locking produces a full-resolution poster; cropping and OCR work on it.
5. The OCR benchmark budgets in §5.6 are met on this machine.
6. The four gates are green.

## 9. Ordering

**Wave 3**, with items 6 and 10. The local-video path needs no bridge and can ship first; the YouTube path needs the bridge's `captions:fetch` capability.
