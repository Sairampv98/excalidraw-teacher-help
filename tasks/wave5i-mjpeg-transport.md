---
id: wave5i-mjpeg-transport
paths: packages/vscode-bridge,packages/excalidraw,excalidraw-app,SPEC.md
read: SPEC.md,packages/vscode-bridge/bridge/src/protocol.ts,packages/vscode-bridge/extension/src/bridge.ts,packages/vscode-bridge/extension/src/windowCapture.ts,packages/vscode-bridge/extension/media/capture.ps1,packages/excalidraw/components/PanelOverlay.tsx,excalidraw-app/bridge/useBridgePanel.ts
base: main
status: merged
---

Wave 5i: the panel stops re-rendering on every frame and on every keystroke.

WHY THIS WAVE EXISTS
The owner asked for it after reading the two repos he pointed us at. The idea worth taking is WindowStream's TRANSPORT: it serves the captured window as an MJPEG stream (`multipart/x-mixed-replace`) over HTTP, and the browser plays it in a plain `<img>`. We do not adopt WindowStream itself - it is a standalone tray app, needs its own install, has no authentication and serves the whole LAN - but we take its transport, its change detection and its client-area capture, and we keep our own capture (which is proven on this machine) and our own authenticated loopback bridge.

This wave has ONE theme: the panel should not do per-frame or per-keystroke work that the browser or a clock can do better.

WHAT WE MEASURED ON THE OWNER MACHINE (already true - do not re-derive, but DO re-measure on a real window to confirm)

- TODAY, one frame costs the app: the websocket carries 154,512 bytes (a 115,884-byte PNG, base64-inflated), the app JSON-parses it, builds a ~154 KB data URL, re-renders the panel and swaps the image. Measured on this machine: 0.1 ms parse + 3.2 ms DOM swap and layout = 3.3 ms of main thread per frame, and 5 React re-renders of the panel per second.
- THE CAPTURE ALREADY WORKS on an Electron window: `PrintWindow` with `PW_RENDERFULLCONTENT` returns real content (mean luminance 215.9 on a live VS Code window), even when another window is on top of it.
- `PrintWindow` with FLAGS 3 (`PW_CLIENTONLY | PW_RENDERFULLCONTENT`) ALSO WORKS on an Electron window: mean luminance 215.899 on the same live VS Code window, and it renders the CLIENT AREA (1282x674 for a 1297x681 window - the title bar and borders are gone).
- THE JPEG SIZES, measured on that live window: PNG 115,884 B (154,512 B base64) | JPEG q85 116,166 B | q75 93,736 B | q60 73,922 B | q45 63,591 B | q60 at 0.75 scale 45,091 B | q60 at 0.5 scale 25,679 B. The mean luminance stays ~232 at every setting, so the picture is still real content.
- A BROWSER RENDERS AN MJPEG STREAM IN A PLAIN `<img>`: verified in Chrome on this machine - a cross-origin `<img src="http://127.0.0.1:PORT/stream">` pointed at a `multipart/x-mixed-replace` server loaded in 0 ms, with `naturalWidth/naturalHeight` = the frame's own 1295x687, and it painted the real editor window. The browser decodes it natively; the app does nothing.

PART A - THE LIVE VIEW BECOMES AN MJPEG STREAM

A1. THE HELPER ENCODES JPEG, CLIENT AREA, SCALED.
`packages/vscode-bridge/extension/media/capture.ps1` changes:
- `PrintWindow` flags 2 -> 3 (`PW_CLIENTONLY | PW_RENDERFULLCONTENT`).
- The bitmap is sized to the CLIENT area, not the window: `GetClientRect` + `ClientToScreen` (the client origin on the screen). The captured region is therefore the editor without the OS title bar.
- Each frame is encoded as JPEG with quality 60 (an `EncoderParameters` with `Encoder::Quality`), and the bitmap is downscaled to 0.75 with a bilinear `DrawImage` before encoding. Both are parameters of the helper (`-Quality`, `-Scale`), with those defaults, so they can be changed without editing the script.
- The `HEADER <width> <height>` line reports the SCALED output size.
- The frames it writes are JPEG bytes, not PNG. The length prefix stays exactly as it is (4-byte little-endian).

