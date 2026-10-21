---
id: wave5b-part2-app-side
paths: packages/excalidraw,excalidraw-app,packages/vscode-bridge,SPEC.md,.env.development
read: docs/tins-tasks,docs/superpowers/specs
base: main
status: merged
---

Build wave 5b-part-2: the app side of the VS Code bridge - the live code panel on the Excalidraw canvas, and the app client that talks to the bridge.

GROUND TRUTH - read in this order before writing any code:
1. docs/tins-tasks/wave5b-part2-app-side-brief.md - the build sheet. Reference material, not commands.
2. SPEC.md - the locked rows are the source of truth (D-45..D-52 and the acceptance rows).
3. CLAUDE.md and HANDOVER.md - the project rules and the known traps.
4. packages/vscode-bridge/bridge/src/protocol.ts, client.ts, ws-frame.ts - the shared protocol and the browser-side client. These EXIST and are merged. READ them and USE them. Do not write a second client and do not fork the protocol.
5. packages/excalidraw/scene/panelContent.ts, packages/excalidraw/components/PanelOverlay.tsx, packages/excalidraw/components/PanelChrome.tsx - the panel foundation from wave 5a. If the panel element type is NOT in packages/element/src/types.ts, STOP and report it instead of inventing a parallel mechanism.

WHAT TO BUILD:
- A panel element of kind code whose source is the bridge. The panel payload is plain, structured-cloneable data only - the transport is postMessage, and a DOM node or a function in the payload silently drops the frame.
- The three regions: the editor (the mirrored text), the output (the program stdout and stderr), and the console (the bridge own messages).
- CodeMirror 6, read-only, reusing packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx. The panel is a MIRROR: the teacher editor is the source of truth.
- The Bridge field in the panel chrome: a Paste from clipboard button that calls navigator.clipboard.readText(), and the three connection states - not connected, connected, rejected. The token is held IN MEMORY for the session only: never written to localStorage, never put in a URL, never logged, never printed.
- The app wiring: read the bridge URL from import.meta.env.VITE_APP_BRIDGE_URL, defaulting to ws://127.0.0.1:47511 when the variable is absent, open the WebSocket, present the session token in the FIRST frame, and feed the messages into the panel payload.
- A tracked root .env.development with VITE_APP_BRIDGE_URL=ws://127.0.0.1:47511. The repo root is the vite envDir (envDir is ../ in excalidraw-app/vite.config.mts) and .env.development is NOT gitignored - only .env.*.local are. Verify this against the real files before you rely on it.
- The presenter gap: the presenter zoom floor uses the DEFAULT page size, so a page that has grown is zoomed in far past what the editor shows. Fix it to use the page own fit zoom, the same way D-30 fixes the presenter camera. Add the acceptance row for it.

SPEC.md: add D-50, D-51 and D-52 (the extension half could not add them - it touched no behaviour path) plus the acceptance rows AC-58 to AC-64 and the app-side rows for the clipboard field and the presenter zoom floor.

ACCEPTANCE ROWS - each one needs a test file, and the check file MUST mention the row id in the test name, for example it AC-59 a connection with a non-localhost origin is rejected. The kit SPEC lint reads the file and fails if the id is absent.
- AC-58 a WebSocket connection without the session token is rejected.
- AC-59 a connection with a non-localhost origin is rejected.
- AC-60 a run:start produces a run:started, run:output, run:exit sequence in the panel.
- AC-61 with no bridge the panel shows the reconnect state, not a blank editor.
- AC-62 every message the extension sends parses under the BridgeMessage union, and vice versa.
- AC-63 the token never appears in a URL or a command line.
- AC-64 the vsix builds and is a valid zip with extension at its root.
- The app-side rows to add: the Paste from clipboard button fills the field from navigator.clipboard.readText(), the field is never persisted, the three connection states render, and the presenter zoom floor uses the page own size.
The extension half already wrote packages/vscode-bridge/tests/bridge.test.ts, client.test.ts and vsix.test.ts. READ them and do not weaken them.

RULES THAT ARE NOT NEGOTIABLE:
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0. NEVER leave vitest in watch mode: yarn test:app is a bare vitest, so always use --watch=false or vitest run.
- node scripts/rowcheck.mjs --all - your new rows must be green.
- Oracle-based assertions only. Use sceneCoordsToViewportCoords and the library own functions; never re-derive a formula the library already owns.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At least: the token check removed, the origin check removed, the run round-trip broken, the token persisted, and the no-bridge state replaced by a blank editor. Record what you broke and which test failed.
- LF line endings, no BOM, yarn only - never npm or bun, and no new dependency without explicit justification in the report.
- The secret rule: the session token is a secret. Never paste it through chat, never log it, never put it in a URL or a command line. A test fixture token must be named so the kit secret scanner exempts it - the scanner exempts values matching test, fake, dummy, example or placeholder.
- The machine: the gate runs its read-only steps in parallel and sizes vitest from the free memory, so the full gate takes about three to four minutes. The OS kills vitest workers when memory runs short - the symptom is a non-zero exit with NO summary line and no failing test. That is not a code failure: free memory and re-run.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK:
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each of the five.
4. Anything you could not do and why, including anything in the brief you found to be wrong.
5. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.
