---
id: wave6b-crop-read-engine-ladder
paths: excalidraw-app,packages/excalidraw,packages/vscode-bridge,SPEC.md
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

# Wave 6b — one crop-and-read action, the engine ladder, and a loading state

## Why this wave exists

The owner's review of 2026-10-24, in their words:

> *"the screenshot works but as u can see i only see 1 out of the 3 options, maybe we should combine
> the cropping and the ocr together, default uses tessaract, with vscode/vscodium bridge it can use
> indra and if nothing works they can use paddle put in a loading animation so they know when to
> expexct the text to be come visible again."*

Three things, and they belong together:

1. **Combine the crop and the read.** Today they are separate flows: you crop for the *screenshot*,
   or you read, but not "read the text in the region I cropped". The read must take the **cropped
   region**.
2. **The engine is a ladder, not a setting.** The owner names the order: **tesseract** by default,
   **indra** when the VS Code / VSCodium bridge is there, and **paddle** when nothing else works.
   The measured times on this box are the reason it matters: **indra 147 ms, tesseract 278 ms,
   paddle 27,822 ms** - and paddle is the one that needs the Python sidecar.
3. **A loading animation.** A read that takes 28 seconds and shows nothing looks exactly like a
   broken button - which is what the owner reported.

### The rules this wave records

| D-137 | the crop and the read are **one** action, and the engine is chosen by what the machine can actually do | locked | The owner asked for both in one breath: *"maybe we should combine the cropping and the ocr together, default uses tessaract, with vscode/vscodium bridge it can use indra and if nothing works they can use paddle"*. So the read takes the **cropped region** - one action, not two - and the engine is a **ladder**, not a setting the teacher has to know about: **indra** when the bridge is connected (147 ms on this box), **tesseract** when it is not (278 ms, and it needs nothing but the browser), and **paddle** only as the last resort (27,822 ms - and it is the one that needs the Python sidecar). The ladder walks itself and says which engine ran and why the one before it did not. The rule: **a teacher should never have to choose an engine; the machine chooses, and says what it chose.** |
| D-138 | a slow read is **visible**: the panel says it is reading, and the teacher is not left with a dead button | locked | PaddleOCR on this box takes **27,822 ms** - nearly half a minute - and a button that does nothing for half a minute looks exactly like a button that is broken (which is what the owner reported). So a read that is running shows a **loading state**: the control says it is reading, and it can be **cancelled**. The rule: **an action that takes time says so while it takes it.** |

## The rows to add to SPEC.md

**D-137 and D-138 are already written** - they are in `SPEC.md` on the main branch. Do not add them
again; do not change them.

Add **one** acceptance row to the section **"### Wave 6b — one crop-and-read action, and the engine
ladder"** in `SPEC.md`, using the reserved id **AC-174**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and the detail must name the test
names, which must themselves start with the row id - for example:
`Tests: \`AC-174 the read uses the cropped region\`, \`AC-174 the engine ladder runs indra with the
bridge, tesseract without it, and paddle only as a last resort\`, \`AC-174 the answer says which
engine ran and why the one before it did not\`.`

## The files to change

- `excalidraw-app/bridge/useOcr.ts` - the ladder: which engine is asked for, in what order, and what
  is reported back.
- `excalidraw-app/ocr/engines.ts` - the engines the app can run **itself** (tesseract runs in the
  browser), and how the app knows which are available.
- `packages/vscode-bridge/bridge/src/ocrClient.ts` and `packages/vscode-bridge/bridge/src/ocr.ts` -
  the extension's side of the ladder, if the ladder needs to walk there.
- `packages/excalidraw/components/PanelChrome.tsx` - the **loading state** on the control, and the
  **cancel**.
- `packages/excalidraw/locales/en.json` - the new labels, in a **new group called `ocrLadder`**
  inside `labels` - do not add keys to the `panel` group, another wave is editing it.
- `excalidraw-app/tests/ocrBridge.test.tsx` - the AC-174 tests.

## The constraints

- **Spec first**: the acceptance row goes in **before** the code.
- **No new dependency.**
- The OCR **never runs in the browser** when the bridge is there - the engine lives in the
  extension's Node process (D-59). The browser engine is the **fallback** for a machine with no
  bridge.
- The ladder must **report** which engine ran and **why** the one before it did not. A silent
  fall-back is the kind of thing this project keeps refusing (D-75, D-93, D-125).
- The **loading state** must be cancellable, and cancelling must leave the panel usable.
- The read's **result** must say where it went (wave 6c places it; this wave makes the engine and
  the wait honest).
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, with the extension connected:

1. start a read of a **cropped** region and show the **loading state** while it runs, and that it
   says which engine it is using;
2. show that with the bridge connected the engine is **indra** and that the time is the measured
   order of magnitude (tens to hundreds of milliseconds);
3. show that with the bridge **gone** the engine falls back to **tesseract** and still reads;
4. show the **cancel** works.

Report the times you measured.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-174 tests must FAIL. Restore the fix and they must pass again. Report both failures verbatim.

