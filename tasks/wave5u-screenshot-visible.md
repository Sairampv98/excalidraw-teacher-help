---
id: wave5u-screenshot-visible
paths: packages/excalidraw,excalidraw-app,SPEC.md
base: main
status: merged
---

# Wave 5u — the screenshot must be *visible* and must work on every panel

## Why this wave exists

The owner tested the screenshot feature on 2026-10-23 and reported (items 3.2a, 3.4, 5.1–5.5):

> "3.2 ... i can see api.js javascript live window (screen shot button - doesnt seem to work)"
> "3.4 ... i see a lock panel icon (doesnt seem to do anything) on right top corner and the whole right corner of the wireframe cannot be used to resize the panel (no screen shot icon (needs to be attached to the wireframe and visible even if i did not select the wireframe so i can take screenshot (after clicking this button the preview of the screenshot should appear as if it has moved up in the z axis and the canvas/ editor has moved back in the z - axis (visual effect only darkens background, leaving the screenshot to become the thing in focus with those 3 options i mentioned, also add a cropping tool that is turned on by default so we can crop the screenshot and revert the crop back one step aswell) )"
> "5.1 to 5.3 i get a X button after clicking the camera icon"
> "5.4 video does not get a camera icon at all"
> "5.5 normal image doesnot get this option"

So: the camera button is there on a **code** panel, clicking it shows **an X** and **not the three
choices**, the **video** panel has **no camera**, an ordinary **image** has **no "Read the text"**,
and the camera is only reachable **after selecting** the panel.

### The cause of "an X and no choices"

`packages/excalidraw/components/PanelOverlay.tsx:363-403` renders the choice strip. The **buttons**
get `height` and `fontSize` from the chrome, and the **strip** gets `top`, `right`, `gap`, `padding`
and `height` - but the buttons get **no width**, and the strip's `top` is a parameter computed by
the caller. The X the owner sees is a *different* control (the dismiss button of the pending
screenshot). So the strip is either rendered **off the panel** (its `top` is wrong) or its buttons
are **not sized** the way the rest of the chrome is.

