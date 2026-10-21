# Builder brief — Wave 5b, the VS Code bridge (item 6)

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's item 6, in their own words:

> "a live code editor (either the graceful degradation or the syncing with the locally launched vscode/vscodium instance through a extension installable by turning it into a .vsix format"

The owner's decisions (2026-10-21):

- the extension lives **inside the repo**, at `packages/vscode-bridge/`;
- the extension **runs** the program and shows its output in the panel;
- there is **no** auto-transcription — the panel shows captions only when a sidecar exists;
- the presenter's code panel is **read-only**.

The full design is `docs/superpowers/specs/2026-10-20-vscode-bridge-design.md`. **Read it first** — it carries the protocol, the discovery and security rules, and the pseudoterminal pattern.

**This wave depends on the canvas-panel foundation** (Wave 5a). Read that design and the Wave 5a code before starting. If the foundation is not in the tree yet, **stop and report it**.

## The architecture

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

The bridge is a **separate process** (the extension host, or a companion binary the extension spawns). The app talks to it over a **loopback WebSocket** — the browser has a native `WebSocket`, so the **app needs no new dependency**.

## The layout in the repo

```
packages/vscode-bridge/
  extension/            the VS Code extension (the .vsix's payload)
    package.json        the extension manifest
    src/extension.ts    activates the bridge
    src/bridge.ts       the WebSocket server
    src/protocol.ts     the message types (the single source of truth)
  bridge/               the shared protocol + the OCR client
    src/protocol.ts     the message types
    src/ocr.ts          the OCR service
  scripts/build-vsix.mjs  packages extension/ into a .vsix
  README.md             how to install and how to use it
```

**The protocol must have exactly one definition.** The extension is TypeScript and so is the app; put the message types in one module and have the extension import it. If the extension cannot import from the app (a separate `package.json` with its own build), then the protocol module lives in `bridge/src/protocol.ts` and **both** sides import it — the app through a path alias, the extension through a relative import.

## The protocol

A small, versioned JSON protocol. Every message carries `v`, `type` and a `runId` where relevant.

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

The panel **sends** run commands; the extension **sends** content and output. That is what makes the panel _live_ rather than a screenshot.

## Running the program — the pseudoterminal pattern

The extension contributes a task type, `excalidraw-bridge.run`, whose `CustomExecution` returns a `Pseudoterminal`. The pseudoterminal:

1. spawns the command (`python main.py`, `node index.js`, ...) with the workspace as cwd;
2. writes every stdout/stderr line to the terminal, so **the teacher still sees normal VS Code behaviour**;
3. tees the same lines to the WebSocket bridge, tagged with the run id;
4. reports the exit code when the process ends.

**This is the one behaviour change for the teacher**, and the extension's README must say so plainly: the extension runs the program itself, because the VS Code stable API cannot read an arbitrary terminal (`onDidWriteTerminalData` is proposed-only).

## Discovery and security — these are not optional

- the bridge listens on **127.0.0.1 only**, on a **random free port**;
- it writes the port and a **per-session token** to a well-known file under the OS temp dir (`%TEMP%/excalidraw-bridge.json` on Windows), which the app polls on startup;
- the WebSocket handshake must present the token; the server **rejects** anything else;
- only `http://localhost` and `https://localhost` origins are accepted.

This is what stops another local process — or a web page via a CSRF-style connection attempt — from driving the teacher's machine. The enforcement needs a test each.

## The panel

The panel is a **code panel** from the foundation. Its content is **CodeMirror 6**, reusing `packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx` as the base component:

- **read-only** by default, so a stray click cannot corrupt the student's file;
- the teacher's own editor remains the source of truth — the panel is a mirror;
- three regions: **editor**, **program output**, **console**.

When the bridge is not connected, the panel shows a clear **"bridge not connected"** state with the install hint, rather than an empty editor.

## The `.vsix`

A `.vsix` is a zip: the `extension/` folder at the root, plus `[Content_Types].xml` and `extension.vsixmanifest`.