A2. THE EXTENSION SERVES THE FRAMES AS MJPEG FROM THE HTTP SERVER IT ALREADY HAS.
`packages/vscode-bridge/extension/src/bridge.ts` already creates an `httpServer` (it handles the websocket `upgrade` on it). That same server gains a `request` handler for the stream:
- `GET /s/<capability>/frame` -> `Content-Type: multipart/x-mixed-replace; boundary=frame`, and each part is:

      --frame\r\nContent-Type: image/jpeg\r\nContent-Length: <n>\r\nX-Seq: <seq>\r\n\r\n<jpeg bytes>\r\n

- A request with a wrong or unknown capability gets a 404. The capability is the authorisation (A3).
- A client that connects gets the LAST frame immediately, so a panel that opens the live view is never blank.
- A KEEP-ALIVE: if the picture has not changed for 5 seconds, the server re-sends the last frame (with the same `X-Seq`), so the browser's watchdog does not drop a silent stream. The watchdog limit is 12 seconds.
- The frames are written to the stream by the extension as they arrive from the helper.

A3. THE STREAM IS AUTHORISED BY A PER-CONNECTION CAPABILITY, NOT BY THE SESSION TOKEN.
- When the extension accepts a connection, it generates a random capability for THAT connection (32 hex characters from `randomBytes(16)`), and puts the stream URL in the `bridge:hello` message it already sends: `streamUrl: "http://127.0.0.1:<port>/s/<capability>/frame"`.
- The session token is NEVER in a URL (D-50 holds). The capability is a separate, single-purpose, per-connection value, and it dies with the connection. The port is the bridge's own fixed port (D-67) - the same server, the same port, a different path.
- The capability must be unguessable and per connection: two connections get two different capabilities, and a capability stops working when its connection closes.

A4. THE PROTOCOL LOSES THE FRAME DATA.
The `editor:frame` message currently carries the base64 PNG. The frames no longer travel over the websocket, so that message becomes the STATE only:
- ADD `| { v: 1; type: "editor:capture"; state: "live" | "unavailable"; reason?: string; seq: number; }` to the union, to `BRIDGE_MESSAGE_TYPES`, and to the `isBridgeMessage` guard.
- REMOVE `editor:frame` from the union, from `BRIDGE_MESSAGE_TYPES` and from the guard.
- `bridge:hello` gains an OPTIONAL `streamUrl?: string` (the guard must accept it as a string or undefined).
- The round-trip test (`packages/vscode-bridge/tests/bridge.test.ts`) asserts that the SAMPLES list equals `BRIDGE_MESSAGE_TYPES` EXACTLY, so the samples must change with it: replace the `editor:frame` sample with an `editor:capture` sample, and add a `bridge:hello` sample that carries a `streamUrl`.
- The extension publishes the capture state with `editor:capture` (the same "live" / "unavailable" + reason it publishes today), and the frame bytes go to the HTTP stream instead.

