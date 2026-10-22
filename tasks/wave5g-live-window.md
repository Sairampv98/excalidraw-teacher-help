---
id: wave5g-live-window
paths: packages/excalidraw,packages/vscode-bridge,excalidraw-app,SPEC.md
read: SPEC.md,packages/vscode-bridge/bridge/src/protocol.ts,packages/vscode-bridge/bridge/src/ws-frame.ts,packages/excalidraw/scene/panelContent.ts,packages/excalidraw/components/PanelOverlay.tsx,excalidraw-app/bridge/useBridgePanel.ts
base: main
status: merged
---

Wave 5g: the code panel shows the teacher ACTUAL editor window, streamed live from the extension.

WHY THIS WAVE EXISTS
The fork owner asked for the ACTUAL VS Code editor view in the canvas, and the answer is YES - it is possible, and it was measured on this machine before the wave was written:
- ffmpeg 9.0.1 (the full build, with gdigrab) is installed at D:\New folder\ffmpeg-9.0.1-full_build-shared\bin\ffmpeg.exe.
- `ffmpeg -f gdigrab -i title=<the exact window title>` captures a window (measured: 54997 bytes) and `-i hwnd=0x116007C` captures it by handle (measured: 54637 bytes). The title must match EXACTLY - a partial title does not match (measured: "Cant find window").
- A crop (`-vf crop=w:h:x:y`) is relative to the CAPTURED WINDOW, so nobody needs to know where the window sits on the screen (measured: 13819 bytes cropped).
- AND THE CASE THAT MATTERS: a window that is NOT in the foreground still captures its own content (measured with another window on top - the capture came back with the right pixels). So the editor can be streamed while the browser is in front.

THE DESIGN
1. THE EXTENSION FINDS ITS OWN WINDOW and streams frames of it.
   - The extension API exposes no window handle and no geometry, and a title match must be exact, so the extension asks the OS once, at activation, for the handle of the window whose title ends with the workspace folder and the editor name. A short PowerShell call is the cheapest way: `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*<folder>*' }` and take the first `MainWindowHandle`. The path to ffmpeg is a SETTING (`excalidraw-bridge.ffmpegPath`), defaulting to the ffmpeg on PATH, so a teacher without ffmpeg is not broken - the capture simply does not start.
   - The extension then spawns ffmpeg ONCE and keeps it running: `-f gdigrab -framerate 2 -i hwnd=0x... -f image2pipe -vcodec mjpeg -` and reads the JPEG frames off its stdout. It must NOT respawn ffmpeg per frame.
   - The frames are sent to the app as a NEW bridge message, `editor:frame`, carrying the base64 JPEG, the width, the height and a sequence number. The protocol's frames are text, so the JPEG travels base64-encoded.
2. THE PANEL SHOWS THE LIVE VIEW INSTEAD OF THE RECONSTRUCTION.
   - When the panel is connected and a stream is arriving, the editor region shows the frames - the teacher's real editor, with its tab bar, its minimap, its current-line highlight. The image is scaled into the panel with the SAME ASPECT RATIO it has in the editor (object-fit: contain), which is what the owner asked for.
   - The text mirror stays as the FALLBACK: with no ffmpeg, no window, a capture that failed, or a panel that is not connected, the panel shows the mirrored text exactly as it does now. The text mirror is not removed - it is what works without a window, and it is selectable and restyleable, which a picture is not.
3. THE FRAMES NEVER GO INTO THE DOCUMENT. This is the hard rule of this wave. The panel's live state rides inside the element's payload, and the payload is SAVED WITH THE DOCUMENT - so a base64 JPEG per frame in the payload would put the teacher's screen into the .excalidraw file, and grow it by megabytes. The frames must live in the APP's memory only, exactly like the session token (D-50). There must be a test that proves a frame never reaches the element payload.

ARCHITECTURE FACTS, verified on this machine (these are ALREADY TRUE - do not re-derive them, and do not design around a different architecture)

1. THE TRANSPORT IS A WEBSOCKET with a hand-written frame codec at `packages/vscode-bridge/bridge/src/ws-frame.ts`. The frame length is a 64-bit number and there is NO size cap (the codec throws only above `Number.MAX_SAFE_INTEGER`). A base64 JPEG of a few hundred KB therefore fits in ONE frame. Do not add a size limit and do not chunk the frame.

2. THE PROTOCOL IS A DISCRIMINATED UNION with a runtime guard. `packages/vscode-bridge/bridge/src/protocol.ts` holds `BRIDGE_MESSAGE_TYPES` (the list), `BridgeMessage` (the union) and `isBridgeMessage` (the guard). A new `editor:frame` type must be added to BOTH the list and the union AND to the `isBridgeMessage` switch. The round-trip test `packages/vscode-bridge/tests/bridge.test.ts:166` asserts that the SAMPLES list equals `BRIDGE_MESSAGE_TYPES` EXACTLY - so the test FAILS until a sample is added too. That is your teeth for the protocol: adding the type to the union without the guard, or to the list without the sample, breaks it.

