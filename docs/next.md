# next.md - where the work stands and what a new session does next

Private. This file is never mirrored to the public repository (`scripts/public-sync/config.json` denies it).

## How to resume

Open a session in this repository and say: **"Continue: read docs/next.md."**

Then, in this order:

1. Read this file to the end.
2. Run `node .tins/kit/bin/kit.mjs status` (is a session or a gate already running? never kill one).
3. Take the first work item whose status is `NEXT`. Show its SPEC rows to the owner and get a yes **before** building a new feature (a bug the owner reports counts as the yes).
4. When a wave is merged, update this file in the same task: move the item to `DONE` with the merge commit, and write what the next session needs to know. A new session must never have to ask "what was done last?".

Statuses used below: `DONE`, `NEXT`, `HELD` (the owner decided to wait; do not start it), `DROPPED` (the owner removed it; reopen only when asked).

## Where things stand (2026-10-31)

- **Private `main`: `ac08982`** (wave 9a merged and pushed to both private remotes: `github` = `Sairampv98/excalidraw-teacher-help`, private; `origin` = `D:\excalidraw-backup\excalidraw-teacher-help.git`).
- **Public repository `Sairampv98/excalidraw-classroom`** (remote `github-public`, local clone `C:\Users\user\Desktop\NITTE - C\excalidraw-public`): pushed on 2026-10-29 with `main` 9265307, `dev` 160107b, `v1` 0ca4125, `v1.1` 1d2ec7f, `dev-draft` 21a0ffe. That is the scrubbed private tree **up to `31fac56`**. Wave 9a and everything after it is **not** mirrored. The `approve-first-push` marker was **not** created, so the hooks do not push `dev` by themselves.
- **Wave 9a (VS Code mirror control): DONE.** The canvas controls the editor's window (Whole / Part / Follow, park or virtual display, screenshots, OCR, presenter). Two things worth knowing:
  - The mirror's live picture is a multipart image in an `<img>`; **Chrome shows each part only when the next part's header arrives**, so the stream writes the next header behind every picture (`packages/vscode-bridge/extension/src/stream.ts`). Never go back to "boundary + headers + bytes" per picture.
  - The virtual display must use the **same Windows scaling as the main display** (150% on the owner's machine), or VS Code looks smaller there and the zoom follows back to main.
  - Diagnostics: the command "Excalidraw Bridge: Show where the mirror's time goes" reports frame rate, window draw time, extension-host lag, and how long keys take to show (in front or behind other windows).
- **Wave 9b browser setup is parked**, see `HELD` below. Its branch `task/wave9b-browser-setup` (worktree `..\excalidraw.worktrees\wave9b-browser-setup`) holds the finished engine and nothing else. **Its task id says 9b but it belongs to v3**: the owner renamed the order on 2026-10-31 (the kit has no rename or abandon command).

## Work queue

### W9b - Small fixes - NEXT

Task id to use: `wave9b-small-fixes`. Show the SPEC rows first.

1. **Chart export as GIF, animated WebP and MP4**, each with or without the canvas background (the page's paper and colour). Decisions to put into SPEC rows before building:
   - What is exported: one chart's animation loop (or the selection / the page), at a chosen size and frame rate, and for how long.
   - "Without background" is transparent in GIF (one bit of alpha) and WebP (full alpha); **MP4 cannot hold transparency**, so say what MP4 does (always the background, or a chosen solid colour).
   - **There is no encoder in the repository** (only `fflate` and `pako` are installed) and no new dependency is allowed without a SPEC decision: decide between a small own GIF encoder, WebP built from canvas `toBlob("image/webp")` frames inside an animated-WebP container, and MP4 through WebCodecs `VideoEncoder` plus a small own muxer (or `MediaRecorder`).
   - The flow animation is a DOM/SVG overlay driven by JavaScript (`packages/excalidraw/components/FlowAnimationOverlay.tsx`, `FlowAnimationState.ts`, `scene/flowAnimation.ts`), not canvas pixels. Frames must come from **stepping the animation's own clock** and compositing the page canvas plus the overlay, never by recording in real time, so the file is exact and the same on every machine.
   - Earlier note from the owner (wave 7w): they said "webp" first.
2. **README drafts** in `scripts/public-sync/readmes/`: they still say `version-1` (the public branch is `v1`) and still describe the virtual display of the old design; update them for wave 9a (parking and the virtual display as they are now). The clip `11-park-and-control.mp4` named in `docs/VERIFY.md` is not recorded.

Dropped from this wave by the owner on 2026-10-31: relative images in markdown, OCR of a box drawn on a PDF, the Python "page crash" report. (`DROPPED`.)

### W9c - MCP server - NEXT (after W9b)

Task id: `wave9c-mcp-server`. Show the SPEC rows first.

- `packages/mcp-server`, **stdio**, using `@modelcontextprotocol/sdk` (approved as a dependency by the owner earlier).
- It reuses the VS Code bridge channel (`packages/vscode-bridge`), generates **slide pages from a class script**, and can **insert pages anywhere**.
- A related folder exists on the owner's disk, `C:\Users\user\Desktop\NITTE - C\TINS-MCP` (an MCP server for the TINS method, not for this project); look at it for the shape of a working server before designing.

### Release v2 on the public repository - NEXT (after W9c)

The owner's wording: publish everything as version 2, with release candidates in the repository's **Releases** section, then the final release.

1. Rebuild the public branches from the current private `main` (see "Public repository" above; the engine is `scripts/public-sync.mjs`, the leak guard is `scripts/public-sync/guard.mjs`). Run the strict `scan` first; extend `scripts/public-sync/rewrite-map.json` for new decision and row ids and for "owner" wording in comments.
2. The binaries that go on a release (the installer and the extension file) need the **same leak scan as code**.
3. Release candidates are GitHub **pre-releases** named `v2.0.0-rc.1`, `v2.0.0-rc.2`, ... with the installer and the `.vsix` attached; then `v2.0.0`.
4. Before anything public: **show the owner the README banner, the scan result and the release notes, and wait for their explicit go.** A public push is never done on a general approval.
5. Public branch layout and the owner's release cycle are in the memory file `project-v1-repairs-and-public-mirror` (public `main` = v2, `dev` and `dev-draft` synced from it, `v1` and `v1.1` kept, collaborators work in `dev-draft`).

### Kit improvement - HELD

Three candidates are staged in the kit's inbox, in `D:\Takeu-Forward\tins-kit\kit-staging\inbox\excalidraw-project-handoff\kit-growth-candidates.md`, for a kit-growth session at the kit root (`D:\Takeu-Forward\tins-kit`, prompt `prompts/KIT-GROWTH-SESSION.md`):

- **C1** a named handoff file: a `next` key in `tins.json`, a line for it in the protocol file, its first NEXT item shown by `kit status`, a warning from `kit close` when a merged task left it untouched, and a template.
- **C2** a task merged through an integration task still says `status: open`, so every later task needs `--overlap-ok`.
- **C3** the kit has no abandon or rename command for a task (the task `wave9b-browser-setup` now carries a name that is no longer true).

The installed kit in this repository (`.tins/kit`) must not be edited by hand; any change goes through the kit source, and its new version is then installed here. Nothing in the kit was changed, only the candidates were written.

### V3 - HELD (the owner is holding this off; do not start it)

The owner will say when v3 begins. Version 3 starts with:

1. **Browser-based editor setup** ("like the WLAN prompt"), task `wave9b-browser-setup`, **engine done and gated**, parked on its branch. Built: `installer/editor-setup/` (`EditorSetup.ps1` with modes Plan/Run/Profile/ParseLink/Detect/SelfTest, `Open-SetupLink.ps1`, `Register-SetupLink.ps1`, `Bootstrap.ps1`, a Windows Sandbox proof), the profile creation for VS Code and VSCodium, the extension checklist, an optional virtual display driver step (off by default), and SPEC rows D-364 to D-369 / AC-425 to AC-431 (those numbers are reserved for it; the main branch has moved on to D-373 and up). Still to build: the **"Set up my editor" dialog** on the page (checklist, link `excalidraw-setup://install?...`, downloadable `.cmd`, copyable PowerShell command), the script that publishes `/setup/*.ps1` and the `.vsix` from `excalidraw-app/public/setup/`, and the **pairing prompt** in VS Code ("Allow the whiteboard at 127.0.0.1:3061 to connect?", remembered per origin) so the owner stops copying the token by hand.
2. **A scaling reminder in the setup helper's virtual display step**: tell the user to set the virtual monitor's Windows scale to match the main display (Windows has no supported way to set it from a program).
3. **Desktop mirroring from the canvas** (the owner's new idea, 2026-10-31): the mirror works for VS Code / VSCodium today; extend it to **the Windows desktop and any application**, for classes that use a browser, MongoDB Compass and other tools (web development, data science, data analytics). Wanted:
   - **Keystrokes and mouse clicks drawn on the picture the way VS Code's screencast mode does**, using the **Keyviz** project (`https://github.com/mulaRahul/keyviz`) as the reference for the look and behaviour.
   - **Step-by-step guides** built from what is mirrored, and **animations with our flowcharts**.
   - Maybe components from **OBS Studio** (`https://github.com/obsproject/obs-studio`).
   - Notes for whoever writes the SPEC rows (checked 2026-10-31, not yet decided): Keyviz is **GPL-3.0** (Tauri, Rust and TypeScript) and OBS Studio is **GPL-2.0-or-later** (C++); this fork is **MIT**. Copying GPL code into the fork would put the combined work under the GPL when distributed, so use them as references for behaviour and design, or run them as **separate programs** the fork talks to (for example OBS through its websocket), and let the owner decide. Open questions: capture one window or the whole desktop (and which Windows capture API); where the keystroke overlay is drawn (on our picture, from our own input events, or captured from a separate overlay program); whether guides are recorded live or assembled afterwards; how this relates to the existing capture and input helpers in `packages/vscode-bridge/extension/media/` (`capture.ps1`, `input.ps1`, `window.ps1`), which find the editor's window by process name and title.

## Ideas inbox

The owner will list further ideas for later waves. Write each one here, with the owner's own words, and a new session turns it into a task when asked.

(none yet)

## Rules that always apply

- **Spec first.** A behaviour change is a SPEC row first (`D-n` decision, `AC-n` acceptance row naming a test file that mentions the id), then the code. Show the rows of a new feature and get a yes before building.
- **One task = one branch + one worktree + one scope**: `node .tins/kit/bin/kit.mjs task new <id> --paths a,b [--overlap-ok]`; link the `node_modules` folders into the worktree with junctions (root, `excalidraw-app`, `packages/excalidraw`, `packages/utils`, `packages/fractional-indexing`, and the `examples` ones); `kit start --task <id>` before every close.
- **The gate**: `GATE_JOBS=2 node .tins/kit/bin/kit.mjs close --note "..."`, then `kit check --base main`. One heavy command at a time; stop throwaway editors and dev servers first; **never kill a running gate or merge**. The timing test `flowLargePresets.test.tsx` (1000 ms) fails when the machine is busy: rerun it alone.
- **Finishing a wave**: preview from the worktree (`node ../node_modules/vite/bin/vite.js --port <port> --strictPort --host 127.0.0.1` from its `excalidraw-app`) with a "what to check" list; after the owner says it works: `kit merge <task>` from the base worktree, stop the preview, push `main` to `github` and `origin`. Public pushes need the owner's explicit go.
- Use **yarn**, not npm; no new dependency without a SPEC decision; **LF line endings, no BOM**; **no secrets** in files or commits; tests must have teeth (check them with deliberate mutations); never edit `sessions/`, `tasks/`, `tins.json` or `.tins/kit/` by hand.
- Never drive the owner's own VS Code (its bridge port is 47511); use a throwaway editor with its own `--user-data-dir` and `--extensions-dir` (port 47611).
- Tool gotcha on this machine: shell heredocs and `node -e` strip backslashes; write scripts that contain a backslash or a regular expression with the file tool.
