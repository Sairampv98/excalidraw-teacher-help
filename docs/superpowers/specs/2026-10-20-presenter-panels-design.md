# Presenter Panels

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 10 **Depends on:** `2026-10-20-canvas-panel-foundation-design.md`

---

## 1. Problem statement

The user wants the **presenter window** to show the same things the editor shows for the new panel features: **video playing**, and a **live code editor**.

The presenter already does this for GIFs. That existing path is the template, and it turns out to be simpler than expected.

## 2. How the presenter works today

**Transport.** `BroadcastChannel`, name `excalidraw-presenter-v1` (`excalidraw-app/presenter/presenterChannel.ts:39`), created at `:289-307`; `null` when unsupported (`:163-164`, `:292-294`). Same-origin, bidirectional.

**Messages.** The union is at `presenterChannel.ts:140-152`:

| Direction | Message | Carries | Where |
| --- | --- | --- | --- |
| editor -> presenter | `presenter:scene` | `{ elements, camera }` | `usePresenterBroadcaster.ts:96-102` |
| editor -> presenter | `presenter:pointer` | pointer position | `usePresenterBroadcaster.ts:139` |
| editor -> presenter | `presenter:files` | `BinaryFileData[]` | `usePresenterBroadcaster.ts:186-190` |
| presenter -> editor | `presenter:files-request` | missing `fileId`s | `PresenterView.tsx:230-271` |
| both | `presenter:hello` / `presenter:bye` | presence | `presenterChannel.ts:203-217`, `PresenterView.tsx:134-136, 324-333, 371-379` |

The editor publishes the scene on change, throttled to 40 ms (~25 fps) and only when a presenter is present (`usePresenterBroadcaster.ts:28, 259-271`).

**Camera.** Resolution-independent: the editor sends `pageOffsetX`/`pageOffsetY` as a **fraction of the current page** (`getPageRelativeCamera`, `packages/excalidraw/scene/pages.ts:214-229`); the presenter rebuilds `scrollX`/`scrollY` with `getCameraFromPageRelative` (`pages.ts:232-243`) in `resolvePresenterCamera` (`presenterChannel.ts:239-281`) and re-derives zoom from its own measured viewport (`:269-274`). Raw scroll/zoom are used only when pages are off (`:246-258`).

**Rendering.** The presenter mounts a **whole second Excalidraw instance** — `<Excalidraw viewModeEnabled>` (`PresenterView.tsx:539-558`) — and calls `api.updateScene({ elements })` with the elements it received (`PresenterView.tsx:162-175`). The presenter does **not** mount the GIF overlay itself: the library does, inside that second instance (`packages/excalidraw/components/App.tsx:2390-2410`).

**Files.** Binary assets travel separately and on demand: the presenter detects missing `fileId`s, sends `presenter:files-request`, and the editor replies with `presenter:files`, which the presenter applies with `api.addFiles` (`PresenterView.tsx:230-271, 292`).

## 3. The good news: a read-only code mirror needs no new transport

Code cards are **already real text elements** (`insertIntoScene.ts:669-712`), and the scene message already carries elements. So a **read-only** code mirror in the presenter is just more text elements — it arrives through `presenter:scene` with no protocol change at all.

The same is true for a **locked** video panel: a locked panel is an ordinary image element with a poster, so it arrives over the existing scene path.

Only **live** panels need new transport, because a live panel's content is not scene geometry.

## 4. Goals

1. The presenter renders the same panel overlays the editor does.
2. A video panel **plays in the presenter**, in sync with the editor.
3. A live code panel is **read-only** in the presenter by default, with an optional interactive mode.
4. Video bytes can reach the presenter.

## 5. Design

### 5.1 Panels in the presenter

Because the presenter already runs a full Excalidraw instance, the panel overlay mounts there exactly as it does in the editor. The panel element travels over `presenter:scene` as part of `elements`, and the overlay picks it up from the same renderable-element list the GIF overlay uses.

**No new transport for panels.** This is the single biggest simplification in this spec.

### 5.2 Video sync

A video panel's playback position is state that must be shared. The panel element carries:

```ts
/** Playback position in seconds, for panels whose content is time-based. */
playback?: { time: number; playing: boolean };
```

