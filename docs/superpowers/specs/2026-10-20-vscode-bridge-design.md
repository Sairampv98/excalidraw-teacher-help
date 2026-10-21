# VS Code Mirror Panel

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 6 **Depends on:** `2026-10-20-canvas-panel-foundation-design.md`

---

## 1. Problem statement

The user teaches DSA live and wants the **code editor, the run output and the console** to appear **inside** an Excalidraw page, as a movable/resizable panel they can lock into a screenshot and draw on top of.

They asked for a VS Code / VSCodium integration with an exposed API, packaged as a `.vsix`, mirroring the editor that is already running on their machine — with graceful degradation when that bridge is not connected.

Both VS Code 1.132.0 and VSCodium are installed on this machine (`C:\Program Files\`), with Python, Pylance, debugpy, Jupyter, C/C++ and Java extensions already present.

## 2. What the research established

This is the part that decides the design, so it is stated up front.

### 2.1 VS Code's stable API cannot read an arbitrary terminal

- `onDidWriteTerminalData` is a **proposed** API; a published extension may not ship against it.
- `onDidStartTask` / `onDidEndTaskProcess` give the command line and the exit code — **never the output body**.
- The supported way to capture output is to **own the process**: contribute a task type whose `CustomExecution` returns a **`Pseudoterminal`**. The pseudoterminal spawns the command itself, so the extension owns the child's stdout/stderr — each line is written to the terminal (so the task looks and feels normal in VS Code) **and** teed to the bridge.

This is a good outcome, not a limitation: the extension running the program means the extension knows the program's output, exit code and cwd — exactly what a teaching panel needs.

### 2.2 `code serve-web` can be framed

Measured locally: `code serve-web --port 8000` serves the VS Code web UI with **no `X-Frame-Options` and no `frame-ancestors`** in its CSP. So the real VS Code UI _can_ be iframed, and proxied same-origin through the dev server it could even be captured.

It is **not** the chosen path, for a specific reason: it is a _separate_ VS Code instance from the one on the teacher's desktop, so it would not mirror the file they are actually editing, and it cannot see their shell. The iframe route is recorded here as a rejected alternative, not discarded.

### 2.3 The repo already has the rendering half

- **CodeMirror 6** is the library's editor: `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`, `@codemirror/language`, `@lezer/highlight` are dependencies of `packages/excalidraw`.
- `packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx` is a **finished, themed** CodeMirror component with dark/light themes, a VS Code-style gutter, line numbers, error-line decoration and a placeholder. It is the template for the mirror panel.
- `shiki` is a dependency of `excalidraw-app` and is used for code-card highlighting.

So the Excalidraw side needs **no new editor dependency**.

## 3. Goals

1. Mirror the **active editor's text** from the running VS Code / VSCodium into a canvas panel.
2. **Run** the program and show its output and console **in the panel**.
3. Lock the panel into a **full-resolution** screenshot, crop it, and OCR it.
4. When the bridge is not connected, degrade gracefully rather than showing an empty box.
5. The bridge must work in a classroom: one click to install, no server configuration.

## 4. Non-goals

- Full VS Code UI parity (file tree, extensions panel, debugger UI). The panel shows the **editor content**, the **program output** and the **console**, in the layout the user described.
- Replacing VS Code's own debugger UI. The panel mirrors output; VS Code keeps its debugger.
- Remote/SSH workspaces in the first cut. (The extension reads whatever VS Code shows, so this is likely free, but it is not claimed without testing.)

## 5. Architecture

```
  VS Code / VSCodium                        Excalidraw page
  ┌────────────────────────┐                ┌──────────────────────────┐
  │  excalidraw-bridge.vsix│                │  CodePanel (overlay)     │
  │                        │   WebSocket    │   ├ editor  (CodeMirror)  │
  │  · reads active editor │ ─────────────► │   ├ output  (stdout/stderr)│
  │  · runs code (pseudoterm)│  127.0.0.1   │   └ console               │
  │  · serves OCR          │               │  [lock] [crop] [ocr]      │
  └────────────────────────┘                └──────────────────────────┘
```

The bridge is a **separate process** (the extension host, or a small companion binary the extension spawns). The Excalidraw app talks to it over a **loopback WebSocket**. The browser has a native `WebSocket`, so **no new dependency** on the Excalidraw side.

### 5.1 The extension

Packaged as a `.vsix` (which is a zip: `extension/package.json` manifest + code) so it installs with one click in both VS Code and VSCodium.

Responsibilities:

| Capability | VS Code API |
| --- | --- |
| Active editor's text + language | `window.activeTextEditor.document.getText()`, `document.languageId` |
| Cursor / selection | `activeTextEditor.selection` |
| Change notifications | `workspace.onDidChangeTextDocument`, `window.onDidChangeActiveTextEditor` |
| Running the program | a contributed task type -> `CustomExecution` -> `Pseudoterminal` |
| Program output | the pseudoterminal's own stdout/stderr, tee'd |
| Working directory | `workspace.workspaceFolders[0].uri.fsPath` |
| OCR | a child process or an in-process WASM OCR (see the video spec for the shared OCR contract) |

### 5.2 Running code — the pseudoterminal pattern

The extension contributes a task type, say `excalidraw-bridge.run`, whose `CustomExecution` returns a `Pseudoterminal`. The pseudoterminal:

1. spawns the command (`python main.py`, `node index.js`, ...) with the workspace as cwd;
2. writes every stdout/stderr line to the terminal, so **the teacher still sees normal VS Code behaviour**;
3. tees the same lines to the WebSocket bridge, tagged with the run id;
4. reports the exit code when the process ends.

The bridge exposes "Run", "Stop" and "Run with arguments" to the panel.

This is the pattern used by any VS Code extension that needs task output (the API docs' own `task-provider-sample` demonstrates it).

### 5.3 The protocol

A small, versioned JSON protocol over the WebSocket. Every message carries `v`, `type` and a `runId` where relevant.

```ts
type BridgeMessage =
  // editor -> panel
  | {
      v: 1;
      type: "editor:content";
      uri: string;
      language: string;
      text: string;
      selection?: { start: number; end: number };
      version: number;
    }
  | {
      v: 1;
      type: "run:output";
      runId: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | { v: 1; type: "run:exit"; runId: string; code: number | null }
  | { v: 1; type: "run:started"; runId: string; command: string; cwd: string }
  | { v: 1; type: "bridge:hello"; version: string; workspace: string }
  // panel -> editor
  | { v: 1; type: "run:start"; command: string; args: string[]; cwd?: string }
  | { v: 1; type: "run:stop"; runId: string }
  | {
      v: 1;
      type: "ocr:request";
      id: string;
      imageBase64: string;
      language?: string;
    }
  | { v: 1; type: "ping" };
```

The panel **sends** run commands; the extension **sends** content and output. This is what makes the panel _live_ rather than a screenshot.

### 5.4 Discovery and security

The bridge listens on `127.0.0.1` only, on a **random free port**, and writes the port to a well-known file under the OS temp dir (e.g. `%TEMP%/excalidraw-bridge.json`), which the Excalidraw app polls on startup.

The file contains the port and a **per-session token**. The WebSocket handshake must present the token; the server rejects anything else. This stops another local process (or a web page via a CSRF-style connection attempt) from driving the teacher's machine.

Only `http://localhost` and `https://localhost` origins are accepted for the handshake.

### 5.5 Rendering the mirror in the panel

The panel is a **code panel** from the canvas-panel foundation. Its content is CodeMirror 6, reusing `TTDDialog/CodeMirrorEditor.tsx` as the base component:

- **read-only** by default, so a stray click cannot corrupt the student's file;
- the teacher's own editor remains the source of truth — the panel is a mirror;
- the panel shows **three regions**: editor, program output, console, in the proportions the user described ("editor section", "run this program section", "console").

When the bridge is not connected, the panel shows a clear "bridge not connected" state with the install hint, rather than an empty editor.

### 5.6 Locking, cropping and OCR

Handled by the canvas-panel foundation (§5.4-5.6). Specifically, for a code panel:

- **Lock** renders the editor content at an **export scale** into an offscreen canvas — it is _not_ a screen-grab of the small on-canvas rectangle. Because the content is text, the poster is crisp at any size.
- **Crop** then operates on that poster, exactly as for a video.
- **OCR** is then either unnecessary (the text is already known!) or used to recover text from a _screenshot of the terminal output_ where the text may be graphical.

This is worth stating plainly: **for a code panel, OCR is a fallback, not the primary path.** The bridge already knows the text. OCR only earns its place for pixels — the video case.

## 6. Graceful degradation: the in-browser compiler

> **Approved by the owner, 2026-10-21** ("lazy download pyodide"). The mechanism below is unchanged: Pyodide is the in-browser fallback, and the runtime is **downloaded lazily** — fetched only when the user asks for it, never on page load. It is deliberately **not** an npm dependency: an installed Pyodide is ~10 MB of the repository's own weight _and_ a 10 MB download on a slow classroom connection, while a lazily fetched runtime is paid for only by the teachers who use it. The panel's fallback is therefore reachable with no installation at all. Locked as **D-32** in `SPEC.md`.

When no bridge is connected, the panel offers an in-browser compiler instead of nothing.

**Recommended: Pyodide**, loaded **lazily** — the ~10 MB runtime is only fetched when the user asks for it, never on page load. This matters: `excalidraw-app` is a teaching tool that is often opened on a slow classroom connection.

| Language | In-browser option | Notes |
| --- | --- | --- |
| Python | **Pyodide** | Real CPython, `numpy` available. The primary teaching language here. |
| JavaScript | Native `<script>`/Worker | No dependency needed at all |
| Others | not in the first cut | The bridge covers them when VS Code is open |

This is the one place where the repo's "do not add dependencies without a strong reason" rule is explicitly overridden — and the reason is recorded here: the user asked for graceful degradation, and a code panel that shows nothing is not a degradation.

The in-browser path is a **separate execution context** from the bridge path: the same panel UI, a different content source.

## 7. Test coverage

| Test | Asserts |
| --- | --- |
| bridge protocol | every message the extension sends parses under the `BridgeMessage` union, and vice versa |
| token enforcement | a WebSocket connection without the session token is rejected |
| origin enforcement | a connection with a non-localhost origin is rejected |
| panel rendering | with a stub bridge, the panel shows the editor text, the output and the console |
| run round-trip | a `run:start` produces a `run:started` / `run:output` / `run:exit` sequence in the panel |
| not connected | with no bridge, the panel shows the reconnect state, not a blank editor |
| lock resolution | locking a code panel produces a poster at the export scale, not the on-canvas size |
| OCR contract | the panel's OCR request matches the shared OCR contract |

**Teeth check:** removing the token check must fail the enforcement test; removing the run round-trip must fail the run test.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| The extension cannot see output from programs the teacher runs in their own terminal | The extension runs the program itself through the pseudoterminal task type. This is the one behaviour change for the teacher, and it is stated plainly in the extension's README |
| Loopback WebSocket blocked by browser or CSP | The app is served over `http://localhost` in dev and `https` in production; loopback is not blocked by CORS for WebSockets, but the handshake is origin-checked |
| Pyodide's 10 MB download on a slow connection | Lazy-loaded, only on explicit user action, with a visible progress state |
| The extension is published to the marketplace vs installed as a `.vsix` | The user asked for a `.vsix`; the spec assumes a locally installed `.vsix` (double-click to install). Marketplace publishing is a later, optional step |
| Two execution paths (bridge vs in-browser) double the panel's logic | Both implement the same `PanelContent` interface; the panel UI is written once against that interface |

## 9. Success criteria

1. With the extension installed and VS Code open, a code panel on the canvas shows the active file's text, live.
2. "Run" in the panel runs the program and streams its output into the panel, while the teacher's own VS Code terminal shows the same output normally.
3. The panel can be locked into a crisp, full-resolution screenshot, cropped, and OCR'd.
4. With no extension running, the panel offers the in-browser Python/JavaScript path.
5. The four gates are green.

## 10. Ordering

**Wave 3**, on top of the canvas-panel foundation. The extension is a **separate deliverable** from the Excalidraw changes and can be built in parallel — the panel only needs the protocol to be fixed.
