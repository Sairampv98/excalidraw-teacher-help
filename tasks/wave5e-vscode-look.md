---
id: wave5e-vscode-look
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: docs/superpowers/specs,docs/tins-tasks
base: main
status: merged
---

Build wave 5e: make the code panel READ like a VS Code editor, and answer the owner's question about what the panel is.

WHY THIS WAVE EXISTS
The owner's words, 2026-10-21, after seeing the live code panel for the first time: "i thought i could get the actual vscode editor view to become visible in the canvas where it by default covers 50% of the canvas and why does the canvas look like a text box".

Three things are being asked for:

1. **THE ANSWER FIRST, THEN THE LOOK.** The panel mirrors the editor's **TEXT** - what the teacher is teaching from - and the program's output. It is not a pixel mirror of the VS Code window, and it cannot be: the extension API that VSCodium and VS Code ship (`resources/app/out/vscode-dts/vscode.d.ts`, 763 KB) has **no** screenshot, capture-image or canvas-export facility of any kind - an extension gets the document, the text and the selection, never the rendered pixels. A literal window view in the canvas is a **screencast**, and that is exactly what the VIDEO panel is for (wave 5c). The panel is the live, editable, selectable text - which is what a teaching canvas wants, because the teacher can restyle it, put it in a diagram, and present it. That decision is locked as D-51. This wave does NOT change it. It changes how the panel LOOKS, so that it reads as an editor rather than as a text box.

2. **THE FILE NAME.** The panel must say WHICH file it is mirroring - the file name and the language, the way a VS Code tab says it. Right now the teacher sees code with no name, which is why it reads as a text box. The name comes from the mirrored editor's uri, which the bridge already sends (`editor:content` carries `uri` and `language`).

3. **THE VS CODE LOOK.** The mirrored code is rendered in the VS Code dark theme - the classic #1e1e1e background, the #d4d4d4 default text, and the VS Code token colours (keywords #569cd6, functions #dcdcaa, strings #ce9178, comments #6a9955, control flow #c586c0, variables #9cdcfe) - so the panel looks like the editor the teacher is looking at, at a glance, from across the room. The line numbers are already there. The code card (the thing that gets PASTED, `excalidraw-app/sidebar/codeCard.ts`) already has its own dark background and its own syntax colours and must NOT change - this is the panel's own surface.

4. **THE PANEL'S SIZE.** The owner asked for the editor view to cover **half the canvas** - 990 x 1024 on a 1980 x 2048 canvas. The panel's size is currently a fixed 520 x 380 scene units, which is a fifth of that. So the panel's default size must be a share of the **visible canvas**, not a constant: it must come out at roughly half the visible width and half the visible height on a big canvas, and it must stay usable on a small one (clamp it, for example to 280 - 1200 scene units wide and 200 - 900 tall). The panel is created in `excalidraw-app/bridge/insertCodePanel.ts`, where the viewport size is already known.

WHAT TO BUILD
- A header on the panel's editor region: the mirrored file's name and its language. When there is no file open, the header says so with the same wording the panel already uses for that case.
- The mirrored code in the VS Code dark theme, with the line numbers that are already there.
- The editor region keeps the space it needs: the chrome, the output region and the console region must not squeeze the code out of the panel. If the panel has to grow to keep the code readable, grow it - the owner expects the editor view to be a substantial part of the canvas.
- Everything else about the panel stays as it is: read-only, the three connection states, the bridge field, the program output, the console.

SCOPE - the files you own (the task scope the kit enforces)
packages/excalidraw, excalidraw-app, SPEC.md

OUT OF SCOPE
- The protocol, the bridge and the extension - they already send the file name and the language (D-78 sends the file the teacher is teaching from; D-51 sends the uri and the language). Do NOT change packages/vscode-bridge.
- The code CARD (the pasted thing) - its colours and its layout are not this wave's business.
- The video panel and the caption binding - wave 5c owns those. Read what it did and fit with it; do NOT undo it.
- Do NOT commit. The kit close does the committing.

SPEC.md: add D-80 to the Decisions table, and the acceptance rows AC-92, AC-93, AC-94 and AC-95.
- AC-92 the panel's editor region names the file it is mirroring, and says so when there is none.
- AC-93 the mirrored code is rendered in the VS Code dark theme, with its line numbers.
- AC-94 the code region keeps its height: the chrome, the output and the console do not squeeze the code out of the panel.
- AC-95 a new code panel is about half the visible canvas - its size is a share of the viewport, not a constant.
AC-92 to AC-95 are RESERVED for this wave. Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example it AC-92 the panel names the mirrored file. The kit SPEC lint reads the file and fails if the id is absent.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. NO NEW DEPENDENCY.
- LF line endings, no BOM.
- The library own functions are the oracle. Never re-derive a formula the library already owns.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your three new rows must be green.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing. A long table row in SPEC.md is enough to fail it.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: the file name removed, the dark theme removed, the code region squeezed, and the size put back to a constant. Record what you broke and which test failed.
- The machine: the gate runs its read-only steps in parallel and sizes vitest from the free memory, so the full gate takes about three to four minutes. The OS kills vitest workers when memory runs short - the symptom is a non-zero exit with NO summary line and no failing test. That is not a code failure: free memory and re-run. If the gate's vitest step fails with "still loading", that is the known load flake, not your code: re-run with GATE_JOBS=2.
- There may be ANOTHER gate running when you start (the kit serialises them - it will wait for the lock). That is normal; wait it out.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. A screenshot of the panel with the file name header and the dark theme, if you can produce one - the owner judges this by eye.
5. Anything you could not do and why, including anything in the brief you found to be wrong.
6. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.
