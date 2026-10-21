# Builder brief — Wave 5b-part-2, the app side of the bridge (the code panel)

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The **second half** of the VS Code bridge. The first half — the extension, the bridge server, the shared protocol, and the `.vsix` — is merged (or about to be) in `packages/vscode-bridge/`. **This half is the Excalidraw side**: the code panel that shows the teacher's live editor on the canvas, and the app's client that talks to the bridge.

The full design is `docs/superpowers/specs/2026-10-20-vscode-bridge-design.md`; the build sheet for the whole wave is `docs/tins-tasks/wave5b-vscode-bridge-brief.md`; and the **panel machinery this side builds on** is described in `docs/superpowers/specs/2026-10-20-canvas-panel-foundation-design.md` and `docs/superpowers/specs/2026-10-21-panel-type-dispatch-checklist.md`.

**Read all four.** The panel foundation (the `panel` element type, the overlay, the chrome) is the prerequisite, and it comes from a task that must already be merged — if the `panel` element type is not in `packages/element/src/types.ts`, **stop and report it**.

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-50 | The bridge listens on **127.0.0.1 only**, on a **fixed port** from a `VITE_APP_*` variable, and the WebSocket handshake must present a **per-session token** and a **localhost origin**. Anything else is rejected. |
| D-51 | The extension **runs** the program itself, through a contributed task type and a `Pseudoterminal` — because the VS Code stable API cannot read an arbitrary terminal. The teacher's own terminal still shows the output normally. |
| D-52 | The code panel is **read-only** and the bridge is the **source of truth**; the panel is a mirror, and a blocked clipboard or a missing bridge shows an explicit state, never a blank editor. |

Add these three rows to `SPEC.md` (they are not there yet — the extension half could not add them, because it touched no behaviour path), together with the acceptance rows below.

## How the token reaches the app — the owner's decision (2026-10-21)

**The copy-to-clipboard option exists.** The extension already ships the two commands that make it work — _"Excalidraw Bridge: Show the connection details"_ (which shows the port and the token, with a _Copy token_ button) and _"Excalidraw Bridge: Copy the session token"_.

So the app side has, in the panel's chrome, a **Bridge** field with a **"Paste from clipboard"** button that calls `navigator.clipboard.readText()`. The teacher clicks _Copy the session token_ in the editor, clicks _Paste_ in the panel, and the panel connects.

Rules for that field:

- the token is held **in memory for the session only** — never written to `localStorage`, never put in a URL, never logged. The extension's token is per-session, so a remembered one would be useless anyway;
- the field shows a clear state for each of: **not connected**, **connected**, and **rejected** (wrong token, or the extension is not running);
- the token **never travels through a chat window or through the agent** — it is a secret, and this repo's rule is that a secret goes in a file the agent does not read back;
- a teacher who sets the extension's own `excalidraw-bridge.token` setting gets a **stable** token, which they paste once per session instead of copying a fresh one each time. That is the teacher's choice, made in their editor — the app does not need to know, and **no token is baked into the app**.

## The panel's content

The code panel is a **`panel` element** of kind `code`, whose source is the bridge:

```ts
export type PanelContent =
  | { kind: "code"; source: PanelSource }
  | { kind: "video"; source: PanelSource; captions?: CaptionTrack }
  | { kind: "flow"; source: PanelSource; doc: FlowDocument }
  | { kind: "image"; source: PanelSource };

export type PanelSource =
  | { type: "bridge"; sessionId: string }
  | { type: "file"; fileId: BinaryFileID; mimeType: string }
  | { type: "inline"; payload: unknown };
```

A **`bridge`** source is a view onto a live session: it is **not re-creatable after a reload**, so it saves as a placeholder plus its last poster image, and shows a "reconnect" affordance until the bridge returns.

The panel's content is **CodeMirror 6**, reusing `packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx` as the base component. It is **read-only** — the teacher's own editor is the source of truth; the panel is a mirror.

**The live state rides inside the element payload**, and that payload must be **plain, structured-cloneable data**: the transport is `postMessage`, and a `<video>` element or a function in the payload makes it throw and the frame is **silently dropped** — a mirror that mysteriously freezes. The text of the editor, the caret, and the run state all go as plain values.

