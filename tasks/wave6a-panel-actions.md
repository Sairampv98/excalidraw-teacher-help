---
id: wave6a-panel-actions
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: 
base: main
status: open
---

# Wave 6a — the panel's actions live in the **properties panel**, not inside the picture

## Why this wave exists

The owner's review of 2026-10-24, in their words:

> *"the screenshot button is inside the panel and i cant click it and the read text button doesnot
> do anything sadly for now ... u can see the extra options with the panel, kind, video, state, live
> things i think all the panels have this y not use this for the ocr, crop and other options instead
> of whatever these buttons that dont click do"*

> *"i cannot take a screen shot from the live window button does nothing and the visibility is not
> there, why is the bridge visible over both the vscode editor and live window even after
> connecting? (y not move it to the extra options that read panel, kind, code, state, and live?)"*

### The diagnosis (measured, not guessed)

1. **The camera and the "Read the text" button are drawn INSIDE the panel overlay.** On a YouTube
   panel the overlay's iframe is a **foreign document**: a click inside it goes to YouTube and never
   reaches the button. The button is *visible* and *dead*. That is why "it does nothing".
2. **The properties panel is the right home.** `packages/excalidraw/actions/actionProperties.tsx`
   already renders the panel's own fieldset - the `Panel / Kind / State / Live` rows the owner is
   pointing at. That panel is ordinary DOM **beside** the canvas, so its buttons always receive
   clicks.
3. **The bridge box floats over the picture.** It is drawn inside the panel overlay, so it covers
   the VS Code editor and the live window even after the connection is made. The owner wants it in
   the properties panel too.
4. **The library already has the host hooks.** `AppProps` carries `panelOcr`, `panelScreenshot`,
   `panelDraft`, `panelRun` and `panelCaptions` (D-59, D-102, D-123, D-124, D-129). The library
   draws the controls and the **host** does the work - so the library can draw these buttons
   anywhere, including the properties panel.

### The rules this wave records

| D-135 | a panel's **actions** live in the properties panel, and the picture never covers them | locked | A button drawn **inside** the panel overlay is a button on top of a picture, and on a YouTube panel the picture is an **iframe**: a foreign document that takes the click and gives it to YouTube. The button is visible and dead, and a teacher cannot tell a dead button from a broken one. The properties panel (`Panel / Kind / State / Live`) is ordinary DOM beside the canvas, so a button there always works. The rule: **the panel's actions belong to the panel's properties, not to the panel's picture** - the camera, the read, and the crop are choices about a panel, and a choice about a panel belongs where the panel's other choices are. |
| D-136 | the bridge box is **not** drawn over the picture | locked | The bridge box (the token field and the Connect button) was drawn inside the panel overlay, so it covered the VS Code editor and the live window - the very things the teacher is looking at. The connection is a property of the **panel**, so the box belongs in the properties panel with the rest of them. The rule: **the chrome never covers the picture it describes**. |

## The rows to add to SPEC.md

Add to the Decisions table, in the established shape `| D-n | <label> | locked | <detail> |`:

| D-135 | a panel's **actions** live in the properties panel, and the picture never covers them | locked | A button drawn **inside** the panel overlay is a button on top of a picture, and on a YouTube panel the picture is an **iframe**: a foreign document that takes the click and gives it to YouTube. The button is visible and dead, and a teacher cannot tell a dead button from a broken one. The properties panel (`Panel / Kind / State / Live`) is ordinary DOM beside the canvas, so a button there always works. The rule: **the panel's actions belong to the panel's properties, not to the panel's picture** - the camera, the read, and the crop are choices about a panel, and a choice about a panel belongs where the panel's other choices are. |
| D-136 | the bridge box is **not** drawn over the picture | locked | The bridge box (the token field and the Connect button) was drawn inside the panel overlay, so it covered the VS Code editor and the live window - the very things the teacher is looking at. The connection is a property of the **panel**, so the box belongs in the properties panel with the rest of them. The rule: **the chrome never covers the picture it describes**. |

Add to the acceptance table, in the shape `| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-174 | the properties panel carries the panel's actions, and the picture carries none of them | `packages/excalidraw/tests/panelChrome.test.tsx` | The actions are where the teacher can reach them (D-135, D-136). Tests: `AC-174 the properties panel carries the screenshot and the read`, `AC-174 the panel overlay carries no action button and no bridge box`. |

## The files to change

- `packages/excalidraw/actions/actionProperties.tsx` - the panel's fieldset gains an **Actions** row
  that draws the host's screenshot and read controls (and whatever else the host offers).
- `packages/excalidraw/components/PanelOverlay.tsx` - the in-panel camera, the in-panel OCR button
  and the in-panel bridge box come **out** of the overlay. What stays in the overlay is the panel's
  own view toggle and its lock - the things that belong to the picture.
- `packages/excalidraw/types.ts` - only if a host control needs a new shape.
- `packages/excalidraw/locales/en.json` - any new label.
- `packages/excalidraw/tests/panelChrome.test.tsx` - the AC-174 tests.

`excalidraw-app` is in scope only if the host must pass something new to the library.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.**
- **Do not lose the host's work.** The screenshot and the OCR flows (D-102, D-59) keep working - the
  buttons move, the behaviour does not change.
- The bridge box must still let the teacher **paste the token and connect** - the box moves, it does
  not lose a feature. The token stays a **secret**: it is never in a URL, never in a payload, never
  in the document.
- The panel's own **view toggle** (live window / mirrored editor) and its **lock** stay where they
  are, unless the owner said otherwise (they did not).
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, with a **YouTube panel** on the canvas
(the case the owner reported - the iframe that eats the click):

1. select the panel, open the properties panel, and show that the **Actions** row there carries the
   screenshot and the read, and that **clicking them works**;
2. show that the panel's picture is **clear** of any button and of the bridge box - the VS Code
   editor and the live window are visible, not covered;
3. show that the **bridge box is in the properties panel** and that pasting a token and pressing
   Connect still connects.

Report what you saw, with the numbers.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-174 tests must FAIL (the actions are not in the properties panel, or the overlay still carries
them). Restore the fix and they must pass again. Report both failures verbatim.

