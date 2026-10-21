---
id: wave7-paste-and-sidebar
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: docs/superpowers/specs,docs/tins-tasks
base: main
status: open
---

Fix three regressions the owner found on 2026-10-21: the sidebar markdown Copy code button no longer pastes a code card, the keyboard paste has the same fault, and the docked sidebar keeps the interaction while the user works on the canvas.

GROUND TRUTH - read in this order:
1. docs/superpowers/specs/2026-10-21-paste-clipboard-and-sidebar-focus-design.md - THE DESIGN. It carries the live reproduction, the measured evidence, the three root causes and the exact fix sites. It is the ground truth for this wave, not a suggestion.
2. SPEC.md - the locked rows are the source of truth.
3. CLAUDE.md and HANDOVER.md - the project rules and the known traps.
4. excalidraw-app/sidebar/insertIntoScene.ts - armCodePasteOnCanvas, clipboardHoldsCode and handleCodePaste.
5. packages/excalidraw/components/App.tsx - pasteFromClipboard, and the two guards that can drop a paste.

THE FOUR DEFECTS

DEFECT 1 - the code card never appears (the critical one).
clipboardHoldsCode compares the trimmed clipboard text with the trimmed stashed code, BYTE FOR BYTE. Windows Chrome stores clipboard text with CRLF. The code that was stashed has LF. So the comparison never matches on Windows, the armed paste is always declined, and the code always arrives as plain text - one bordered text box per line, which is exactly what the owner sees. THE FIX: normalise the line endings on BOTH sides before comparing - CRLF to LF, and a lone CR to LF. Nothing else about the comparison may change. The comparison must stay exact otherwise: a clipboard that holds DIFFERENT code must still produce an ordinary paste, not a code card. Do NOT fix it by comparing only the first line, and do NOT fix it by comparing a prefix - both would paste the wrong code. This hits BOTH the keyboard paste and the context menu Paste, because readSystemClipboard also hands back the CRLF text.

DEFECT 1b - the arm is dropped before the paste ever happens.
DocumentViewer.tsx has useEffect(() => { cancelCodePaste(); return () => cancelCodePaste(); }, [entry]). The cleanup runs on UNMOUNT. Clicking the canvas closes the sidebar by default - Excalidraw closes it unless Keep sidebar open is on - so the owner's own sequence is: click Copy code, click the canvas, the sidebar closes, the viewer unmounts, cancelCodePaste() runs, and the paste arrives with nothing armed. Measured live: after the canvas click the document viewer is gone. THE FIX: the arm survives the sidebar closing. Keep the cancel for the cases that really are a change of mind - the user copies something else, the user opens a DIFFERENT document (the entry change), the paste is consumed, or the user cancels explicitly. The unmount cancel is redundant protection: clipboardHoldsCode already refuses a stale arm, because a clipboard that no longer holds the code must produce an ordinary paste. Do NOT weaken clipboardHoldsCode to compensate - fix the cancel, not the guard.

DEFECT 2 - the keyboard paste is dropped when the pointer is still over the sidebar.
In pasteFromClipboard, the element-under-the-cursor check vetoes the paste unless the pointer is over an HTMLCanvasElement. lastViewportPosition is updated by a DOCUMENT-level pointermove listener, so right after clicking Copy code it holds a point INSIDE THE SIDEBAR. The check then returns early and the paste never happens at all - no elements, no error, no toast. Reproduced live. THE FIX: the pointer-position veto applies to the SYNTHETIC paste event the context menu produces, not to a real keyboard paste. ClipboardEvent.isTrusted separates them: a real key press gives a trusted event, createPasteEvent gives an untrusted one. The isWritableElement half of the guard must stay for BOTH paths - a paste into a text field must never land on the canvas.

