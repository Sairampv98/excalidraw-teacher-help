---
id: wave5l-big-video
paths: packages/excalidraw,excalidraw-app,SPEC.md
base: main
status: merged
---

# Wave 5l — the video becomes real: big files, the format the browser cannot play, and the drag path

## Why this wave exists

The owner, testing the app on 2026-10-22, reported three video defects in one message:

> "as u can see the 600+ mb video that i selected to be inserted into the canvas doesnt actually allow to play the video."
> "why is the video not having the same option same as the draggable gif and image onto canvas. (just put a loading screen for when it is being loaded into the canvas with a wireframe of where the player will be."

Measured in the real app (the owner's port 3001, `main` at `f5d2633`), the video panel on the canvas was **empty**:

```
<div class="excalidraw__panel" data-panel-kind="video" ...>
  <div class="excalidraw__panel-surface" data-panel-kind="video"></div>
</div>
```

There was **no `<video>` element at all**, and the panel's surface measured **261 x 0** CSS px. The network panel showed **no media request**.

### The cause, read in the code

`excalidraw-app/sidebar/videoPanel.ts:74` reads the whole file into memory as a base64 data URL:

```ts
const dataURL = await getDataURL(videoFile);   // a 620 MB file -> ~827 MB of base64
const fileId = await generateIdFromFile(videoFile);  // -> another 620 MB ArrayBuffer for the SHA-1
```

Two whole-file copies before the video is even stored, and the result is a base64 string that then goes into the scene's file store (`api.addFiles`) and into the document. A 620 MB video is ~2.5 GB of allocation. The insert does not survive that, and what is left on the canvas is a panel with no source.

Three separate walls follow from that one line:

1. **The document carries the video.** A base64 data URL is the document's own text.
2. **The presenter cannot have it.** `excalidraw-app/presenter/presenterChannel.ts:174` — `PRESENTER_FILE_MAX_BYTES = 32 * 1024 * 1024` — the presenter refuses a file over 32 MB, so the video never reaches the presenter window.
3. **The browser cannot play a `.mkv`.** Matroska is not a container Chrome or Firefox will decode. Even with the bytes in hand, `<video src="....mkv">` fails, and the panel would still be empty.

The size and the container are **different** problems and this wave fixes both.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-94 | a video bigger than **32 MB** does not become a base64 data URL: it is stored as a **Blob in the origin's own IndexedDB** | locked | The base64 data URL is the right shape for a **picture** (a few hundred KB) and the wrong shape for a **video** (hundreds of MB). So the threshold is the same number the presenter's files channel already uses — **32 MB** — and the two are the same decision seen from two sides. A video at or under the threshold keeps the **existing** path untouched (the file store, the `dataURL`, the export, the `.excalidraw` file): nothing about the small case changes, so nothing about the exports changes. A video **over** the threshold is written to a **new store** — `media-db` / `media-store`, the same `idb-keyval` helpers `excalidraw-app/data/LocalData.ts` already uses for `files-db` — as the **`File`/`Blob` itself**. IndexedDB stores a Blob **by reference**, so the bytes go to the browser's own disk and never into the JavaScript heap: a 620 MB video costs the tab nothing. The document then carries a **small id**, not the video. The id is **random** (`nanoid`), not a hash of the bytes: hashing would mean reading the whole file again, which is the very thing this decision exists to avoid. |
| D-95 | the **library** resolves a media-backed panel through a **registry the host fills**; the library never touches IndexedDB | locked | `packages/excalidraw` cannot reach the app's store (the library must not depend on the app, and it gains no dependency). So the library owns the **shape** and the app owns the **bytes**: `packages/excalidraw/scene/mediaRegistry.ts` holds one resolver — `(mediaId) => Promise<string \| null>` — that returns an **object URL** for a media id, and the app registers its own at startup. The panel's source grows one variant, `{ type: "media", mediaId, mimeType }`, beside the existing `{ type: "file", fileId, mimeType }`. The library asks the registry, gets a URL, and renders a plain `<video src={url}>`. No IndexedDB code, no `idb-keyval`, no blob handling in the library. |
| D-96 | the **presenter resolves the media itself**, from the same origin's store, so a big video reaches it with **no transfer and no size limit** | locked | The presenter is a **second window of the same origin** (`http://localhost:3001`), so it has the **same IndexedDB** as the editor. The media does not have to travel at all: the presenter registers the same resolver, reads the same `media-store`, and makes its own object URL. The bytes never cross the `BroadcastChannel`, so there is nothing to be too big. The presenter's existing **32 MB guard stays exactly where it is** — it is the guard of the **legacy file path** (`presenter:files`, the `BinaryFileData` with its `dataURL`), and it keeps doing its job there. The change is that a big video no longer **uses** that path. The panel's element travels to the presenter as it always did — an element with a payload carrying a **short id** — and the presenter fills in the bytes itself. |
| D-97 | a video in a container the browser **cannot play** is never silent: the panel says so and shows the command that fixes it | locked | A panel that shows nothing and says nothing is indistinguishable from a panel that has nothing to show (the same rule as D-91 and D-75). So the `<video>` element's own `error` event is the **oracle**: `MEDIA_ERR_SRC_NOT_SUPPORTED` and `MEDIA_ERR_DECODE` are the browser saying "I cannot play this", and the panel then says exactly that — which format, and the command that converts it: `ffmpeg -i "input.mkv" -c:v libx264 -c:a aac -movflags +faststart "output.mp4"`. The sentence is in the **i18n file**, not in the component. The insert is **not refused** — the teacher is never told "no"; the video is inserted and the panel explains itself, and the sidebar says the same thing **before** the insert so the teacher can decide to convert first. |
| D-98 | the video row in the Files list **drags** onto the canvas, and a **loading wireframe** stands where the player will land | locked | Today the row is `draggable={image}` (`excalidraw-app/sidebar/FilesTab.tsx:609`): an image drags, a video does not, and that is the whole of the owner's complaint. The video takes the **same** path as the image — `armImageDragOnCanvas` becomes a path that can carry a video — and the release point is the drop point, exactly as it is for a picture. The difference is the **wait**: a big video takes a moment to be read and stored, so the canvas shows a **wireframe rectangle** of the player at the drop point while that happens, and the real panel replaces it. The wireframe is drawn by the app's own overlay, in the same style as the image drag's ghost, and it is **removed** when the insert finishes or fails. |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-133 | a video over the threshold is inserted **without a base64 data URL**, and the document does not carry its bytes | `excalidraw-app/tests/videoMedia.test.ts` | The insert of a video larger than 32 MB must not read the file into a base64 string (D-94). Tests: `AC-133 a video over the threshold is stored as media and not as a base64 data URL`, `AC-133 a video under the threshold still travels in the file store`. |
| AC-134 | the **presenter** resolves a big video from the media store: no bytes travel, and the video plays in the presenter window | `excalidraw-app/tests/presenterMedia.test.ts` | The presenter is the same origin, so it resolves the media itself (D-96). Tests: `AC-134 the presenter resolves a media-backed video from the store without a files message`, `AC-134 the presenter's legacy file guard still refuses a file over 32 MB`. |
| AC-135 | a video the browser **cannot play** says so, and shows the command that converts it | `packages/excalidraw/tests/videoPanel.test.tsx` | The panel must never be blank and must never be silent (D-97). Tests: `AC-135 a video the browser cannot play says why and shows the ffmpeg command`. |
| AC-136 | the video row **drags** onto the canvas, and a loading wireframe stands where the player will land | `excalidraw-app/tests/sidebar-ui.test.tsx` | The video takes the image's drag path (D-98). Tests: `AC-136 a video row drags onto the canvas and the panel lands under the pointer`, `AC-136 a loading wireframe stands where the player will land`. |

---

## The file map (read before writing)

- `excalidraw-app/sidebar/videoPanel.ts` — the insert. `getDataURL` + `generateIdFromFile` are the two whole-file reads to replace.
- `excalidraw-app/sidebar/FilesTab.tsx:381-393, 596-612` — `startDrag`, `draggable={image}`, the row's onClick.
- `excalidraw-app/sidebar/insertIntoScene.ts` — `armImageDragOnCanvas`, `DRAG_MIME`, `acceptsDrop`, `placementFor`, `viewportToScene`.
- `excalidraw-app/data/LocalData.ts:67` — `filesStore = createStore("files-db", "files-store")`; the `idb-keyval` helpers used there are the ones to reuse for the media store.
- `excalidraw-app/sidebar/videoCaptions.ts:217-254` — `readVideoSize` already creates an object URL and reads the metadata; it is the oracle for "can the browser read this video at all".
- `packages/excalidraw/scene/panelContent.ts` — the panel's `source` variants.
- `packages/excalidraw/components/PanelOverlay.tsx:1012-1035` — where `source.type === "file"` picks the image or the video; the media variant goes beside it.
- `excalidraw-app/presenter/presenterChannel.ts:174` — `PRESENTER_FILE_MAX_BYTES`; the legacy guard.
- `excalidraw-app/presenter/usePresenterBroadcaster.ts:188-209` — `sendFiles`, where the guard is applied.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency** in the library or the app. The library gains none at all.
- **The library is the oracle**: the browser's own `canPlayType` / `error` event decides whether a video can be played; do not hard-code a list of "good" extensions.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits — run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-133 ...`), or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: revert each fix and show the test fails. At minimum: put `getDataURL` back for a big video (AC-133 must fail); make the presenter fall back to the files channel (AC-134 must fail); remove the `error` handler (AC-135 must fail); make the video row not draggable (AC-136 must fail).
- The scope is `excalidraw-app`, `packages/excalidraw` and `SPEC.md`. Nothing else may be touched. If a change needs a path outside that, **say so in the note** rather than reaching for it.

## The gates

`node scripts/tins-gate.mjs` must pass 4/4 (typecheck, eslint, prettier, vitest) and `node scripts/rowcheck.mjs --all` must exit 0. The kit's own SPEC lint must pass. Report the measured numbers (the bytes that no longer travel, the insert time before and after) in the close note.
