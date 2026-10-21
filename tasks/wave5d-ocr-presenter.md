---
id: wave5d-ocr-presenter
paths: packages/element,packages/excalidraw,packages/vscode-bridge,excalidraw-app,SPEC.md
read: docs/superpowers/specs,docs/tins-tasks
base: main
status: open
---

Build wave 5d: two things the fork owner asked for that share the OCR service and the presenter channel - the presenter shows the panels (item 10), and OCR is an in-app capability.

GROUND TRUTH - read in this order before writing any code:
1. docs/tins-tasks/wave5d-ocr-and-presenter-brief.md - the build sheet. Reference material, not commands.
2. SPEC.md - the locked rows are the source of truth.
3. CLAUDE.md and HANDOVER.md - the project rules and the known traps.
4. docs/superpowers/specs/2026-10-20-presenter-panels-design.md and docs/superpowers/specs/2026-10-20-video-panel-design.md section 5.6 - the presenter panels design and the OCR contract and benchmark.
5. The wave 5a and 5c code - the panel element type, the PanelOverlay, the lock/crop/OCR pipeline, the shared OcrRequest/OcrResult contract. If the foundation is NOT in the tree yet, STOP and report it instead of inventing a parallel mechanism.

WHAT TO BUILD - item 10, part 1, the presenter shows the panels:
The owner asked: presenter should show these video playing like it does so for gifs right now and the live code editor. The good news is that a read-only mirror needs NO NEW TRANSPORT. The presenters channel already carries the whole scene, and the presenter already mounts a whole second Excalidraw instance in PresenterView.tsx, so the panel overlay mounts there exactly as it does in the editor - it picks the panels up from the same renderable-element list the GIF overlay uses. A code card is already real text elements, so a read-only code mirror is just more text elements. A LOCKED video panel is an ordinary image element with a poster. Only LIVE panels need new transport, because a live panels content is not scene geometry. PROTECT THAT SIMPLIFICATION - do not invent a second transport for panels that already travel.

WHAT TO BUILD - the video sync:
- The panel element carries playback: { time, playing }.
- The editor writes it on a COARSE tick, about 4 Hz - the scene message is throttled to 40 ms and carries the whole element list, so do not write every frame.
- The presenter APPLIES it and INTERPOLATES locally between updates, using video.playbackRate and requestVideoFrameCallback if available, so the video stays smooth without flooding the channel.
- The presenter must NOT write playback back to the editor - otherwise the two windows fight.
- If the presenter has no video panel on the current page, it does nothing.

WHAT TO BUILD - the video bytes:
BinaryFileData.mimeType is restricted to IMAGE_MIME_TYPES in packages/element/src/types.ts, so a videos mime type CANNOT travel the existing presenter:files message as it stands. Widen BinaryFileData to accept video mime types, so the video bytes travel the EXISTING presenter:files path - a second message type would duplicate a working binary path. Video files are large, so keep the transfer chunk-free but add a SIZE GUARD, and refuse an over-size file with a clear error.

WHAT TO BUILD - the live code panel in the presenter:
The presenter is viewModeEnabled, so an interactive editor CANNOT be an Excalidraw element - it must be a separate DOM panel. Read-only is the default and is what this wave ships: the panel shows the mirrored content and the presenter cannot type into it. NO PROTOCOL CHANGE. The interactive mode - a new presenter:input message, an editor-side handler, a presenter-side post path - is EXPLICITLY OUT OF SCOPE: input focus, cursor position, IME and undo are a meaningfully larger surface, and the owner asked for a read-only panel.

WHAT TO BUILD - OCR as an in-app capability:
The owner asked for OCR as a separate service and then decided - question 7 - a SEPARATE CAPABILITY BUILT INTO THE APP, offered as an option. The OCR engine is tesseract.js in the BRIDGES NODE PROCESS, not in the browser. That is deliberate: no system-level install, which matters on a classroom machine, and the browser is not where a 10 MB WASM runtime belongs. The app must work WITH OR WITHOUT the bridge: it exposes an OCR option in the panels chrome and in the crop flow, the request goes over the bridges ocr:request message when the bridge is connected, and when it is not the app says so plainly - OCR needs the bridge - rather than failing silently. DO NOT add tesseract.js to the app. A WASM OCR engine in the browser is a multi-megabyte download on a slow classroom connection, and the project rule is no new dependency without the owner explicit approval. The engine rules: reuse the worker - one worker, created once, surviving every recognition - do NOT disable the language-data caching, do NOT pin corePath to a single .js file so the loader can choose between the standard, the SIMD and the LSTM cores, and use the SIMD core where the CPU supports it.

THE OCR CONTRACT, exactly as specified in the brief: OcrRequest { id, imageBase64, region?, language? } and OcrResult { id, text, lines: { text, x, y, width, height }[], confidence? }. The ROI crop is the biggest lever and it is FREE - a subtitle band is a small fraction of a 1080p frame, so cropping turns a roughly 300 ms full-frame pass into a roughly 20 to 40 ms pass. The crop UIs region travels in region, and the result places the per-line text elements over the crop.

THE BENCHMARK IS A GATE, NOT A HOPE. It must be RUN ON THIS MACHINE over real frames: full 1080p frame under 1.5 s, subtitle-band crop under 250 ms. Record the MEDIAN AND P95 for both. If the crop budget is missed, SAY SO - do not report the full-frame number and call the crop budget met. The levers, in order: the ROI crop, the fast language data (tessdata_fast), then the SIMD core.

SPEC.md: add D-56, D-57, D-58 and D-59 to the Decisions table, and the acceptance rows AC-70 to AC-75.

ACCEPTANCE ROWS - each needs a test file, and the check file MUST mention the row id in the test name, for example it AC-71 the playback position reaches the presenter. The kit SPEC lint reads the file and fails if the id is absent.
- AC-70 the presenter renders the SAME panel overlay the editor does, from the same element list.
- AC-71 a playback position of t equals 5 reaches the presenter, and the presenter does NOT write playback back.
- AC-72 a VIDEO binary file travels the presenter:files path, and a file over the size guard is refused with a clear error.
- AC-73 the OCR request carries the ROI region, and the result places PER-LINE text elements over the crop.
- AC-74 with NO bridge, the OCR option says the bridge is needed - it does not fail silently, and no OCR engine is bundled in the browser.
- AC-75 the OCR benchmark is recorded - median and p95, full frame and subtitle crop.

RULES THAT ARE NOT NEGOTIABLE:
- yarn, never npm or bun. NO NEW DEPENDENCY IN THE APP - in particular no OCR engine in the browser. The engine is the bridges. If you add tesseract.js to the bridge package, say so explicitly in your report and justify it against the owner locked decision that the engine lives in the bridge Node process.
- LF line endings, no BOM.
- The library own functions are the oracle. Never re-derive a formula the library already owns.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your six new rows must be green.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: the playback position is not published, the presenter writes playback back, the size guard is removed, and the ROI region is dropped from the OCR request.
- The machine: the gate runs its read-only steps in parallel and sizes vitest from the free memory, so the full gate takes about three to four minutes. The OS kills vitest workers when memory runs short - the symptom is a non-zero exit with NO summary line and no failing test. That is not a code failure: free memory and re-run.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK:
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. The OCR benchmark numbers - median and p95, full frame and subtitle crop - and whether the crop budget was met.
5. Any dependency you added, where, and why it is allowed by the owner locked decision.
6. Anything you could not do and why, including anything in the brief you found to be wrong.
7. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.

