---
id: wave6c-crop-and-placement
paths: excalidraw-app,packages/excalidraw,SPEC.md
read: 
base: main
status: open
---


## One note after wave 6a (read this first)

Wave 6a has since landed: the panel's actions are no longer inside the picture. The camera, the
**Read the text** button with its engine picker, and the bridge box now live in the panel's own
fieldset in the **properties panel** (packages/excalidraw/components/PanelActions.tsx, drawn by
packages/excalidraw/actions/actionProperties.tsx). The panel's overlay keeps only the view toggle
and the lock.

So when this wave touches "the control", it means **the control in the properties panel** -
packages/excalidraw/components/PanelActions.tsx - and not PanelChrome.tsx. The chrome is a thin
outline with the lock. Every test id still works wherever the control lives:
panel-screenshot-button, panel-ocr-button, panel-ocr-engine-picker, panel-ocr-engine-button,
panel-ocr-engine-list, panel-ocr-engine, panel-ocr-engine-dot, panel-ocr-message,
panel-bridge, panel-bridge-token, panel-bridge-paste, panel-bridge-connect,
panel-bridge-state.

One behaviour of the app to know: the properties panel **collapses into an edge pill** about three
seconds after it opens, so a click on it must land while it is open.

# Wave 6c — the crop really crops, and the placement flows are in the owner's order

## Why this wave exists

Two of the owner's items, in their own words:

> *"cropping of images doesnot seem to work i can see the handles to crop the image but not do anything
> to it"*

> *"the screenshot is correctly poping up but the panels are also in the same z plane, as u can see i
> see a draggable option that shows me where the screenshot should goto in the same page (position
> great addition but, we should get that option after selecting the 1st option (*crop image)->insert
> image in this page -> (*crop image)-> select where the screenshot goes to (and the popup vanishes and
> we return back to the canvas instead of how it is now), ocr/read the text and wher the text goes
> i.e; 2nd option (*crop image)->read text in this cropped region->select where the extracted text
> goes to and finally 3rd option (*crop image)->insert image in another page-> select the page (through
> the page selecter ribbon-> (*crop image)-> select where the screenshot goes to"*

So four fixes:

1. **The crop handles must work.** They are drawn; dragging one does nothing. A handle that cannot
   be moved must not be drawn, and a handle that can be moved must change the result.
2. **The order is the owner's order**: the **crop first**, the **target last**. Today the wireframe
   ("the screenshot goes here") appears at the same time as the picture and competes with the panels
   in the same z-plane.
3. **The three flows**, written out by the owner:
   - *(crop image) -> insert image in this page -> (crop image) -> select where the screenshot goes to*
     - and the popup **vanishes** and the canvas comes back.
   - *(crop image) -> read text in this cropped region -> select where the **extracted text** goes to*
   - *(crop image) -> insert image in **another page** -> select the page (through the **page selector
     ribbon**) -> (crop image) -> select where the screenshot goes to.
4. **The wireframe is above the panels**, and the canvas is dimmed behind it (D-116 already asks for
   the dimmed background and the picture in focus).

### The rules this wave records

| D-139 | the crop really **crops**: the handles change the picture that is placed | locked | The owner saw the crop handles and could not move them: *"cropping of images doesnot seem to work i can see the handles to crop the image but not do anything to it"*. A crop that is drawn but does not change the picture is a **promise the panel does not keep**, and the picture that lands on the canvas is the uncropped one. So the handles **are** the crop: dragging one changes the region, the region is what is read and what is placed, and one step takes the crop back (D-116). The rule: **a handle that cannot be moved must not be drawn; a handle that can be moved must change the result.** |
| D-140 | the placement flows are in the owner's **order**, and the picture hands the canvas back when it is placed | locked | The owner wrote the three flows out: *(crop image) -> insert image in this page -> (crop image) -> select where the screenshot goes to*, and the popup must **vanish** and return to the canvas; *(crop image) -> read text in this cropped region -> select where the extracted text goes to*; and *(crop image) -> insert image in another page -> select the page (through the page selecter ribbon) -> (crop image) -> select where the screenshot goes to*. So the **crop comes first**, the target is chosen **after** it, and the flow that writes **text** asks where the **text** goes - not where the picture would go. The wireframe ("the screenshot goes here") is a **guide on the canvas**, so it must not compete with the panels in the same z-plane (D-116): it is above them and the canvas is dimmed behind it. The rule: **the teacher chooses the target last, and a finished placement gives the canvas back.** |

## The rows to add to SPEC.md

**D-139 and D-140 are already written** - they are in `SPEC.md` on the main branch. Do not add them
again; do not change them.

Add **two** acceptance rows to the section **"### Wave 6c — the crop really crops, and the placement
flows are in the owner's order"** in `SPEC.md`, using the reserved ids **AC-175** and **AC-176**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and each detail must name the test
names, which must themselves start with the row id.

## The files to change

- `packages/excalidraw/components/PanelScreenshotFocus.tsx` - the crop: the handles, the drag, the
  reverted crop, and the focus state's stacking.
- `packages/excalidraw/components/PanelScreenshotWireframe.tsx` - the wireframe, and its place above
  the panels.
- `packages/excalidraw/components/PanelOverlay.tsx` - the choice strip and the flows' order.
- `packages/excalidraw/scene/panelContent.ts` - where the crop lives (it is the **screenshot's** own
  state, D-116).
- `excalidraw-app/` - the host's side: taking the picture, putting it on the canvas, and the **page
  selector ribbon** for the third flow.
- `packages/excalidraw/tests/panelScreenshotFocus.test.tsx` - the AC-175 and AC-176 tests.

## The constraints

- **Spec first**: the acceptance rows go in **before** the code.
- **No new dependency.**
- The crop belongs to the **screenshot**, not to the canvas (D-116), and the crop can be reverted
  **one step** (D-116).
- The wireframe must be **above** the panels and the canvas **dimmed** behind it - the owner called
  the z-plane clash out explicitly.
- The flow that writes **text** must ask where the **text** goes. The read's text is placed as text
  on the canvas, not as a picture.
- The third flow must go through the **page selector ribbon** before the crop.
- A finished placement must **close the popup** and give the canvas back.
- Any new label goes in `packages/excalidraw/locales/en.json` in a **new group called `crop`**
  inside `labels` - do not add keys to the `panel` group, another wave is editing it.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**:

1. drag a **crop handle** and show that the **placed picture** is the cropped one - measure the
   placed image's size and compare it with the uncropped capture;
2. show the **wireframe above** the panels, with the canvas dimmed behind it;
3. run the **three flows** in order and show that each one closes the popup and hands the canvas
   back, and that the second one asks where the **text** goes.

Report what you saw.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-175 and AC-176 tests must FAIL. Restore the fix and they must pass again. Report both failures
verbatim.

