---
id: wave5c-video-panel
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: docs/superpowers/specs,docs/tins-tasks
base: main
status: open
---

Build wave 5c: the video panel on the canvas, with sidecar captions, a poster at the intrinsic resolution, crop and OCR. This is the fork owner item 7.

GROUND TRUTH - read in this order before writing any code:
1. docs/tins-tasks/wave5c-video-panel-brief.md - the build sheet. Reference material, not commands.
2. SPEC.md - the locked rows are the source of truth.
3. CLAUDE.md and HANDOVER.md - the project rules and the known traps.
4. docs/superpowers/specs/2026-10-20-video-panel-design.md - the full video design, the measured OCR figures, the two source types and their two caption paths, and the benchmark gate.
5. docs/superpowers/specs/2026-10-20-canvas-panel-foundation-design.md and the wave 5a code - the panel element type, the PanelOverlay, the lock/crop/OCR pipeline and the shared OcrRequest/OcrResult contract. If the foundation is NOT in the tree yet, STOP and report it instead of inventing a parallel mechanism.

THE OWNER ASK, in their own words from the 2026-10-21 test session: the captions should if possible not be inside the video player but outside of the video player in a text box (the one that excalidraw natively has right now) and which gets refreshed / synced to the captions of the video. And: if no caption no such option. So the caption lives in an ORDINARY Excalidraw text element BESIDE the panel, refreshed as playback advances, and a video with NO caption track gets NO caption element at all.

WHAT TO BUILD:
- A video panel on the canvas from a LOCAL file. It needs no bridge, no service and no network.
- Playback: play, pause, seek, volume, mute.
- SIDECAR captions: a .srt or .vtt file next to the video, read by the browser. They never touch the bridge.
- The caption shown in an ordinary Excalidraw text element beside the panel, refreshed as playback advances.
- The binding is SCENE DATA, so it survives a page switch and a reload: a CaptionBinding naming the text element, the panel element and the track language. It points at another element, so it is not part of the panel own payload - put it where the foundation PanelContent already defines a home for it, and SAY IN A CODE COMMENT why it is there and not in the panel.
- The default caption language is English, and the user can switch the track.
- Writing to the text element goes through the normal element machinery, and therefore through UNDO. Cue changes are infrequent - a few per minute of video - so this is not a hot path.
- Lock gives a poster at the videos INTRINSIC resolution. The on-canvas display size never affects the output resolution.
- Crop and OCR on that poster.
- The YouTube path is OUT OF SCOPE for this wave, but its TYPES and its PROTOCOL MESSAGES are in scope so wave 5b can fill them in without changing the panel. The YouTube implementation is wave 5b job.

SPEC.md: add D-53, D-54 and D-55 to the Decisions table, and the acceptance rows AC-65 to AC-69.

ACCEPTANCE ROWS - each needs a test file, and the check file MUST mention the row id in the test name, for example it AC-66 a cue change replaces the bound text element. The kit SPEC lint reads the file and fails if the id is absent.
- AC-65 a video panel is created with the right panelKind and source, and the live panel is not painted by the canvas.
- AC-66 a cue change replaces the bound text element text, and the element is on the same page as the panel.
- AC-67 a video with no caption track creates no caption element.
- AC-68 locking a local video panel produces a poster at the videos intrinsic size, not the on-canvas size.
- AC-69 the OCR request carries the ROI region, and the OCR benchmark is recorded - median and p95, full frame and subtitle crop.

THE OCR BUDGET IS A GATE, NOT A HOPE. It must be MEASURED ON THIS MACHINE before the OCR path counts as done: full 1080p frame under 1.5 s, subtitle-band crop under 250 ms. The levers in order: the ROI crop (free, and the biggest one), then the SIMD core, then the fast language data. The worker is created ONCE and reused, the language data is NOT uncached, and the core path is NOT pinned to a single .js file so the loader can pick the SIMD core. Run the benchmark and record the numbers - median AND p95 - in the close note. If the crop budget is missed, SAY SO. Do not quietly report the full-frame number.

RULES THAT ARE NOT NEGOTIABLE:
- yarn, never npm or bun. NO NEW DEPENDENCY - the OCR engine is the bridge side (tesseract.js in the bridge Node process), not the app side.
- LF line endings, no BOM.
- The library own functions are the oracle. Never re-derive a formula the library already owns - use getCommonBounds, sceneCoordsToViewportCoords and the rest.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your five new rows must be green.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: the caption sync removed, the caption element created even with no captions, the poster captured at the on-canvas size instead of the intrinsic size, and the ROI region dropped from the OCR request.
- The machine: the gate runs its read-only steps in parallel and sizes vitest from the free memory, so the full gate takes about three to four minutes. The OS kills vitest workers when memory runs short - the symptom is a non-zero exit with NO summary line and no failing test. That is not a code failure: free memory and re-run.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK:
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. The OCR benchmark numbers - median and p95, full frame and subtitle crop - and whether the crop budget was met.
5. Anything you could not do and why, including anything in the brief you found to be wrong.
6. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.