The editor writes it on a coarse tick (not every frame — the scene message is throttled to 40 ms and carrying the whole element list), and the presenter applies it. The presenter must **not** write playback back to the editor; otherwise the two windows fight.

Sync granularity: the panel's `playback.time` is updated by the editor at ~4 Hz, and the presenter **interpolates** locally between updates using `video.playbackRate` and `requestVideoFrameCallback` if available. That keeps the video smooth in the presenter without flooding the channel.

If the presenter has no video panel on the current page, it does nothing.

### 5.3 Video bytes on the channel

**Blocker found:** `BinaryFileData.mimeType` is restricted to `IMAGE_MIME_TYPES` (`packages/element/src/types.ts:159, 890`). A video's mime type cannot travel the existing `presenter:files` message as it stands.

Two options:

- **(a) Widen `BinaryFileData`** to accept video mime types. Then `presenter:files` carries video bytes like any other binary. Simple, and the channel already handles binary transfer.
- **(b) Add a separate `presenter:media` message** for larger payloads.

Recommendation: **(a)** — widen the type, because the channel already has a working binary path and a second message type would duplicate it. Video files are large, so the existing transfer needs to remain chunk-free but may want a size guard.

A video panel does **not** have to ship its bytes at all if the presenter can reach the same source: the panel's `source` can be a `file` reference into the document's files store, in which case the presenter requests it exactly as it requests image files today.

### 5.4 Live code panel in the presenter

The presenter is `viewModeEnabled` (`PresenterView.tsx:540`), so an interactive editor **cannot** be an Excalidraw element. It must be a separate DOM panel whose edits round-trip.

**Read-only (default).** The panel shows the mirrored content and the presenter cannot type into it. No protocol change.

**Interactive (opt-in).** Requires three additions, all explicitly scoped:

1. a new message type `presenter:input` in the union at `presenterChannel.ts:140-152`;
2. an editor-side handler in `usePresenterBroadcaster.ts:201-230` that applies the keystrokes to the source document;
3. a presenter-side post path (`PresenterView.tsx:126-140`).

**Recommendation: ship read-only first.** Interactive mode is a meaningfully larger surface (input focus, cursor position, IME, undo) and is not required to show a class what the code does. It is a natural follow-up once the read-only path is proven.

### 5.5 Presenter-side controls

The presenter needs its own small panel chrome: a play/pause for video panels, and a "take control" toggle for interactive code panels. These live in the presenter's DOM, not in the scene — the presenter already has its own chrome (`PresenterView.tsx`).

## 6. Test coverage

| Test | Asserts |
| --- | --- |
| presenter camera (existing) | `resolvePresenterCamera` still round-trips — unchanged by this spec |
| panel travels | a panel element sent over `presenter:scene` arrives in the presenter's scene intact |
| video file request | the presenter requests a video `fileId` it does not have and applies the reply — the existing `requestMissingFiles` path, exercised with a video mime |
| video sync | a `playback.time` in the element updates the presenter's video position within a tolerance |
| read-only code panel | typing into the presenter's code panel produces no editor-side change |
| interactive code panel (phase 2) | a `presenter:input` message mutates the editor's document |

**Teeth check:** removing the playback propagation must fail the video-sync test; removing the mime widening must fail the video-file-request test.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Widening `BinaryFileData` to video affects the published library type | Additive change; upstream ignores unknown mime types on restore |
| Large video payloads over `BroadcastChannel` | The channel is same-origin and structured-clone based; the existing file path already carries image blobs. A size guard and a "reload from disk" fallback keep this bounded |
| Playback fight between editor and presenter | The presenter **never** writes `playback` back. Enforced by the read-only presenter scene |
| Interactive mode balloons in scope | Shipped as phase 2, explicitly optional |

## 8. Success criteria

1. The presenter renders the editor's panel overlays.
2. A video panel plays in the presenter, in sync with the editor.
3. A code panel is visible and read-only in the presenter by default.
4. Video assets reach the presenter.
5. The four gates are green.

## 9. Ordering

**Wave 3**, with items 6 and 7. It has no dependency of its own beyond the panel foundation — the read-only path is small, and the interactive path is explicitly deferred.
