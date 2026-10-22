---
id: wave5k-panel-chrome
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: SPEC.md,packages/excalidraw/components/PanelOverlay.tsx,packages/excalidraw/components/PanelChrome.tsx,packages/excalidraw/css/styles.scss,packages/excalidraw/tests/videoPanel.test.tsx,packages/excalidraw/tests/codePanel.test.tsx
base: main
status: open
---

Wave 5k: the panel's chrome survives the zoom, the video's volume is usable and tested, and the panel is never blank.

WHY THIS WAVE EXISTS
The owner looked at the two panels (the video panel and the VS Code panel) and said the UI was atrocious, and that the video's volume slider did not mute. Both are real, and both have the same root cause: the panel's chrome is sized in FIXED CSS PIXELS while the panel itself is scaled by the canvas zoom.

THE FACTS, MEASURED ON THE OWNER'S MACHINE (already true - do not re-derive, but DO measure to confirm)

1. THE PANEL IS A DOM OVERLAY SCALED BY THE CANVAS ZOOM. `packages/excalidraw/components/PanelOverlay.tsx` places the panel with a transform of the form `translate(...) scale(<zoom>) translate(...)`. At the 51% zoom of a 1925x881 window the whole panel is scaled to 0.511.
2. THE CHROME DOES NOT SCALE WITH IT, SO IT VANISHES. Measured on the live app: the code panel's header box was **266 x 11 CSS pixels** (the panel was 266 x 194), the video's control buttons use `font-size: 10px` (`packages/excalidraw/css/styles.scss`), the volume slider is **48 px wide**, and the track select is 11 px. At 51% zoom the controls are about 5 px tall and the header text overlaps. That is the "atrocious" part: the CONTENT is right, the CONTROLS are not.
3. THERE IS NO TEST FOR THE VIDEO'S VOLUME OR MUTE. `packages/excalidraw/tests/videoPanel.test.tsx` mentions neither `volume` nor `muted`. The code sets the element (`PanelOverlay.tsx:836-844` sets `video.volume`, `:846-857` toggles `video.muted`), so the likeliest explanation for the owner's report is that the control is too small to hit accurately - not that the logic is wrong. The wave must make the control usable AND pin the behaviour with a test, so the question stops being a guess.
4. A BLANK REGION IS A D-75 VIOLATION. When the bridge is not connected, the code panel's source region renders an EMPTY editor - a black box with no explanation. This is exactly what the owner saw last night (an app holding a dead token). The panel must say why.

WHAT THIS WAVE DOES

A. THE CHROME KEEPS ITS SIZE ON SCREEN.
- The panel's own transform already knows the zoom (the scale factor in the transform). The chrome inside the panel - the header of both panels, the video's control strip, the buttons, the sliders, the selects - must be sized against the INVERSE of that scale, so a control is the same number of screen pixels whatever the zoom is.
- The mechanism is the panel's: expose the scale as a CSS custom property on the panel element (for example `--panel-scale`, the scale the panel is rendered at), and size the chrome with it. Do not hard-code a number and do not read the zoom a second time from a different place - the transform is the single source of truth.
- The header must have a HEIGHT that fits its text at that size (it is a fixed 21 scene units today, which is why the text overlaps), and the control strip must not be squeezed to nothing.
- The same rule applies to the panel chrome OUTSIDE the panel - the lock button, the bridge field, the OCR button - which is drawn by `PanelChrome.tsx` and positioned with `panelCornerPosition`. Those are positioned in viewport coordinates, so they are already unscaled; check that and do not change what does not need changing.
- The rule to state in the SPEC: **the chrome is sized for the SCREEN, the content for the PANEL.**

B. THE VIDEO'S VOLUME AND MUTE GET A TEST AND A USABLE CONTROL.
- A test that drives the slider and asserts the element's own value: the volume slider sets `video.volume`, the mute button sets `video.muted`, and the two agree with what the control shows. The element is the truth; the React state mirrors it (that is the existing rule - keep it).
- A test that the control is REACHABLE: the slider is big enough to hit, and the mute state is visible (a muted slider says so). Measure the control's rendered size in the test, so a future change cannot quietly shrink it back to nothing.
- The volume slider must be visibly a volume: the muted state has to be readable at a glance, not only in the DOM.

C. THE PANEL NEVER SHOWS A BLANK REGION.
- When the bridge is not connected - or connected but with no file and no capture - the code panel's source region says WHY, in the same words the live view uses. A blank editor is not an answer.
- The same for the video panel: a panel whose file is gone says so instead of showing an empty frame.
- This is D-75 ("a failure is a message, not a silence"), and it is the defect that made last night's black panel look like a broken build.

SPEC.md
Add the decision rows D-92 (the chrome is sized for the screen and the content for the panel, and the panel's own transform is the single source of truth for the scale) and D-93 (the panel is never blank: a region with nothing in it says why).
Add the acceptance rows AC-128 to AC-132:
- AC-128 the panel's chrome keeps its size on screen at any canvas zoom - the header is tall enough for its text and the control strip is usable, measured in a test at two different zooms.
- AC-129 the video's volume slider sets the element's volume, the mute button sets the element's muted, and the control says which state it is in - all three pinned by a test.
- AC-130 the code panel's source region is NEVER blank: with the bridge disconnected, and with a file but no content, it says why.
- AC-131 the video panel says so when its file is gone, instead of showing an empty frame.
- AC-132 the video's captions still live OUTSIDE the player, in the text element beside it - the rule from 2026-10-21 must not be broken by the chrome work.
AC-128..AC-132 are RESERVED for this wave. Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example `it("AC-130 the code panel's source region is never blank", ...)`. The kit SPEC lint reads the file and fails if the id is absent.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. NO NEW DEPENDENCY.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your new rows must be green.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: the chrome scaled back to fixed pixels, the volume test removed, and the blank region back to an empty editor.
- The machine is BUSY and the gate takes 6-9 minutes here. If the vitest step fails with "still loading", re-run with GATE_JOBS=2. If the OS kills the workers (non-zero exit, NO summary line), free memory and re-run.
- WINDOWS: the harness strips literal double quotes out of a command line, which breaks JSON arguments and even the PowerShell parser. When you build a command string that needs a quote character, use $q = [char]34 and concatenate - never type a literal quote. In a ripgrep pattern, write \x22.
- PowerShell 5.1 has no [uint] type accelerator - use [uint32].

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. The measured sizes before and after: the header's height and the control strip's, at two zooms, in screen pixels.
5. The volume test: what it asserts, and how the mute state is visible.
6. The words the panel now shows when the bridge is disconnected and when a file is gone.
7. Anything you could not do and why, and anything in this brief you found to be wrong.
8. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.

