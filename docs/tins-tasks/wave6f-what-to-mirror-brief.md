# Wave 6f — what is mirrored, and follow the cursor

## Why this wave exists

The owner's review of 2026-10-24, in their words:

> *"why is the vscode/vscodium what i want section from the vscode that i want to mirror to the canvas
> option not available? i.e; it should show me the full vscode window (same as when i take a
> screenshot - only when i click change what is mirrored button or something) and i crop the section i
> want mirrored (i should be able to edit it as many times as possible, and maybe it can even have a
> follow the cursor option that dynamically moves the mirrored section based on the position of the
> mouse that is being moved inside the panel)"*

So the teacher wants to mirror **a part** of the editor's window, not all of it:

1. **A "change what is mirrored" control**, which opens the **whole** VS Code / VSCodium window - the
   same picture a screenshot gives (D-102) - so the teacher can see what they are choosing.
2. **A crop of the region** they want mirrored, and they can **change it as many times as they
   like** - it is a setting, not a one-shot.
3. **A follow-the-cursor mode**: the mirrored region **moves with the pointer** inside the panel, so
   the teacher can point at something and the panel follows. It is a **mode** they can turn off.

### The rule this wave records

| D-143 | the teacher chooses **what** is mirrored, and the choice can follow the cursor | locked | The owner: *"why is the vscode/vscodium what i want section from the vscode that i want to mirror to the canvas option not available? i.e; it should show me the full vscode window (same as when i take a screenshot - only when i click change what is mirrored button or something) and i crop the section i want mirrored (i should be able to edit it as many times as possible, and maybe it can even have a follow the cursor option that dynamically moves the mirrored section based on the position of the mouse that is being moved inside the panel)"*. So the panel mirrors the **whole** window, and there is no way to say *"this part"*. The rule: **what is mirrored is a choice, and a choice can be changed as often as the teacher changes their mind.** The follow-the-cursor option is a **mode**, not a one-off: the region follows the pointer inside the panel, and the teacher can turn it off. |

## The rows to add to SPEC.md

**D-143 is already written** - it is in `SPEC.md` on the main branch. Do not add it again; do not
change it.

Add **one** acceptance row to the section **"### Wave 6f — what is mirrored, and follow the cursor"**
in `SPEC.md`, using the reserved id **AC-182**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and the detail must name the test
names, which must themselves start with the row id - for example:
`Tests: \`AC-182 the mirror region can be set and changed again\`, \`AC-182 the follow the cursor mode
moves the region with the pointer\`, \`AC-182 the mirror falls back to the whole window when no
region is set\`.`

## The files to change

- `packages/vscode-bridge/extension/src/windowCapture.ts` - the capture, so that it can capture a
  **region** of the editor's window and not only the whole window.
- `packages/vscode-bridge/extension/media/capture.ps1` - the helper, if the region has to be passed
  down to it (the helper finds its window **by rule**, D-112, D-113).
- `packages/vscode-bridge/extension/src/extension.ts` - the **change what is mirrored** command, and
  the region in the capture descriptor the app receives.
- `packages/vscode-bridge/bridge/src/protocol.ts` - the descriptor carries the region.
- `excalidraw-app/bridge/useScreenshot.ts` (and the panel's capture path) - the app's side.
- `packages/excalidraw/components/PanelOverlay.tsx` - the **change what is mirrored** control on the
  panel, and the **follow the cursor** mode.
- `packages/vscode-bridge/tests/bridge.test.ts` - the AC-182 tests.

## The constraints

- **Spec first**: the acceptance row goes in **before** the code.
- **No new dependency.**
- The whole window remains the **default**: a panel with no region set mirrors the whole window, and
  that is what the teacher sees first.
- The region is a **setting the teacher can change as often as they like**, and it is **per panel**.
- The **follow-the-cursor** mode is optional, is **off** by default, and the teacher can turn it off
  again.
- The capture must still find the editor's window **by rule** (D-112, D-113) - the region does not
  change how the window is found.
- The **token** stays a secret; the region is not a secret and carries nothing sensitive.
- Any new label goes in `packages/excalidraw/locales/en.json` in a **new group called `mirror`**
  inside `labels` - do not add keys to the `panel` group, another wave is editing it.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, with the extension connected to a real
VS Code window:

1. show the **whole** window being mirrored by default;
2. open **change what is mirrored**, **crop** a region, and show that the panel now shows **only**
   that region;
3. **change** the region again and show the new region;
4. turn on **follow the cursor** and move the pointer inside the panel, and show that the mirrored
   region **follows** it;
5. turn it off.

Report what you saw, and say plainly if a step could not be made to work.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-182 tests must FAIL. Restore the fix and they must pass again. Report both failures verbatim.
