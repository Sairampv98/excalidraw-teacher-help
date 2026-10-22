---
id: wave5n-screenshot
paths: packages/excalidraw,excalidraw-app,packages/vscode-bridge,SPEC.md
read: 
base: main
status: open
---

# Wave 5n — the screenshot: capture the editor or the video, then three choices

## Why this wave exists

The owner, testing on 2026-10-22, asked for a feature that does not exist yet:

> "6. after taking a screenshot of either vscode or video player's current frame (for video that should pause the video). this should trigger 3 options place in current page - ocr the screenshot - maybe we can add this to regular images aswell i suppose, place the image on a new page (one question if i cut a image from one page and move to another page can i paste it there?) a wire frame of where to place the image similiar to the draggablity of gif and images from the sidebar."

and, in the same message, about the shape of the affordance:

> "here is where i mentioned this option should only come up after we click the screen shot option similiar to the move and close option, and maybe use the same theme for all the things u develop"

Nothing like it exists today. The nearest things are the video's **poster** (a thumbnail of the video, not a capture the teacher asks for) and the OCR **picture** flow (`excalidraw-app/bridge/useOcr.ts`). There is no button, no capture, and no choice.

**The owner's own question, answered from the code**: *"if i cut a image from one page and move to another page can i paste it there?"* — **yes**. `packages/excalidraw/components/App.tsx:4781-4788`:

```ts
// Pages: a paste inserts into the *live* scene, so the pasted content
// belongs to the page the user is acting on. ...
if (this.pagesEnabled) {
  stampCurrentPage(duplicatedElements, this.state.currentPageId);
}
```

A paste is stamped with the **current** page, so a picture cut on page 1 and pasted while page 2 is active lands on page 2. (That line is itself the fix of an earlier wave: pasted content used to land on the first page and be invisible.) So "place the image on a new page" is the same machinery, done deliberately.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-102 | a **screenshot** is a button on the panel's chrome, and it captures **one picture**: the editor's window, or the video's paused frame | locked | The two sources are different and the difference is real. The **video's frame** is in the app: the `<video>` element is there, so the app **pauses** it and draws the current frame onto a canvas - no bridge, no extension, no permission. The **editor's window** is not in the app: the frames are served as an MJPEG stream from the extension's own HTTP server (D-85) and the app never sees them. So the extension's server grows **one more path**: the same capability that authorises the stream also authorises a **single** JPEG - the last frame it already holds (it computes that frame's CRC on every publish anyway, D-88) - and the app fetches it with a plain `GET`. The capture therefore costs one HTTP request, no base64 on the websocket, and no new protocol message. Both sources end at the **same place**: an ordinary **image file**, which is what makes the three choices below uniform. |
| D-103 | the three choices appear **only after** the screenshot is taken, and they are the **only** choices | locked | The owner asked for this exactly: "this option should only come up after we click the screen shot option". So the panel's chrome carries **one** button - the screenshot - and nothing else. The capture opens a small **choice strip** with exactly three entries: **OCR the screenshot**, **place on this page**, **place on a new page**. Nothing else appears; the OCR option is not on the panel at all before the capture, and the strip closes when a choice is made or the teacher dismisses it. The strip is drawn by the **library** (it is panel chrome, like the header), it is **scaled like the chrome** (the wave 5k rule: the chrome keeps its size on screen at any zoom), and it uses the **same theme** as every other affordance this project has added - one set of sizes in `packages/excalidraw/scene/panelChrome.ts`, one set of colours, one button shape. |
| D-104 | placing a screenshot shows a **wireframe** where it will land, and the teacher places it | locked | The owner asked for the same affordance the sidebar's images already have: "a wire frame of where to place the image similiar to the draggablity of gif and images from the sidebar". So after a capture, a **wireframe rectangle** - the picture's own size, in the chrome's own style - stands on the canvas where the picture will land, and the teacher moves it and clicks to place it. The wireframe is removed when the picture lands, when the choice is dismissed, and when the panel is deleted. The picture itself is an ordinary **image element**, so everything the teacher can do with an image (crop, delete, move to another page by cut and paste, export) works on a screenshot with no extra code. |
| D-105 | "OCR the screenshot" is the **same** OCR the project already has, and the OCR option is also offered for an ordinary image | locked | The project already reads text out of a picture: the OCR request carries the picture's bytes and the ROI, and the result places per-line text elements over it (D-59, AC-73). A screenshot is a picture, so the screenshot's OCR **is** that path - not a second OCR. The owner also asked "maybe we can add this to regular images aswell i suppose": an ordinary image element on the canvas gets the same **OCR** choice, so the teacher can read the text out of a screenshot they pasted in by hand. The engine is still the extension's (D-90) and never in the browser (D-59); with no bridge the option says so plainly (D-91). |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-139 | the screenshot button captures **one picture** - the editor's window, or the video's **paused** frame | `packages/excalidraw/tests/screenshot.test.tsx` | One capture, two sources (D-102). Tests: `AC-139 the video is paused before its frame is captured`, `AC-139 the editor's window is captured through the extension's snapshot path`. |
| AC-140 | the three choices appear **only after** the capture, and there are exactly three | `packages/excalidraw/tests/screenshot.test.tsx` | The OCR option must not exist before the capture (D-103). Tests: `AC-140 no choice is offered before the screenshot is taken`, `AC-140 the capture offers exactly three choices`. |
| AC-141 | a screenshot is placed with a **wireframe**, on this page or on a **new** page | `excalidraw-app/tests/screenshot.test.tsx` | The wireframe stands where the picture will land (D-104). Tests: `AC-141 a wireframe stands where the screenshot will land`, `AC-141 the new-page choice creates the page and puts the picture on it`. |
| AC-142 | the OCR choice reads the screenshot with the **existing** OCR path, and an ordinary image can be read too | `excalidraw-app/tests/useOcr.test.tsx` | One OCR, not two (D-105). Tests: `AC-142 the screenshot's OCR goes through the existing OCR request`, `AC-142 an ordinary image element offers the same OCR choice`. |

