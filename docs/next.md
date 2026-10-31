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

- **Private `main`: `5d160c4`** before wave 9b (the commit that merged this file; wave 9a is under it; the merge of wave 9b is the next commit on `main`). Pushed to both private remotes: `github` = `Sairampv98/excalidraw-teacher-help`, private; `origin` = `D:\excalidraw-backup\excalidraw-teacher-help.git`).
- **Public repository `Sairampv98/excalidraw-classroom`** (remote `github-public`, local clone `C:\Users\user\Desktop\NITTE - C\excalidraw-public`): pushed on 2026-10-29 with `main` 9265307, `dev` 160107b, `v1` 0ca4125, `v1.1` 1d2ec7f, `dev-draft` 21a0ffe. That is the scrubbed private tree **up to `31fac56`**. Wave 9a and everything after it is **not** mirrored. The `approve-first-push` marker was **not** created, so the hooks do not push `dev` by themselves.
- **Wave 9a (VS Code mirror control): DONE.** The canvas controls the editor's window (Whole / Part / Follow, park or virtual display, screenshots, OCR, presenter). Two things worth knowing:
  - The mirror's live picture is a multipart image in an `<img>`; **Chrome shows each part only when the next part's header arrives**, so the stream writes the next header behind every picture (`packages/vscode-bridge/extension/src/stream.ts`). Never go back to "boundary + headers + bytes" per picture.
  - The virtual display must use the **same Windows scaling as the main display** (150% on the owner's machine), or VS Code looks smaller there and the zoom follows back to main.
  - Diagnostics: the command "Excalidraw Bridge: Show where the mirror's time goes" reports frame rate, window draw time, extension-host lag, and how long keys take to show (in front or behind other windows).
- **Two tasks have 9b in their name; keep them apart.** `wave9b-small-fixes` is the wave that was built after 9a (see below, `DONE`). `wave9b-browser-setup` is the **browser-based editor setup**, parked, and belongs to v3: its branch `task/wave9b-browser-setup` (worktree `..\excalidraw.worktrees\wave9b-browser-setup`) holds the finished engine and nothing else (the kit has no rename or abandon command, so the id keeps saying 9b).

## Work queue

### W9b - Small fixes - DONE

Task `wave9b-small-fixes` (SPEC rows D-374 to D-381, AC-437 to AC-444).

1. **Export a chart's animation as a GIF, an animated WebP or an MP4.** The **Export** button of the animation bar opens a panel (`components/FlowExportPanel.tsx`): format, **frames a second** (5 to 60; a GIF has no 60), size (longest side 480 to 1920), shape (the chart's own, 16:9, square, portrait 9:16), with or without the page's background (an MP4 always has it). MP4 and WebP are offered **only after the browser has been asked** whether it can write them (`VideoEncoder.isConfigSupported`, a canvas WebP probe). The code is in `packages/excalidraw/scene/flowExport/`: `plan.ts` (the timeline, the options, the rules), `compose.ts` (one picture of one moment), `gif.ts`, `webp.ts` and `mp4.ts` (our own encoders, no dependency), `runner.ts` (the run, with progress and stop), `browser.ts` (the canvas, the WebP writer, the video encoder), `chart.ts` (what of the page is exported) and `exportAnimation.ts` (the pieces put together). `scene/export.ts` got one option, `framePapers`, so a framed export can still draw the page's paper.
   - **Each picture is made from its moment, not from the screen**: the step comes from the animation's own clock and the marks from `flowMarksFor`, the very function the overlay draws with. The look is drawn too (D-383): arrows hidden or coloured, neon arrow tubes, and the text highlight (the label's box and its lit letters). The **camera's flight** (the view moving to each step) is a choice in the panel (D-385): the chart is drawn again for every camera, and each flight finishes inside its step so the file loops. The first picture of a file is taken 0.4 s into the first step, so it is lit (D-384). **An animated WebP now animates on the canvas** (D-382) and is never resized, GIF included.
   - Checked in a real Chrome against the running app and read by the real `ffprobe` and `ffmpeg`: the GIF (90 pictures, exactly 6.0 s), the animated WebP (90 pictures) and the MP4 (H.264 High, 180 pictures, 6.0 s) all open; the GIF and WebP corners have alpha 0 without a background and the MP4's is opaque.
2. **A worked example in the Flow tab's guide** (`excalidraw-app/sidebar/guideText.ts`, `FlowGuide.tsx`): _An animated gateway chart_, a network script of ten boxes and eight arrows; its button fills the script and sets the arrows to **Marching dashes** and the shapes to **Focus**.
3. **README drafts** in `scripts/public-sync/readmes/`: the first release's branch is `v1` (its draft is now `README.v1.md`), and the READMEs and the feature list tell how the editor's window is handled today (control from the canvas, parking, the virtual display and its scale, a window that cannot be lost). The clip `11-park-and-control.mp4` named in `docs/VERIFY.md` is still not recorded.

Dropped from this wave by the owner on 2026-10-31: relative images in markdown, OCR of a box drawn on a PDF, the Python "page crash" report. (`DROPPED`.) The scaling reminder in the setup helper moved to v3.

### W9c - MCP server - NEXT

Show the SPEC rows first. The owner wants **all functionality**, which is large: the proposal is three tasks of their own, each with its own gate - **9c-1 canvas tools**, **9c-2 local media and documents**, **9c-3 flow charts, slides and export** (or one task `wave9c-mcp-server` if the owner prefers).

- `packages/mcp-server`, **stdio**, using `@modelcontextprotocol/sdk` (approved as a dependency by the owner earlier).
- **What it must do** (the owner, 2026-10-31): **create** and **edit** - including changing the **position and dimensions** of containers, **cropping** and styles and text; **delete**; **modify existing structures**; **pages** (insert anywhere); **slides generated from a class script**; **insert external resources from the local filesystem** - images, GIFs, videos; **open markdown and PDF files** from the local filesystem; **read them with vision** if the model has it, and by text or OCR if it has not; and **insert parts of them into the canvas**.
- Design notes from the groundwork: the MCP server is a separate program, so the **page connects to it**, the way the page connects to the VS Code bridge (`packages/vscode-bridge/bridge/src/protocol.ts` and `client.ts` are the model: loopback only, a capability token, an origin check). The page already exposes what the tools need (`updateScene`, `addFiles`, `getSceneElements`, `scrollToContent` on the imperative API). Every change goes through the app's own history so **Ctrl+Z undoes what the AI did**. A client does not reliably say whether its model can see, so give **both** ways to read a document (page images and extracted text or OCR) and let the model choose. **Local files**: only inside folders the owner lists; refuse any other path and any link out of them. The new animation export (wave 9b) can be a tool too.
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
