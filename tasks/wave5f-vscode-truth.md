---
id: wave5f-vscode-truth
paths: packages/excalidraw,packages/vscode-bridge,excalidraw-app,SPEC.md
read: docs/superpowers/specs,docs/tins-tasks
base: main
status: merged
---

Wave 5f: make the code panel's colours the colours VS Code ACTUALLY uses, and stop the bridge's own terminal from stealing the editor.

WHY THIS WAVE EXISTS
Two findings from reading the VS Code and VSCodium sources (VS Code 1.144.0, commit 1519239; VSCodium ships no source of its own and its 77 patches touch none of the files involved). Both are corrections, not preferences.

1. THE PANEL'S PALETTE WAS GUESSED. It was written from memory of the classic Dark+ theme, and the research shows the **semantic** token colours - the ones VS Code actually paints, because semantic highlighting is on - differ from the TextMate scope colours. The most visible error: VS Code paints a **keyword** in #C586C0 (purple), not #569cd6 (blue). #569cd6 is the colour of the bare TextMate scope `keyword`, which the semantic keyword token does not even probe - the semantic keyword probes `keyword.control`. So in real VS Code `import`, `def`, `return` and `for` are purple, and the panel paints `import` blue.
2. THE BRIDGE'S OWN TASK CAN TAKE THE EDITOR AWAY. `excalidraw-bridge.run` runs the program in a pseudoterminal. The terminal's LOCATION comes from the setting `terminal.integrated.defaultLocation`, whose default is `view` (the terminal PANEL) - in which case the editor keeps the focus and `vscode.window.activeTextEditor` is untouched. But if that setting is `editor`, the terminal becomes an editor in the editor area, the active editor becomes the terminal, and `activeTextEditor` becomes `undefined` - which is exactly the moment the mirror used to blank. The task must never ask for the focus, whatever the setting says.

WHAT TO BUILD
1. THE PALETTE, exactly as the research measured it. The classic Dark+ (Dark+ and Dark Modern share an IDENTICAL token palette - they differ only in chrome), from extensions/theme-defaults/themes/dark_vs.json and dark_plus.json:
   - default text #D4D4D4
   - comment #6A9955
   - string #ce9178
   - keyword #C586C0
   - control flow #C586C0
   - number #b5cea8
   - function / method #DCDCAA
   - type / class / namespace #4EC9B0
   - variable / parameter #9CDCFE
   - operator #d4d4d4
   - regexp #646695
   - constant / enum member #4FC1FF
   - tag #569cd6
   - storage / type keyword #569cd6
   And the chrome:
   - editor background #1E1E1E
   - gutter background #1E1E1E
   - line number #858585, the active line number #c6c6c6
   - cursor #AEAFAD
   - selection #264F78
   - the current line is a **2 px solid #282828 border**, NOT a tinted band: neither Dark+ nor Dark Modern defines editor.lineHighlightBackground, so VS Code draws an outline (currentLineHighlight.ts:237-257). If the panel draws a tinted band, it should draw the border instead.
   The palette lives in packages/excalidraw/components/vscodeTheme.ts - correct the VALUES there, and keep it a plain data module with no imports (the last wave learned that: importing CodeMirror statically broke a test that mocks @codemirror/view and defeated the lazy loading).
2. THE TASK MUST NOT TAKE THE FOCUS. The task the bridge runs must set its presentation options so the editor keeps the focus: reveal the terminal, never focus it. Whatever terminal.integrated.defaultLocation says, the mirror must keep working - and D-78 (never publish the empty state) already covers the case where the terminal DOES end up in the editor area, but the extension should also not ask for the focus in the first place.
3. NOTE, DO NOT CHANGE: the panel renders the editor ITSELF - CodeMirror, in the app, in the browser. That is deliberate and it is the closest an extension can get. The research confirmed that NO extension API - stable, proposed or internal - can return the editor DOM node, a bitmap or the rendered view: the extension host is a DOM-less Node process and the message bridge is JSON-only, and there is no registered command that snapshots the editor (a repo-wide sweep for copyImage / saveImage / exportImage / captureScreenshot / getEditorDomNode found ZERO matches). So the panel is a RECONSTRUCTION of the editor, rendered in the app, and the research tells us exactly how to make it faithful. Say this in a code comment where the panel's surface is built, so the next person does not go looking for a screenshot API.

SPEC.md: add D-81 to the Decisions table, and the acceptance rows AC-98, AC-99 and AC-100.
- AC-98 the panel's token colours are the ones VS Code paints: a keyword is #C586C0, a comment #6A9955, a string #ce9178, a function #DCDCAA, a type #4EC9B0, a variable #9CDCFE, a number #b5cea8, and the chrome is #1E1E1E on #D4D4D4.
- AC-99 the current line is drawn as a border, the way VS Code draws it, and not as a tinted band.
- AC-100 the bridge's task reveals its terminal without ever asking for the focus.
AC-98 to AC-100 are RESERVED for this wave. Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example it AC-98 the panel paints the VS Code token colours. The kit SPEC lint reads the file and fails if the id is absent.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. NO NEW DEPENDENCY - this wave corrects values, it does not add a grammar.
- LF line endings, no BOM.
- The library own functions are the oracle.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your three new rows must be green.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: the keyword colour put back to #569cd6, the current line drawn as a band again, and the task asking for the focus again.
- The machine: the gate sizes vitest from the free memory, so it takes about three to four minutes. If the vitest step fails with "still loading", that is the known load flake, not your code: re-run with GATE_JOBS=2. If the OS kills the workers (non-zero exit, NO summary line), free memory and re-run.
- There may be ANOTHER gate running when you start (the kit serialises them - it will wait for the lock). That is normal; wait it out.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. Anything you could not do and why, and anything in the brief you found to be wrong.
5. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.