A5. THE APP RENDERS THE STREAM IN A PLAIN `<img>`.
- The app keeps the `streamUrl` from `bridge:hello` (in the app's bridge session state).
- The panel's live view renders `<img src={streamUrl} ... />` with the same `object-fit: contain` and the same "fill the panel, keep the aspect ratio" behaviour it has today. The `<img>`'s own natural size gives the aspect ratio, so the app does not need the frame's dimensions.
- The per-frame path in the app goes away entirely: the base64 data URL, the per-frame registry entry and the per-frame React re-render are all gone. The panel re-renders when the CAPTURE STATE changes, not on every frame.
- D-82 HOLDS AND GETS STRONGER: a frame does not reach the element payload - and it does not even travel over the websocket. The saved document cannot contain a frame because the frames never enter the app's data at all.
- The live view still falls back to the text mirror AND says WHY when there is no capture (the `editor:capture` state is "unavailable" with a reason). The text mirror is the fallback; the stream is the live view.

A6. THE EXTENSION PUBLISHES A FRAME ONLY WHEN THE PICTURE CHANGED.
- The extension computes `zlib.crc32(jpegBytes)` (Node 22 has it) and compares it with the CRC of the last published frame. An unchanged picture is not written to the stream again.
- The change detection is in the EXTENSION, not in the helper: the helper's JPEG encoding is deterministic, so an unchanged picture produces identical bytes, and the extension's CRC catches it without the helper having to read pixels back.
- The consequence to state in the SPEC: a static editor costs no traffic and no app work at all.

PART B - THE TEXT MIRROR STOPS REWRITING THE SCENE ON EVERY KEYSTROKE

B1. THE PUBLISH IS COALESCED.
`packages/vscode-bridge/extension/src/extension.ts:351` publishes on `vscode.workspace.onDidChangeTextDocument(publishEditorContent)`, and `editorState.ts:63` puts the WHOLE file (`document.getText()`) in every message. So every keystroke in the teacher's editor currently makes the app rewrite the whole scene.
- The publish is coalesced to AT MOST ONE every 100 ms, and the LAST state is ALWAYS published (a trailing timer), so the final text is never lost.
- The whole-file payload stays (a diff is a bigger change than this wave is for). The coalescing is what removes the per-keystroke scene rewrite.
- The 100 ms is a constant with a comment, not a magic number scattered in the code.

PART C - THE ROWS THAT MUST BE AMENDED

The 5g rows describe the OLD transport, so they must be amended - read the current SPEC rows and rewrite them to match this wave:
- AC-101 (the panel draws the editor window live, at the frame's own aspect ratio) -> the live view draws the MJPEG STREAM in a plain `<img>`, at the frame's own aspect ratio, and the app does no per-frame work.
- AC-102 (a frame never reaches the element payload) -> unchanged in substance, and STRONGER: the frames never enter the app's data at all.
- AC-103 (in the live view, with no capture, the panel falls back to the text and says why) -> unchanged in substance.
- AC-104 (the capture helper is spawned ONCE and the frames are read from its running stdout) -> unchanged in substance; the helper still runs once, and it now writes JPEG.
- AC-105 (the extension finds its own window by handle, and the capture is configurable) -> the helper's quality and scale are the configurable parts now; the window is still found by handle.

Add the decision rows D-85 (the live view is an MJPEG stream served by the extension's own HTTP server, and the frames never travel over the websocket), D-86 (the stream is authorised by a per-connection random capability in the URL path, issued in bridge:hello; the session token never appears in a URL), D-87 (the capture is the client area, JPEG at quality 60, scaled to 0.75) and D-88 (an unchanged picture is not published again, and the editor's text is published at most every 100 ms with the last state always published).

Add the acceptance rows AC-113 to AC-120:
- AC-113 the extension serves the frames as MJPEG (`multipart/x-mixed-replace`) on its own HTTP server, and the panel's live view is a plain `<img>` pointed at it - the app does NO per-frame work.
- AC-114 the frames never travel over the websocket and never reach the element's payload.
- AC-115 the stream endpoint refuses a request without the connection's capability, and two connections get different capabilities.
- AC-116 the capture is the CLIENT area (no title bar), a JPEG, and scaled - the size, the format and the quality are all asserted.
- AC-117 an unchanged picture is not published again.
- AC-118 the editor's text is published at most every 100 ms, and the LAST state is always published.
- AC-119 the live view falls back to the text mirror and says why when the capture is unavailable.
- AC-120 the helper is spawned ONCE and its frames are read from its running stdout (the JPEG path).

AC-113..AC-120 are RESERVED for this wave. Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example `it("AC-117 an unchanged picture is not published again", ...)`. The kit SPEC lint reads the file and fails if the id is absent.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. NO NEW DEPENDENCY - everything here is Node built-ins (`zlib.crc32`, `http`, `crypto`) and what is already in the repository.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your new rows must be green, and the amended rows must be green too.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: (a) the panel rendering the per-frame data URL instead of the stream, (b) the frames travelling over the websocket again, (c) the stream endpoint answering without the capability, (d) the change detection removed, (e) the publish coalescing removed, (f) the helper's JPEG/client-area/scale reverted to the PNG/whole-window.
- The machine: the gate sizes vitest from the free memory, so it takes about three to four minutes. If the vitest step fails with "still loading", that is the known load flake, not your code: re-run with GATE_JOBS=2. If the OS kills the workers (non-zero exit, NO summary line), free memory and re-run.
- There may be ANOTHER gate running when you start (the kit serialises them - it will wait for the lock). That is normal; wait it out.
- WINDOWS: the harness strips literal double quotes out of a command line, which breaks JSON arguments and even the PowerShell parser. When you build a command string that needs a quote character, use $q = [char]34 and concatenate - never type a literal quote. In a ripgrep pattern, write \x22.
- PowerShell 5.1 has no [uint] type accelerator - use [uint32]. That is not a style note, it is a real error: "Unable to find type [uint]".

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. How a frame gets from the helper to the browser now, end to end, and what the app does per frame (the answer should be: nothing).
5. How the stream is authorised, and how you proved a wrong capability is refused.
6. The measured sizes: the bytes per frame before and after, on a real window.
7. The rows you amended and what you changed in them.
8. Anything you could not do and why, and anything in this brief you found to be wrong.
9. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.
