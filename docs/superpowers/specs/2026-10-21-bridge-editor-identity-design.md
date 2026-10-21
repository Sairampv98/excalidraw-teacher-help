---
date: 2026-10-21
status: design locked, implementation pending
origin: the owner's 2026-10-21 screen recording of the VS Code bridge
---

# The bridge is one port, and two editors want it

## What the owner saw

They ran the bridge, pasted the token, and the panel said **"Connected to the Excalidraw Bridge."** — and then the panel stayed empty, while their code sat in a VS Code window in the other screenshot. They asked the only sensible question: _"I thought I would get this view directly — or was that not possible?"_

**It is possible, and the mirror works.** Proven with a controlled fake bridge server on this machine: it behaves like the extension (hello, then `editor:content` every 1.5 s), and the panel shows the mirrored Java **with CodeMirror's line numbers**:

```
bridgeState:  "connected"
editorText:   "public class Program2 {\n  public static void main(String[] args) {\n …"
```

The app side is correct. The panel was empty because **the app was talking to the wrong editor**.

## The cause

The bridge's port is **fixed** (D-67): `47511`, on `127.0.0.1`. That is the whole point — the app finds the bridge the way it finds the collaboration server, without scanning.

But the owner has **two** editors, and both ship the extension:

- **VSCodium** was running and **held port 47511** (verified: the listening socket's owner is `C:\Program Files\VSCodium\VSCodium.exe`).
- **VS Code** was open with `Program2.java` — the file the owner was mirroring.

The app connected to **VSCodium's** extension, because that was the one holding the port. VSCodium had no file open, so it had nothing to publish, so the panel was empty. The token matched, because the owner had copied it from the same instance the app reached.

**Nothing in the protocol said which editor the app was talking to.** `bridge:hello` carried the version and the workspace name, and the workspace was the same folder in both editors — so the app had no way to notice, and neither did the teacher.

And the editor that _lost_ the race — VS Code — only said something in a toast that appears once and is easy to miss: _"could not listen on port 47511"_.

## The rules

**D-76 — the bridge says which editor it is.** `bridge:hello` carries the editor's name (`vscode.env.appName`: "Visual Studio Code" or "VSCodium"). The app shows it in the place the teacher is already looking — the panel's chrome — and in the console line it already writes. So the teacher sees _"Connected to VSCodium"_ while their file is open in VS Code, and knows in one glance that the two are not talking to each other.

The field is **optional** in the protocol guard, so an extension that predates the field still connects — it simply does not name itself.

**D-77 — losing the port is loud and actionable.** When the extension cannot listen because the port is taken, the message must say what is wrong and what to do: the port, that another editor most likely holds it, and the two ways out — close that editor, or give this one a different port (`excalidraw-bridge.port`) and point the app at it (`VITE_APP_BRIDGE_URL`). A silent loss of the race is what made this take an hour to see.

## What this does NOT change

- The port stays **fixed** (D-67). The app does not scan, and the owner does not have to configure anything for the common case of one editor.
- The mirror itself is untouched: the app already renders the editor's text, with line numbers, the moment the extension publishes it.
- The token stays in memory (D-50) and still travels in the first frame.

## The acceptance rows

| id    | the row                                                             |
| ----- | ------------------------------------------------------------------- |
| AC-87 | the bridge identifies the editor it runs in, and the app shows it   |
| AC-88 | an extension that cannot take the port says so, and says what to do |
| AC-89 | a hello without the editor's name still connects                    |