## The three regions

The panel shows three regions: the **editor** (the mirrored text), the **output** (the program's stdout/stderr), and the **console** (the bridge's own messages).

## The client

`packages/vscode-bridge/bridge/src/client.ts` **already exists** — it is the browser-side client, written in the extension half so that both sides share the protocol. **Read it and use it**; do not write a second one.

The app's job is to: read the port from the `VITE_APP_*` variable, ask for the token (the clipboard button), open the WebSocket, present the first frame with the token, and feed the messages into the panel's payload.

## The files you own

- `packages/excalidraw/scene/panelContent.ts` (changed) — the `code` kind of `PanelContent`, and the bridge source
- `packages/excalidraw/components/PanelChrome.tsx` (changed) — the **Bridge** field, the "Paste from clipboard" button, the connection states
- `packages/excalidraw/components/PanelOverlay.tsx` (changed) — the CodeMirror rendering of a `code` panel
- `packages/excalidraw/components/PanelChrome.scss` (or wherever the chrome's styles live) (changed)
- `excalidraw-app/` (changed) — wiring the `VITE_APP_BRIDGE_*` variables, the `onPaste`/clipboard handling, the app's side of the connection
- `packages/excalidraw/tests/`, `excalidraw-app/tests/` (changed) — the acceptance rows
- `SPEC.md` (changed) — D-50, D-51, D-52 and the acceptance rows

Verify the real import paths against the neighbouring files — the panel foundation's own layout is the truth, not this brief.

## The acceptance criteria

AC-58 to AC-64 must be checked by test files. **The check file MUST mention the row id in the test name**, e.g. `it('AC-59 a connection with a non-localhost origin is rejected', ...)` — the kit's SPEC lint reads the file and fails if the id is absent.

The extension half already wrote `packages/vscode-bridge/tests/bridge.test.ts`, `client.test.ts` and `vsix.test.ts` covering the bridge and the protocol. **Read them** — this half adds the **app-side** rows on top, and must not weaken theirs.

- AC-58: a WebSocket connection **without the session token** is rejected.
- AC-59: a connection with a **non-localhost origin** is rejected.
- AC-60: a `run:start` produces a `run:started` / `run:output` / `run:exit` **sequence** in the panel.
- AC-61: with **no bridge**, the panel shows the reconnect state, not a blank editor.
- AC-62: every message the extension sends parses under the `BridgeMessage` union, and vice versa.
- AC-63: the token never appears in a URL or a command line.
- AC-64: the **`.vsix` builds** and is a valid zip with `extension/` at its root.

The app-side rows to add: the **"Paste from clipboard"** button fills the field from `navigator.clipboard.readText()`, the field is **never persisted**, and the three connection states render.

## Gates - all four must pass

Run from the worktree root:

1. `node scripts/tins-gate.mjs` - the four-gate product gate. All four must pass; the summary line must show `# fail 0`.
2. `node scripts/rowcheck.mjs --all` - your new rows must be green.

Run the focused test files with `npx vitest run <file> --watch=false`. NEVER leave vitest in watch mode.

**A note on the machine:** the gate runs its read-only steps in parallel and sizes vitest from the free memory, so the full gate takes about three minutes. The OS kills vitest workers when memory runs short - the symptom is a non-zero exit with NO summary line and no failing test. If a run dies that way it is not a code failure; free memory and re-run.

## The teeth check - mandatory

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test FAILS. At least: (a) the token check is removed, (b) the origin check is removed, (c) the run round-trip is broken, (d) the token is persisted, (e) the "no bridge" state is replaced by a blank editor. Record what you broke and which test failed.

## Reporting back

When you are done, report:

1. The list of files you created and changed, with a one-line purpose each.
2. The exact gate output summary and the rowcheck result.
3. The teeth check: what you broke, and which test failed, for each.
4. Anything you could not do, and why - including anything in the brief you found to be wrong.
5. The final git status of the worktree (the changes staged or unstaged but NOT committed - do not commit; the kit close does that).

Do not summarise the design back to me. Report evidence: command output, test names, file paths.
