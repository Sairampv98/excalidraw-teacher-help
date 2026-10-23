---
id: wave5v-chrome-and-shell
paths: packages/excalidraw,excalidraw-app,packages/vscode-bridge,SPEC.md
base: main
status: merged
---

# Wave 5v — the chrome and the shell: the things the owner could not reach

## Why this wave exists

The owner's review on 2026-10-23 lists what they could not use. Each item is a real defect, and
each has a cause in the code that this wave must remove.

| # | what the owner reported | the cause |
| --- | --- | --- |
| 3.1 | "zoom goes to 56 % (in windowed mode) and 36 % (half windowed mode), 73 % (in full screen mode) the − button does nothing at this scale" | the camera is **clamped to the page's fit zoom** - the zoom cannot go below "the page fits the viewport", so the − button is a no-op at the floor and the chrome can never be seen at a small zoom |
| 3.2b | "i also cant see the window to paste the connection string, the connect (button) they are almost invisible" | the bridge box's own chrome (the token field, the Connect button) is **not sized by `panelChrome.ts`** - the same defect wave 5u fixes for the strip, in the box that holds the token |
| 3.3 | "why is the default read text paddle ocr (the worst performer) and not indra ocr (the fastest) and then tessaract (the middle of the pack) just add a drop down next to read text so that we can select either of 3 with a traffic color coding (green - indra, yello - tessaract, paddle - red)" | the engine is a **VS Code setting** (`excalidraw-bridge.ocrEngine`), so choosing it means leaving the whiteboard; and the default is `paddle` because wave 5q shipped it when the owner asked for paddle - which the measurement then showed to be the **slowest** (27,822 ms against indra's 147 ms) |
| 3.4 | "i see a lock panel icon (doesnt seem to do anything) ... and the whole right corner of the wireframe cannot be used to resize the panel" | the lock control and the resize affordance are chrome parts that are drawn but not wired |
| 3.5 | "works but sliding the volume slider completely down does not show the mute icon" | the mute button shows its state from `video.muted` only; a slider at 0 sets `volume = 0` and leaves `muted` alone |
| — | "the toolbars (both) donot notice the sidebar at all they go behind it when i close the side bar only then can i access them properly or i have to move the cursor to the end of the right window (the pills seem to be hidden behind the sidebar)" | the sidebar is **overlaid** on the canvas and the canvas is sized to the whole container, so the canvas's own right-hand controls land **under** the sidebar |
| — | the panel's bridge box said **"Connected to Visual Studio Code ()"** - an empty workspace name | the extension sends `workspace: basename(workspaceRoot)` and the name is empty when the workspace root is missing |

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-117 | the zoom may go **below** the page's fit zoom: the page is the bound for **panning**, not for **zooming out** | locked | The camera is clamped to the page's rect, and the clamp also pins the **zoom** to the value at which the page exactly fits the viewport - so the − button is a no-op at that scale (the owner measured 56 %, 36 % and 73 % in the three window sizes) and the chrome can never be inspected at a small zoom. The page is the bound for **where the teacher may scroll to** (that is the paste-overflow rule, D-31), and it is not a bound on how far **out** the view may zoom: below the fit zoom the page is simply smaller on the screen, with more of it visible. So the zoom's **floor** becomes a fixed small value instead of the page-fit value, and the floor is one number in one place. |
| D-118 | the OCR **engine is chosen in the panel**, and the fastest engine is the default | locked | The engine was a **VS Code setting**, so choosing it meant leaving the whiteboard - and the owner had already asked "i dont see a easy to use ocr option to use it". So the panel's "Read the text" gains a **picker** beside it with the three engines, each carrying its **measured speed** as a colour (indra green, tesseract yellow, paddle red - the traffic lights the owner asked for), and the **default becomes the fastest engine** (indra), because a default that is the slowest of the three is a default nobody wants. The VS Code setting stays as the **fallback** for a machine with no picker. |
| D-119 | the mute button shows the **effective** state, and the volume at zero **is** muted | locked | The button showed `video.muted`, so a slider at 0 left it saying "unmuted" while the video was silent - the owner's exact report ("sliding the volume slider completely down does not show the mute icon"). The video's **effective** state is "muted" when it is muted **or** its volume is 0, and that is what the button shows and what clicking it acts on: clicking a slider-at-zero button unmutes **and** restores a usable volume. The rule: **the control shows the state the user experiences, not the field it happens to be bound to.** |
| D-120 | the chrome's controls that do nothing are **either wired or removed** | locked | The panel carried a **lock** icon that did nothing, and a right-hand corner that could not be used to resize the panel. A control that does not do anything is worse than no control: the teacher spends a click on it and learns nothing. So each of them is either made to work - the lock toggles the panel's lock (which the panel already has) - or **removed**, and the rule is: **a control must have an effect or must not be drawn.** The resize corner, if it is kept, resizes the panel and is a real hit target at the chrome's size. |
| D-121 | the canvas's own controls are laid out in the space the **sidebar leaves**, not under it | locked | The sidebar is **overlaid** on the editor container and the canvas is sized to the **whole** container, so the canvas's right-hand controls - the top toolbar's right end, the page bar's right end - land **underneath** the sidebar and can only be reached by closing the sidebar or scrolling to the far edge (the owner's exact report). So the canvas's layout is given the sidebar's width as a **reserved** space: the controls sit beside the sidebar, never beneath it, and the reservation is the sidebar's actual width, so it tracks the sidebar being opened and closed. |
| D-122 | the bridge says **which** editor it is, and the workspace's name is never blank | locked | The panel said *"Connected to Visual Studio Code ()"* - the workspace's name was empty, so the teacher could not tell **which** folder (or which of two editors) the panel was showing. So the bridge's hello carries the workspace's name **when there is one** and says plainly that there is **no folder open** when there is not - never an empty pair of brackets. The rule: **an empty field is a bug; say what is missing.** |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-155 | the − button zooms out **below** the page's fit zoom, to a fixed floor | `excalidraw-app/tests/pageBar.test.tsx` | The zoom floor is a number, not the page fit (D-117). Tests: `AC-155 the zoom can go below the page fit zoom`, `AC-155 the zoom stops at the fixed floor`. |
| AC-156 | the panel's "Read the text" carries an **engine picker** with the three engines and their speed colours, and the default is the fastest | `excalidraw-app/tests/useOcr.test.tsx` | The engine is chosen in the panel (D-118). Tests: `AC-156 the read button carries a picker with the three engines`, `AC-156 the picker marks each engine with its measured speed colour`, `AC-156 the default engine is indra`. |
| AC-157 | the mute button shows the **effective** state, and a volume at zero is muted | `packages/excalidraw/tests/videoPanel.test.tsx` | The control shows what the user experiences (D-119). Tests: `AC-157 a volume of zero shows the muted state`, `AC-157 the mute button restores a usable volume`. |
| AC-158 | every control the chrome draws has an **effect**, and the canvas's controls are not under the sidebar | `packages/excalidraw/tests/panelChrome.test.tsx` | No dead controls; the layout reserves the sidebar's space (D-120, D-121). Tests: `AC-158 the panel's lock control toggles the panel's lock`, `AC-158 the canvas's controls are laid out beside the sidebar and not under it`. |
| AC-159 | the bridge names the **workspace**, and says so plainly when there is none | `packages/vscode-bridge/tests/bridge.test.ts` | No empty field (D-122). Tests: `AC-159 the hello carries the workspace name when there is one`, `AC-159 the hello says there is no folder open rather than carrying an empty name`. |

---

## The file map (read before writing)

- The **zoom floor**: `packages/excalidraw/scene/pages.ts` (`clampCameraToPage`, `getPageClampRect`)
  and the app's zoom control (`excalidraw-app/components/PageBar.tsx`, and the library's zoom
  actions). The floor must be **one** number in one place.
- The **bridge box** (the token field, the Connect button): `packages/excalidraw/components/PanelChrome.tsx`
  and `excalidraw-app/bridge/useBridgePanel.ts` - the box's chrome must be sized by
  `scene/panelChrome.ts` like the rest.
- The **engine picker**: `packages/excalidraw/components/PanelChrome.tsx` (the "Read the text"
  button) and `excalidraw-app/bridge/useOcr.ts` (the engine the panel is told about, and the
  **measured** times per engine - the extension already reports which engine ran and how long it
  took, AC-125, so the panel has the numbers to colour with).
- The **mute button**: `packages/excalidraw/components/PanelOverlay.tsx` (`videoPanelSurface`).
- The **lock and the resize corner**: `packages/excalidraw/components/PanelChrome.tsx` and the
  panel's lock/unlock path in `packages/excalidraw/scene/lockPanel.ts`.
- The **sidebar and the canvas's layout**: `excalidraw-app/App.tsx` (the sidebar's width and the
  canvas's size) and `packages/excalidraw/components/App.tsx` (where the canvas's own controls are
  positioned).
- The **workspace name**: `packages/vscode-bridge/extension/src/extension.ts` (the `workspace` it
  sends) and `packages/vscode-bridge/bridge/src/protocol.ts`.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.**
- Every size comes from `panelChrome.ts`; the panel's own units are **not** a second source.
- The engine's **measured** times are the ones the project already records (the extension reports
  them; `excalidraw-app/ocr/benchmark-result.json` holds the full table) - do not invent numbers.
- The panel's picker changes the engine **for that panel**; the VS Code setting remains the
  fallback.
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-155 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, put the page-fit zoom back as the floor and show AC-155 fails; make the
  mute button read `video.muted` only and show AC-157 fails; remove the sidebar's reservation and
  show AC-158 fails.
- The scope is `packages/excalidraw`, `excalidraw-app`, `packages/vscode-bridge` and `SPEC.md`.
  Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof**: measure on screen - the zoom reaching below the page-fit value, the mute
button's state at volume 0, the engine picker's colours, the token field's and Connect button's
size, and the canvas's right-hand controls **beside** the sidebar rather than under it. Report the
numbers.
