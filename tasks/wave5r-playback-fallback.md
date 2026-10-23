---
id: wave5r-playback-fallback
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: 
base: main
status: open
---

﻿# Wave 5r — the video's failure message must be true, and there must be a fallback

## Why this wave exists

The owner wrote on 2026-10-23:

> "i was able to play .mkv in the earlier implementation of using base 64 maybe add that as fallback and also mention if the fallback also cannot play the file"

**The owner is right and wave 5l was wrong.** Wave 5l (D-97) shipped a panel that says
*"This browser cannot play a {{format}} video."* and an `ffmpeg` command - on the strength of
the belief that Matroska is not a container Chrome decodes. **That belief was never measured,
and it is false.**

### What was measured (Chrome, 2026-10-23, a real H.264/AAC `.mkv` made with ffmpeg)

| how the bytes reach `<video>` | the browser's verdict |
| --- | --- |
| `canPlayType("video/x-matroska")` | `"maybe"` |
| **blob URL, type `video/x-matroska`** | **PLAYABLE** (640x360, 3 s) |
| **blob URL, EMPTY type** | **PLAYABLE** |
| **data URL `data:video/x-matroska;base64,...`** | **PLAYABLE** |
| data URL with **no** mime (`data:;base64,...`) | ERROR 4 - "Unable to load URL due to content type" |
| mp4 via blob | PLAYABLE |

So Chrome **does** demux Matroska. The owner's `.mkv` played in the base64 implementation
because the base64 path always carried an explicit MIME type, and it plays now too, through
the media store's object URL (wave 5l) - the measurement says a blob URL plays it whether or
not it carries a type.

**What actually broke the owner's 620 MB `.mkv` was never the format** - it was the insert:
`getDataURL` + `generateIdFromFile` read the whole file twice (about 2.5 GB of allocation),
the insert died, and the panel was left with no source at all. Wave 5l fixed **that**, and
the format was never the issue.

So wave 5l shipped a **false statement** to the teacher ("this browser cannot play a
matroska video") and no **fallback**, which is what the owner asked for.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-125 | the playback failure message is the browser's verdict about the **file**, never a verdict about the **container** | locked | The panel used to say "this browser cannot play a matroska video" - a claim that was **not measured** when it was written, and that is **false** for the common case: Chrome demuxes Matroska (measured: a blob URL and a data URL both play an H.264 `.mkv`, and `canPlayType("video/x-matroska")` answers `"maybe"`). The browser's `error` event says that **this file** could not be decoded, and the usual cause is a **codec** the build does not decode (a 10-bit profile, AV1, or a broken file), not the container. So the message says exactly that: the browser could not play **this file**, the usual cause is a codec, and the remedy that always works is transcoding to H.264/AAC in MP4. The `ffmpeg` command stays - it is the one command that always produces a file every browser plays - but it is a **remedy**, not a verdict on the container. The rule this records: **the browser's error is about the bytes, and a message that names a format as the cause must have measured that format first.** |
| D-126 | the panel has a **fallback** for the bytes, and it says whether the fallback worked | locked | The owner asked for both: a fallback, and the panel **mentioning** when the fallback also cannot play the file. The fallback is the **other way of reaching the same bytes**, and it is deliberately cheap: a media-backed panel asks the host for a **fresh** object URL (the one it had may be stale or revoked - the library lends the URL and revokes it when the panel goes away), and a file-backed panel re-reads the file store's `dataURL`. The fallback **never rebuilds a base64 string of a big file** - that is the 827 MiB of memory wave 5l removed - so it stays cheap even for a 620 MB video. The panel tries the primary source, then the fallback **once**, and then says **which** it tried and that both failed. A panel that says "this file could not be played" without saying whether the fallback was tried is a panel that hides half of what it knows (D-75, D-93). |
| D-127 | an error from a source that has already been **replaced** is not a failure of the panel | locked | The library lends its URL and revokes it when the panel goes away - and the revoke happens when the URL **changes** (`PanelOverlay.tsx`: the cleanup of the effect that depends on the URL). So the moment the fallback replaces the first URL, the first URL is revoked while the `<video>` element may still be pointing at it, and the element fires an `error` for a source that is already gone. That error is **not** a fact about the file, and reporting it would send the teacher chasing a format that plays perfectly well. So the error is judged against the URL that is **current**: an error from a URL the panel has already replaced is ignored, and only an error from the current source counts. The rule is the same one the whole project follows - **a fact about something that is no longer there is not a fact about the file** (D-75, D-93). |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-165 | the failure message names the **file**, not the container, and does not claim a browser cannot play a container it can | `packages/excalidraw/tests/videoPanel.test.tsx` | The message must be true (D-125). Tests: `AC-165 the failure message does not claim the browser cannot play the format`, `AC-165 the failure message names the codec as the usual cause and keeps the ffmpeg remedy`. |
| AC-166 | the panel tries the **fallback** once and says whether it worked | `packages/excalidraw/tests/videoPanel.test.tsx` | The fallback and the mention (D-126). Tests: `AC-166 the panel asks for a fresh url when the first one fails`, `AC-166 the panel says the fallback was tried and that it failed too`. |
| AC-167 | an error from a **replaced** source is ignored | `packages/excalidraw/tests/videoPanel.test.tsx` | A stale source's error is not a fact about the file (D-127). Tests: `AC-167 an error from a replaced url does not report a playback failure`. |

---

## The file map (read before writing)

- `packages/excalidraw/components/PanelOverlay.tsx` - the video surface: where the source is
  resolved (`source.mediaId` -> `resolveMediaUrl`), where the `error` event is handled, and
  where the failure message is rendered. The **fallback** belongs in the resolution path: a
  second attempt that asks the host for a fresh URL (or re-reads the file store's data URL).
- `packages/excalidraw/scene/mediaRegistry.ts` - `resolveMediaUrl`, and the rule that the URL
  is **lent**: the library revokes it when the panel goes away, so a **fresh** one must be
  obtainable.
- `packages/excalidraw/locales/en.json` - the two messages (`cannotPlay`, `playbackFailed`).
  Both must be reworded so neither names the container as the cause.
- `packages/excalidraw/tests/videoPanel.test.tsx` - where AC-135's test lives; add AC-165 and
  AC-166 beside it.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency**, and **no change** to the media store's shape or to the 32 MB
  threshold (D-94).
- **The fallback must never build a base64 string of a big file.** The regression to guard
  against is exactly the one wave 5l removed.
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-165 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: put the old "cannot play a {{format}} video" wording back and show AC-165 fails;
  remove the fallback and show AC-166 fails.
- The scope is `packages/excalidraw` and `SPEC.md`. Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof**: in a **real browser** (not jsdom - jsdom cannot decode a video), with a
real `.mkv`:
1. the video **plays** through the panel's object URL, and
2. when the source is made to fail, the panel tries the **fallback** and the message says
   which one it tried.

A small probe file can be made with ffmpeg (this machine has ffmpeg 9.0.1 with libx264):

```
ffmpeg -f lavfi -i testsrc=size=640x360:rate=25:duration=3 -c:v libx264 -pix_fmt yuv420p -c:a aac probe.mkv
```

Report the measurements in the close note.