3. D-82 HAS A HARD PART, and it is the part that will be wrong if you follow the obvious pattern. The code panel's live state ALREADY rides in the element payload: `CodePanelState` is written into `content.code` by `withCodePanelState` (`packages/excalidraw/scene/panelContent.ts:357`) and the app writes it into the scene with `updateScene` (`excalidraw-app/bridge/useBridgePanel.ts:64`). The payload is saved with the document. So the OBVIOUS implementation - "put the frame in the state, the state is already in the payload" - puts the teacher's screen into the .excalidraw file and is exactly what AC-102 forbids.
   The frames need a SECOND channel that never touches the payload:
   - the LIBRARY owns an in-memory registry (a module-level store in `packages/excalidraw/`, never serialized, never inside an element);
   - the APP pushes each arriving frame into it (the app owns the websocket);
   - `CodePanelSurface` subscribes to it (`useSyncExternalStore` fits) and renders the frame when there is one.
   The registry must be keyed by the panel element's id, so two panels cannot show each other's frames, and it must be cleared when the session ends. It must ALSO be unreachable from the element - a test must show that serialising a panel element after a frame has arrived produces no frame bytes.

4. THE REGION TO RENDER IS `packages/excalidraw/components/PanelOverlay.tsx`, in `CodePanelSurface`, in the `data-testid="code-panel-source"` div, which today renders `<CodePanelEditor value={state.editor.text} />` when a file is open (PanelOverlay.tsx:327). The live view replaces that CONTENT; the tab strip above it (the file name and the language) stays.

5. THE TEXT MIRROR IS THE FALLBACK, and it must keep working. AC-103: with no ffmpeg, no window, or the capture stopped, the panel shows the mirrored text AND says why (D-75 - never be silent about a state you know).

6. THE FRAME'S WIDTH AND HEIGHT MUST BE READ FROM THE FRAME ITSELF - never guessed from the window title and never hard-coded. Either parse the JPEG's SOF marker (a small pure function, easy to unit test) or parse ffmpeg's stderr banner. The reported aspect ratio has to be the CAPTURED region's, so that `object-fit: contain` letterboxes correctly. If you use a crop, the crop offsets are relative to the captured window (measured) - but the DEFAULT is no crop: the whole window, which is the teacher's real editor.

SPEC.md: add D-82 to the Decisions table, and the acceptance rows AC-101 to AC-105.
- AC-101 the extension streams the editor window's frames to the app, and the panel shows them in the editor region at the source aspect ratio.
- AC-102 a frame NEVER reaches the element payload - the panel's live state carries no frame data, so the saved document stays small and the teacher's screen stays out of it.
- AC-103 with no ffmpeg, or with the capture stopped, the panel falls back to the mirrored text and says why.
- AC-104 the capture is started ONCE and the frames are read from a running ffmpeg - a new process per frame is a bug, not a style.
- AC-105 the extension finds its own window by handle, and the ffmpeg path is a setting.
AC-101 to AC-105 are RESERVED for this wave. Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example it AC-102 a frame never reaches the element payload. The kit SPEC lint reads the file and fails if the id is absent.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. NO NEW DEPENDENCY - ffmpeg is an EXTERNAL TOOL the teacher has installed, exactly like the OCR engine (D-59): the extension uses it if it is there and works without it if it is not. The extension's package.json must keep NO dependencies (AC-64).
- LF line endings, no BOM.
- The library own functions are the oracle.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your five new rows must be green.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: a frame written into the payload, the fallback removed, the per-frame process spawn, and the ffmpeg path hard-coded.
- The machine: the gate sizes vitest from the free memory, so it takes about three to four minutes. If the vitest step fails with "still loading", that is the known load flake, not your code: re-run with GATE_JOBS=2. If the OS kills the workers (non-zero exit, NO summary line), free memory and re-run.
- There may be ANOTHER gate running when you start (the kit serialises them - it will wait for the lock). That is normal; wait it out.
- WINDOWS: the harness strips literal double quotes out of a command line, which breaks JSON arguments and even the PowerShell parser. When you build a command string that needs a quote character, use $q = [char]34 and concatenate - never type a literal quote. In a ripgrep pattern, write \x22.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. How the extension finds its window, and what happens when ffmpeg is not installed.
5. How the frames reach the panel WITHOUT going through the element payload - the exact mechanism, and the test that proves it.
6. How the frame's width and height are obtained.
7. Anything you could not do and why, and anything in the brief you found to be wrong.
8. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.