**Do not add a packaging dependency.** The build script writes the zip itself — the STORE method (no compression) is a few dozen lines and works on every platform. Put it in `packages/vscode-bridge/scripts/build-vsix.mjs`, and have it produce `packages/vscode-bridge/excalidraw-bridge-<version>.vsix`.

The extension's own `package.json` needs the contributes section:

```json
"contributes": {
  "taskDefinitions": [
    { "type": "excalidraw-bridge.run", "properties": { "command": { "type": "string" } } }
  ]
}
```

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-47 | The bridge listens on **127.0.0.1 only**, on a **random free port**, and the WebSocket handshake must present a **per-session token** and a **localhost origin**. Anything else is rejected. |
| D-48 | The extension **runs** the program itself, through a contributed task type and a `Pseudoterminal`, because the VS Code stable API cannot read an arbitrary terminal. The teacher's own terminal still shows the output normally. |
| D-49 | The code panel is **read-only** and the bridge is the **source of truth**; the panel is a mirror, and a blocked clipboard or a missing bridge shows an explicit state, never a blank editor. |

Add these three rows to `SPEC.md` in the Decisions table, and the acceptance rows below to the **Acceptance — Wave 5** table.

## The files you own

Everything below is inside the task scope `packages/vscode-bridge,packages/excalidraw,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/vscode-bridge/bridge/src/protocol.ts` | new | the message types — the single source of truth |
| `packages/vscode-bridge/bridge/src/ocr.ts` | new | the OCR service |
| `packages/vscode-bridge/extension/package.json` | new | the extension manifest |
| `packages/vscode-bridge/extension/src/extension.ts` | new | activation, the editor reader |
| `packages/vscode-bridge/extension/src/bridge.ts` | new | the WebSocket server, the token, the origin check |
| `packages/vscode-bridge/extension/src/pseudoterminal.ts` | new | the run task |
| `packages/vscode-bridge/scripts/build-vsix.mjs` | new | the `.vsix` builder |
| `packages/vscode-bridge/README.md` | new | how to install and use it |
| `packages/excalidraw/scene/panelContent.ts` | changed | the `code` kind of `PanelContent` |
| `packages/excalidraw/components/PanelOverlay.tsx` | changed | the CodeMirror rendering |
| `excalidraw-app/` | changed | the bridge client: discovery, the WebSocket, the panel content |
| `packages/excalidraw/tests/`, `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-47, D-48, D-49 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-57 | `packages/vscode-bridge/` | A WebSocket connection **without the session token** is rejected. |
| AC-58 | `packages/vscode-bridge/` | A connection with a **non-localhost origin** is rejected. |
| AC-59 | `excalidraw-app/tests/` | With a **stub bridge**, the panel shows the editor text, the output and the console. |
| AC-60 | `excalidraw-app/tests/` | A `run:start` produces a `run:started` / `run:output` / `run:exit` **sequence** in the panel. |
| AC-61 | `excalidraw-app/tests/` | With **no bridge**, the panel shows the reconnect state, not a blank editor. |
| AC-62 | `packages/vscode-bridge/` | Every message the extension sends parses under the `BridgeMessage` union, and vice versa. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-57 a connection without the session token is rejected', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## Explicitly out of scope

**The in-browser compiler (Pyodide).** The design proposes it for the graceful-degradation path, but it means a **new dependency** and a ~10 MB download — and the project's rule is that a new dependency needs the **owner's explicit approval**. Do not add it. Ship the "bridge not connected" state with the install hint instead, and raise the Pyodide question in the close note so the owner can decide.

**The YouTube caption path** — that is Wave 5c's remaining half, and it needs `yt-dlp` on the teacher's machine.

## The house rules

- `yarn`, never `npm` or `bun`. **No new dependency** — the app side uses the browser's native `WebSocket`, and the extension side has no runtime dependency of its own.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your six new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the token check is removed, (b) the origin check is removed, (c) the run round-trip is broken, (d) the "not connected" state is replaced by a blank editor. Record what you broke and what failed — the orchestrator needs that in the close note.