Wave 5k established the rule this wave must obey: **the chrome is sized for the SCREEN, and the
one source of the scale is `scene/panelChrome.ts`.** Anything the chrome draws - a button, a strip,
a wireframe - is sized the same way, or it is invisible.

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-114 | every part of the chrome is sized by the **one** source of the scale, including the choice strip and the wireframe | locked | Wave 5k made the chrome's **sizes** screen-sized and put the one conversion in `scene/panelChrome.ts`. But the sizes only reach the DOM through the **inline styles**, and the parts added later - the screenshot's choice strip, the wireframe - were written without asking the chrome first: the strip's buttons got a height and a font size and **no width**, and the strip's `top` came from the caller. So a control that exists in the DOM is not a control the teacher can see or hit. So the rule is now stated for the whole chrome, not for the header: **nothing the chrome draws may size itself**; every size comes from `panelChrome.ts`, and a control that cannot be sized by the chrome must not be drawn. The strip's three buttons are laid out in a row with a real width each, and the strip hangs **on the panel** - its position is computed from the panel's own rect, never guessed. The test is a **measurement**, not an assertion about a style: a control that is **0 px wide** is a control that does not exist (the 0 px screenshot button of wave 5p was exactly this). |
| D-115 | the screenshot button belongs to the **panel**, not to the selection, and **every** panel kind has one | locked | The camera is a property of a panel (it captures that panel), so it must be reachable **whenever the panel is on screen** - not only after the teacher selects it. And a **video** panel can be captured (the owner's item 5.4: the video has no camera at all) - so the camera is on the video's chrome as well as the code's. The rule: **a control that acts on a panel lives on the panel**, visible and hit-testable without any prior selection. |
| D-116 | taking a screenshot **brings the screenshot forward**: the canvas darkens, the preview is the thing in focus, and the three choices belong to it | locked | The owner asked for the visual effect of a **z-axis**: "after clicking this button the preview of the screenshot should appear as if it has moved up in the z axis and the canvas/editor has moved back in the z - axis (visual effect only darkens background, leaving the screenshot to become the thing in focus with those 3 options i mentioned, also add a cropping tool that is turned on by default so we can crop the screenshot and revert the crop back one step aswell)". So the capture does not merely produce a picture: it opens a **focus state** - the canvas behind is dimmed, the captured picture is presented in front, the three choices act on **that** picture, and the picture can be **cropped** before it is placed (the crop is on by default, and one step takes it back). The crop is part of the picture's **own** state - it belongs to the screenshot, not to the canvas - and "revert one step" means the crop can be undone exactly once, to the uncropped capture. |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-151 | the choice strip's three buttons are **visible and hit-testable**, and the strip hangs on the panel | `packages/excalidraw/tests/screenshot.test.tsx` | The strip must be a real control (D-114). Tests: `AC-151 the choice strip's three buttons each have a width and a height`, `AC-151 the strip is positioned inside the panel's own rect`. |
| AC-152 | **every** panel kind carries a camera, and it is reachable **without selecting** the panel | `packages/excalidraw/tests/screenshot.test.tsx` | The camera belongs to the panel (D-115). Tests: `AC-152 a video panel carries a screenshot button`, `AC-152 the screenshot button is rendered for a panel that is not selected`. |
| AC-153 | the capture opens a **focus state**: the canvas dims, the preview comes forward, and the picture can be cropped with one step of revert | `packages/excalidraw/tests/screenshot.test.tsx` | The z-axis effect and the crop (D-116). Tests: `AC-153 a pending screenshot dims the canvas and presents the preview in front`, `AC-153 the crop can be reverted once to the uncropped capture`. |
| AC-154 | an ordinary **image** offers "Read the text" from the canvas's own context menu, **whether or not it was selected first** | `excalidraw-app/tests/useOcr.test.tsx` | The owner's item 5.5: "normal image doesnot get this option". The action exists, the app passes `onOcrImage` (`excalidraw-app/App.tsx:1308`) and the action is in the context menu's list (`packages/excalidraw/components/App.tsx:14096`) - but its **predicate** asks for an image that is **already selected** (`actionOcrImage.ts:43-46`: `element.type === "image" && !!appState.selectedElementIds[element.id]`), so a right-click on an image that was not selected hides the entry. Tests: `AC-154 the context menu of an image offers the ocr entry even when the image was not selected`, `AC-154 the ocr entry is not offered for an element that is not an image`. |

---

## The file map (read before writing)

- `packages/excalidraw/components/PanelOverlay.tsx:344-404` - the choice strip: its buttons' sizes,
  the strip's position, and where the dismiss (X) control is drawn.
- `packages/excalidraw/scene/panelChrome.ts` - **the one source of the scale** (wave 5k). Every
  size the strip, the wireframe and the buttons need goes here, in the same shape as the header's.
- `packages/excalidraw/components/PanelScreenshotWireframe.tsx` - the wireframe; it carries the
  crop (D-116).
- `packages/excalidraw/scene/panelScreenshot.ts` - the pending screenshot's state: the capture, the
  crop, the choice, the focus state.
- `packages/excalidraw/components/PanelChrome.tsx` - where the chrome's buttons live (the camera,
  "Read the text"), and how a panel that is **not selected** still renders its chrome.
- `packages/excalidraw/actions/actionOcrImage.ts` + `packages/excalidraw/actions/types.ts` - the
  OCR-on-an-image action; and the **app's** action registration
  (`excalidraw-app/App.tsx` or wherever `actionManager.registerAction` is called) - the owner's
  item 5.5 says the entry never appears, so check the registration, not just the action.
- `excalidraw-app/bridge/useOcr.ts` - the OCR the entry calls.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency**, and no change to the chrome's **existing** sizes.
- Every size comes from `panelChrome.ts`; the panel's own units are **not** a second source.
- The focus state is **visual**: it dims what is behind and brings the picture forward. It does
  not change the document until the teacher places the picture.
- The crop is **on by default** and reverts in **one** step.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-151 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, take the width off one strip button and show AC-151 fails; remove the
  video panel's camera and show AC-152 fails; turn the crop off by default and show AC-153 fails;
  unregister the OCR action and show AC-154 fails.
- The scope is `packages/excalidraw`, `excalidraw-app` and `SPEC.md`. Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof**: measure the rendered sizes - the three buttons' width and height, the camera's
width and height - and report the numbers. A control that measures **0 px** has not been fixed,
however green the tests are.