---

## The file map (read before writing)

- `packages/excalidraw/components/PanelOverlay.tsx` — the panel's chrome: the header, the video's control strip, where the screenshot button goes, and where the choice strip is drawn.
- `packages/excalidraw/scene/panelChrome.ts` — **created by wave 5k**: the chrome's sizes as screen pixels and the one place they become panel units. The new affordances use it (D-103).
- `packages/excalidraw/css/styles.scss` — the chrome's styles; the wireframe and the choice strip belong beside them.
- `packages/excalidraw/locales/en.json` — every new sentence (D-103: the text is never in a component).
- `packages/excalidraw/scene/panelContent.ts` — the panel's payload; the pending screenshot has to live somewhere the library can read.
- `excalidraw-app/bridge/useOcr.ts` — the OCR path a screenshot reuses (D-105).
- `excalidraw-app/bridge/codePanel.ts`, `excalidraw-app/bridge/bridgeSession.ts` — the app's side of the bridge; the snapshot URL comes from the connection's stream URL.
- `packages/vscode-bridge/extension/src/stream.ts` — the MJPEG server; it already holds the last frame. It grows one path for the single JPEG.
- `packages/vscode-bridge/extension/src/bridge.ts` — the bridge's message types, if a message is needed at all (the snapshot is an HTTP `GET`, so it probably is not).
- `packages/vscode-bridge/tests/stream.test.ts` — the extension's own tests.
- `excalidraw-app/sidebar/insertIntoScene.ts` — the image insert path (`insertImageIntoScene`), which is what placing a screenshot reuses.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency** anywhere.
- **The library is the oracle**: the video's frame comes from the `<video>` element's own pixels, not from a re-encode.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits — run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-139 ...`), or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, remove the pause before the video capture (AC-139 must fail), show the choice strip before the capture (AC-140 must fail), remove the wireframe (AC-141 must fail), and route the screenshot's OCR somewhere else (AC-142 must fail).
- The scope is `excalidraw-app`, `packages/excalidraw`, `packages/vscode-bridge` and `SPEC.md`. Nothing else may be touched. If a change needs a path outside that, **say so in the note** rather than reaching for it.

## The gates

`node scripts/tins-gate.mjs` must pass 4/4 (typecheck, eslint, prettier, vitest) and `node scripts/rowcheck.mjs --all` must exit 0. The kit's own SPEC lint must pass. In the close note, report **measured** evidence: the size of a captured frame, the time a capture takes, and the on-screen size of the choice strip at two zooms.