DEFECT 3 - the docked sidebar keeps the interaction while the user works on the canvas.
Measured in the live app: the canvas element spans the full container (x 0 to 1280) and the docked sidebar is an absolutely positioned overlay inside that same container (x 986 to 1280). So the sidebar covers the canvas right-hand strip: a wheel gesture there lands on the sidebar and scrolls the SIDEBAR instead of zooming the canvas, and a pan cannot be started there. The overlap itself is deliberate - insertPlacement.ts already computes a cover and places inserted content outside it. What is missing is that the canvas keeps the interaction once the user is working on it. THE FIX: when the user clicks on the canvas, the sidebar loses the pointer - it stops holding the keyboard focus, and it stops being the wheel target - until the pointer comes back to it. Both halves are wanted: (a) no control inside the sidebar may keep the keyboard focus after a canvas click, so that Ctrl+V, the arrow keys and Delete reach the canvas; (b) a wheel gesture that begins over the canvas must reach the canvas, including in the strip the sidebar covers.
A RECIPE WAS PROTOTYPED IN THE LIVE APP AND WORKS - use it or beat it, but the behaviour must match. On a pointerdown on the canvas, set the sidebar pointer-events to none. On a document-level pointermove, compare the pointer coordinates with the sidebar bounding rect - NOT with elementFromPoint, because an element with pointer-events none is never returned by it - and restore pointer-events when the pointer is back over the sidebar. Measured: before a canvas click the element under the sidebar strip is DIV.app-sidebar-panel; after the click it is CANVAS; after the pointer moves back over the sidebar it is the sidebar again. The keyboard half is separate: after a canvas click, blur any focused control inside the sidebar so the canvas keeps the keyboard.
The implementation is your choice, but it has to be OBSERVABLE in a test.

WHAT MUST NOT CHANGE
- The selection auto-copy of prose in the markdown viewer works and must keep working.
- A clipboard holding something other than the stashed code must still produce an ordinary paste.
- The context menu Paste must keep producing a code card.
- The code card rendering - the dark rounded card, the syntax colours, the monospace - is correct already. The owners first screenshot is the target.

SPEC.md: add D-70, D-71, D-72 and D-73 to the Decisions table, and the acceptance rows AC-76, AC-77, AC-78 and AC-79.
- AC-76 a paste of code armed from the sidebars Copy code produces a code card, when the clipboard stores the text with CRLF line endings.
- AC-77 the armed paste survives the sidebar closing: clicking the canvas after Copy code and then pasting still produces a code card.
- AC-78 a keyboard paste is not dropped when the pointer is still over the sidebar; the pointer-position veto applies only to the synthetic context-menu paste.
- AC-79 after a click on the canvas the sidebar holds neither the keyboard focus nor the wheel: a wheel gesture over the canvas reaches the canvas, and no sidebar control is focused.
AC-76 to AC-79 are numbered out of sequence on purpose - AC-65 to AC-69 belong to the video panel wave and AC-70 to AC-75 to the OCR and presenter wave, and those ids are already reserved in their briefs. Do not renumber them.
Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example it AC-76 a CRLF clipboard still produces a code card. The kit SPEC lint reads the file and fails if the id is absent.

THE EXACT ROW SHAPES the kit lint expects - copy these, do not invent a format:
- a decision row: | D-n | <label> | locked | <detail> |
- an acceptance row: | AC-n | <label> | `<check file>` | <detail> |
The lint checks that the id is not duplicated anywhere in SPEC.md, that a decision row status is exactly locked or open or superseded by D-n, and that an acceptance row names a check file which EXISTS and which mentions the row id. It also checks that no dependency in a package.json is unnamed in a locked decision row - wave 7 adds no dependency, so nothing changes there.

RULES THAT ARE NOT NEGOTIABLE
- The gate runs prettier as --list-different, NOT --write. A file that is not already formatted FAILS the gate. After you edit anything - a source file, a test, or the SPEC.md table rows you add - run node_modules\.bin\prettier --write on the files you touched and check that node_modules\.bin\prettier --list-different on them prints nothing. A long table row in SPEC.md is enough to fail it: prettier realigns the whole table.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0. NEVER leave vitest in watch mode: yarn test:app is a bare vitest, so always use --watch=false or vitest run.
- node scripts/rowcheck.mjs --all - your three new rows must be green.
- Oracle-based assertions only. Use the library own functions and the real DOM the app renders; never re-derive a formula the library already owns.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: the line-ending normalisation removed, the unmount cancel restored, the pointer-position veto restored for the keyboard paste, and the sidebar focus release removed. Record what you broke and which test failed.
- The library own functions are the oracle - a test must assert the OBSERVABLE behaviour, not the shape of your own helper.
- LF line endings, no BOM, yarn only - never npm or bun, and no new dependency without explicit justification in the report.
- The machine: the gate runs its read-only steps in parallel and sizes vitest from the free memory, so the full gate takes about three to four minutes. The OS kills vitest workers when memory runs short - the symptom is a non-zero exit with NO summary line and no failing test. That is not a code failure: free memory and re-run.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. How you verified DEFECT 3 in a real browser, not only in a test - the dev server runs at http://localhost:47311/ and there is a second browser page open that you must leave alone.
5. Anything you could not do and why, including anything in the design you found to be wrong.
6. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.

