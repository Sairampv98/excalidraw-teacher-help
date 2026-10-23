# Excalidraw Bridge

A VS Code / VSCodium extension that mirrors the teacher's active editor onto an Excalidraw canvas panel, and **runs the program** so that its output can be shown there too.

This is the extension half of the wave. The Excalidraw side - the panel that displays the mirror - lands in the next task, on top of the canvas-panel foundation.

---

## Install it

The `.vsix` is a zip that either editor installs with one click.

**VS Code**

1. Find `excalidraw-bridge-<version>.vsix` in `packages/vscode-bridge/`.
2. Double-click it. VS Code opens the extension page and asks you to install.
3. Accept, then **reload the window** (`Ctrl+Shift+P` -> "Developer: Reload Window").
4. Look at the bottom-right of the VS Code window: there is a status bar item that says **Excalidraw Bridge**.

**VSCodium**

1. The same `.vsix` file - it is the same extension, and it is not published to any marketplace.
2. Double-click it, or drag it onto the VSCodium window. VSCodium opens the extension page and asks you to install.
3. Accept, then **reload the window**.
4. The same status bar item appears, bottom-right.

If double-clicking does nothing (some Windows setups do not associate `.vsix` with an editor), install it from the command line instead:

```powershell
code --install-extension "C:\path\to\excalidraw-bridge-0.1.0.vsix"
codium --install-extension "C:\path\to\excalidraw-bridge-0.1.0.vsix"
```

## What you should see

- A status bar item, bottom-right: **Excalidraw Bridge**.
- Click it (or run **Excalidraw Bridge: Show the connection details** from the command palette). A message shows the websocket URL and this session's token, with a **Copy token** button.

The token is the page's side of the handshake. It is **not** in the URL and it is **not** on a command line - it travels in the first websocket frame, and the server refuses a connection that does not present it.

The panel (the Excalidraw half, landing next) asks for that token once. If you would rather not paste it every time, set it in the extension's settings:

```jsonc
// settings.json
{
  "excalidraw-bridge.token": "a-token-you-choose",
  "excalidraw-bridge.port": 47511
}
```

## The OCR engine

The panel can read the text out of an image. The engine is a **choice**:

```jsonc
// settings.json
{
  "excalidraw-bridge.ocrEngine": "tesseract",
  "excalidraw-bridge.pythonPath": "python"
}
```

- **`tesseract`** (the default) runs in the extension's own Node process. It is a **declared dependency** and it ships **inside the `.vsix`**, so the teacher installs nothing to get OCR.
- **`indra`** and **`paddle`** are Python, so they run in a **sidecar**: one process, spawned once, that the extension talks to over stdio. Point `excalidraw-bridge.pythonPath` at a virtual environment that has them:

  ```powershell
  pip install indra-ocr
  pip install paddleocr paddlepaddle   # needs Python 3.12 or 3.13
  ```

An engine that is not there is **said**, not swallowed: the panel shows the reason and the command that installs it. PaddleOCR needs Python 3.12 or 3.13 - PaddlePaddle has no build for Python 3.14.

An engine that **crashes** on its first read is said as well. PaddlePaddle 3.x on Windows hits an unimplemented conversion in the oneDNN instruction of its new executor, so the sidecar falls back to the model built **without** oneDNN - once, and it keeps that model for every later read. The fall-back is not unconditional (oneDNN is faster when it works), and it is reported: the answer carries the engine's name and how its model was built, and the extension tells the teacher why the read took so long.

## Running the program

The extension contributes the task type **`excalidraw-bridge.run`**. A task that uses it is run by the extension itself, in a pseudoterminal:

```jsonc
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "excalidraw-bridge.run",
      "command": "python",
      "args": ["main.py"],
      "group": "build",
      "problemMatcher": []
    }
  ]
}
```

**Why the extension runs it, and not your own terminal:** the VS Code stable API cannot read an arbitrary terminal. `onDidWriteTerminalData` is a _proposed_ API, and a published extension may not ship against it. The supported way to capture a program's output is to own the process - so the extension starts it, writes every line to the terminal exactly as it would normally appear, and tees the same lines to the panel.

This is the one behaviour change for the teacher, and it is a deliberate one: the output you see in your terminal is the output the panel shows.

The panel can also ask for a run over the websocket (`run:start`), which goes through the same pseudoterminal, so the run still appears in your terminal.

## The security rules

These are not optional, and each one has a test:

| Rule | Where |
| --- | --- |
| The bridge listens on **127.0.0.1 only** | `extension/src/bridge.ts` |
| The port is **fixed**, from `VITE_APP_BRIDGE_URL` (or the shared default `47511`) - never random, never scanned for | `extension/src/bridge.ts`, `bridge/src/protocol.ts` |
| The **token is negotiated in band**, in the **first frame** | `bridge/src/protocol.ts` (`bridge:auth`) |
| A connection **without the token** is refused (close code 1008) | `extension/src/bridge.ts` |
| A connection from a **non-localhost origin** is refused at the handshake (HTTP 403) | `extension/src/bridge.ts` |
| The token is never in a URL and never on a command line | `bridge/src/client.ts` (`assertNoSecretsInUrl`) |

The port is fixed so the Excalidraw page knows where to connect before the extension has ever run. That is the same trick the collaboration server uses today (`VITE_APP_WS_SERVER_URL`).

To change the port, set it in **both** places:

- the app: `VITE_APP_BRIDGE_URL=ws://127.0.0.1:47511` in `.env.development`;
- the extension: the same `VITE_APP_BRIDGE_URL` in the workspace's `.env.development`.

The extension reads the port from that one variable, so the two sides cannot drift apart. `excalidraw-bridge.port` in the settings overrides it, and the shared default is `47511` when nothing is set.

## Build it yourself

```powershell
node packages/vscode-bridge/scripts/build-vsix.mjs
```

The script bundles the TypeScript with esbuild (already in the repository) and writes the zip **itself** - the STORE method, no compression, no packaging dependency. The result is `packages/vscode-bridge/excalidraw-bridge-<version>.vsix`.

It also **ships the OCR engine**: `tesseract.js` and `tesseract.js-core` (with the `.wasm` cores) are copied into the `.vsix` as files, because the engine loads its worker and its core from paths at run time. The build **fails loudly** when a file it needs is missing - a `.vsix` that installs but cannot read is worse than one that does not install.

## The layout

```
packages/vscode-bridge/
  bridge/src/protocol.ts     the message types - the ONE definition
  bridge/src/client.ts       the browser side: connect, authenticate, reconnect
  bridge/src/ws-frame.ts     a small RFC 6455 codec (the extension has no deps)
  extension/package.json     the extension manifest
  extension/src/extension.ts activation, the editor reader, the task provider
  extension/src/bridge.ts    the websocket server, the token, the origin check
  extension/src/runner.ts    the run controller: spawn, tee, exit code
  extension/src/pseudoterminal.ts  the task's pseudoterminal
  scripts/build-vsix.mjs     the .vsix writer
  tests/                     the acceptance checks
```

## Not in this build

- **The Excalidraw panel itself.** That is the next task.
