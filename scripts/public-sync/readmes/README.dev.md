# Excalidraw for the classroom

A **modified Excalidraw**: a fork that adds the things a teacher needs when a VS Code or VSCodium window is the thing being taught — a bridge between the editor and the canvas, panels, OCR, a presenter view, pages with a frame and a number, a virtual display for the projector, and an **AI assistant** that can work on the board while you teach.

![the clips](clips/index.html)

> ### Read this first
>
> This is a **hobby project**. It is **not** a maintained version of Excalidraw. It is **not kept in sync with the upstream codebase** — it does not track upstream's changes, it does not merge them, and it is not a drop-in replacement for Excalidraw.
>
> It is not affiliated with, endorsed by, or supported by the Excalidraw team. If you want an Excalidraw that is maintained, [use Excalidraw](https://github.com/excalidraw/excalidraw).
>
> Please read [Known limitations](#known-limitations) before you rely on it for a class.

---

## What it adds

|  |  |
| --- | --- |
| **Panels** | A canvas element that holds something: the editor's text, a video, a YouTube player, a picture. It floats, it can be locked, and it carries the VS Code look. |
| **The bridge** | A VS Code / VSCodium extension that connects the editor to the canvas: the file you are editing is mirrored into a panel, and a **Run** button executes the panel's draft in your workspace. |
| **The live editor** | The mirrored text is a **real editor**: you can select it, copy it as a **code block**, choose the **language** it is read as, and **zoom inside** it. |
| **A code editor of its own** | A panel that needs no VS Code: write **Python or JavaScript** and press **Run** - it runs in the browser (Python is downloaded the first time). Dark and light themes, a console you can dock below or beside the editor, an **Input** box for `input()`, and a clear message when a program runs too long. A language VS Code can run on your machine (Java, Go, C and others) is run there when the bridge is connected. |
| **Documents** | A viewer for markdown, source and **PDF** files. A link to another file of the opened folder opens it in the viewer; a link to a website opens a new tab. In a PDF a drag draws a **box**: what is in it goes to the page as a **code card**, a **text box**, a **table**, **where it was**, or as a **sharp picture** of that part of the page; the bold and italic of the source go with the text. |
| **Bold and italic** | Select **part of a text** and make it bold, italic or both (Ctrl+B, Ctrl+I, or the buttons under the font); the rest of the text is left as it is. |
| **What is mirrored** | The panel mirrors the **whole** editor window by default. You can **crop a region**, change the crop as often as you like, and turn on **follow the cursor** so the region follows your pointer. |
| **OCR** | **Choose the area, then read**: the whole page is shown first and you drag out the part to read. The machine picks the engine it can actually run — _indra_ with the bridge, _tesseract_ (in the browser) without it — and tells you which one it used. The text is shown first and can be pasted as a code block, as text, or **where it was** on the page. |
| **The presenter view** | A second window for the projector: the same canvas, full screen, following you. |
| **Pages** | A page has a **frame** you can toggle, a **page number** in its footer, and a **size** from presets (A4, Letter, 16:9, 4:3, 1920×1080) — and the export honours it. |
| **Control, parking and the virtual display** | Drive the editor's window from the canvas; park it out of the way or move it onto a **virtual display** for the projector, and bring it back — only when **you** choose to. |
| **YouTube captions** | Three tiers, and the panel says which tier answered. |
| **Flow studio** | Charts built from a script: presets (process, decision, steps, network, cycle, tiers, integration), arrowless layouts (list, grid, matrix, pyramid, funnel, timeline, target, venn, hierarchy), an animation with a look of its own, a class loop and a step-by-step presenter. |
| **The emoji and GIF bar** | A floating bar of emoji, stickers and GIFs to drop on the canvas; it folds into a round button. |
| **Media in a chart** | A picture, GIF or video inside a node of a chart, cut to the node's shape, with four fits and a crop screen. |
| **Ink looks** | Neon, chalk, marker and pencil on text, freehand and shapes. |
| **Paper** | Each page has its own paper (eight kinds, twelve colours, grain and age); the image export draws every page's paper. |
| **The assistant** | An AI assistant (Claude, or another) can look at the board, draw on it, change it and make things - a chart, a deck of slides, a page for the lesson. It runs a small server **on your own computer**, the board is paired with it with a code you type once, and an **Allow changes** switch decides whether it may change anything. Every change it makes is **one undo step**. |

Some of the [clips](clips/index.html) show these working. The long version, with what each feature will and will not do, is in [`docs/FEATURES.md`](docs/FEATURES.md).

---

## The branches of this repository

| Branch | What it is |
| --- | --- |
| `main` | The current release - the second one. Only the maintainer merges into it. |
| `dev` | This branch: where the next release is prepared. It follows `main` and the maintainer's work; pull requests go here. |
| `dev-draft` | Where contributors commit. Open a pull request from `dev-draft` to `dev`. |
| `v1.1` | The first release with its repairs, as it was before the second release. |
| `v1` | The first release, kept as it was published. It is **superseded**. |

When a release is replaced by the next one, the one that goes is kept as a branch of its own (`v1` is the first of them), with a README that says so.

## Getting started

You need **Node.js 20 or newer** and **Yarn** (the project uses Yarn workspaces — `npm install` will not work).

```bash
yarn install       # the first run in a fresh clone takes a while
yarn start         # the development server, on http://localhost:3001
```

To build what you would deploy:

```bash
yarn build         # the production build, into excalidraw-app/build
```

The app is a normal Vite app: `excalidraw-app` is the application, `packages/excalidraw` is the component library it renders, and `packages/vscode-bridge` is the editor extension.

---

## Setting it up

The full guide is **[`docs/INSTALL.md`](docs/INSTALL.md)** — the setup, the container, the extension, the token, and what a machine on ARM64 must change.

The setup is the whole point of this project: a person with a laptop, an editor and a class to teach should not have to work out that they need Node, that Yarn comes from Corepack, and that the extension is installed from a `.vsix`.

**Windows:**

```powershell
powershell -ExecutionPolicy Bypass -File installer\setup.ps1
```

**macOS and Linux:**

```bash
bash installer/setup.sh
```

It checks for:

|  |  |
| --- | --- |
| **Node.js** | 20 or newer |
| **Yarn** | or Corepack, to provide it |
| **VS Code** | the `code` command, or the standard install |
| **VSCodium** | the `codium` command, or the standard install |
| **the extension** | the `.vsix`, built for you if it is not there yet |
| **the app's dependencies** | installed with `yarn install` |
| **the language runtimes** | `node`, `python` and `java` — what the panel's **Run** can execute |

**It asks before it installs anything.** Two switches:

- `-DryRun` — report everything and install **nothing**. Safe to run anywhere.
- `-Yes` — accept the defaults without being asked.

Running it twice is safe: everything it checks is idempotent, and the second run says _"already there"_.

If you would rather not install anything at all, the [Docker](#running-it-in-a-container) route serves the app from a container instead.

---

## Setting it up with no internet

Some rooms have no internet, or the teacher would rather not trust it. The **offline setup** is one file that carries everything it needs inside itself - the app, the extension, Node.js, the editors, Python and Java.

**The offline file on the releases page is the one that was built for the first release**, and it carries that release's app and extension. This release does not build a new offline payload, so on a machine with internet use the setup above instead.

Download `OfflineSetup.exe` from the [releases page](https://github.com/Sairampv98/excalidraw-classroom/releases) and double-click it. It:

- unpacks what it carries and **checks every file against its hash** - a file that does not match is refused, never downloaded;
- **serves the app straight away** - the app is a static bundle, so **nothing has to be installed for it to run**;
- then asks, **one thing at a time**, whether to install the rest from its own payload: Node.js, VS Code or VSCodium, Python (only for the OCR engine that runs in Python) and Java (only to build the app yourself).

`-DryRun` reports and installs nothing. `-Yes` accepts every question. A file that is missing is **reported**, never fetched.

More in [`docs/OFFLINE.md`](docs/OFFLINE.md).

---

## Checking that the install is sound

Two questions have two answers.

### "Did it install?"

One command, and it only **reads** the machine - it installs nothing, changes nothing and removes nothing:

```powershell
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1
```

It prints one row per check - the check, the expected value, the actual value and the verdict:

| verdict       | what it means                                              |
| ------------- | ---------------------------------------------------------- |
| `PASS`        | it is there and it is right                                |
| `MISSING`     | it is not installed - often perfectly fine                 |
| `FAIL`        | it is there but it is **wrong** - this one needs attention |
| `NOT CHECKED` | the check needed an argument that was not given            |

It ends with a block you can copy and send back, and it exits `1` only when something FAILED.

### "Is it behaving the way it should?"

[`docs/VERIFY.md`](docs/VERIFY.md) has one entry per feature: **what to do**, **what you should see**, **what a deviation looks like**, and **the short clip that shows it**. Work down it on the machine you are testing.

### "Something deviates"

[`docs/REPORT.md`](docs/REPORT.md) is a form to fill in and send. Please **never include the bridge token** - it is a secret, and the form says so.

---

## Running it in a container

If a student would rather install nothing at all, the app runs in a container:

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

Then open <http://localhost:3000>. Stop it again with `docker compose -f docker/docker-compose.yml down`.

The container is the **app** — the whiteboard, the panels, the code cards, the pages. The **extension stays on the host**, because it lives inside the editor and it _is_ the editor's own process. So the container reaches the host's bridge over `host.docker.internal`, and the compose file builds the app with `VITE_APP_BRIDGE_URL=ws://host.docker.internal:47511` to match.

That URL is **build-time** — it is baked into the bundle when the image is built. To change it, build again with another value:

```bash
docker compose -f docker/docker-compose.yml build \
  --build-arg VITE_APP_BRIDGE_URL=ws://host.docker.internal:47511
```

More in [`docker/README.md`](docker/README.md).

---

## The VS Code / VSCodium bridge

### Build and install the extension

The extension is published as a **release asset** - download `excalidraw-bridge-0.2.0.vsix` from the [releases page](https://github.com/Sairampv98/excalidraw-classroom/releases) and install it:

```bash
code    --install-extension excalidraw-bridge-0.2.0.vsix --force
codium  --install-extension excalidraw-bridge-0.2.0.vsix --force
```

Or build it yourself from this repository - one command, no extra tooling:

```bash
node packages/vscode-bridge/scripts/build-vsix.mjs
```

It works in **VS Code** and in **VSCodium** - the extension has no dependency of its own and declares only the stable API it uses.

### The token

The extension listens on the **loopback interface** on a **fixed port** (`47511` by default) and asks for a **per-session token** the first time it starts.

1. Click the extension's **status bar item** and choose **"Copy token"**.
2. Paste it into the **Bridge** box in the panel's properties.
3. That is it — **once per tab**. The token is remembered for the tab's session, so a reload does not ask for it again.

The token is a secret and it is treated like one:

- it is negotiated **in band**, in the first WebSocket frame — never in a URL;
- it is held **in memory** for the session only — never written to the document, never to local storage;
- it never appears in a saved file, a payload, or a log.

### If another editor has the port

Only one editor can hold the port at a time, and the app reaches that one — so it may not be the editor you have your file open in. The extension says so loudly when it cannot start, and gives you both ways out: close the other editor, or give this one a different port (`excalidraw-bridge.port`) and point the app at it with `VITE_APP_BRIDGE_URL`.

---

## Using it in a class

1. Open your project in VS Code or VSCodium. The bridge starts with the editor.
2. Copy the token from the status bar into the panel's **Bridge** box.
3. In the canvas, open the main menu (the **hamburger**, top left) and choose **"VS Code mirror (bridge)"** - or **"Code editor (in the browser)"** for an editor that needs no VS Code. The panel lands in the middle of what you can see.
4. The panel mirrors the file you are editing. **choose a language**, **zoom inside** the editor, and use **Run** to execute the draft.
5. Open the **presenter view** for the projector window.
6. **Take a picture** of anything on a panel — the crop it, read the text out of it, or drop it onto another page.

---

## The assistant

An AI assistant - Claude, or another - can work on the board **while you teach**: it looks at the canvas, draws on it, changes what is there, and makes things - a chart, a deck of slides, a page for the lesson.

It does that through a **small server that runs on your own computer**. The board connects to it; the server never reaches into the page. The server listens on **127.0.0.1 only**, and it accepts only a page served from this machine.

- **Add the server to your assistant.** It is one file, published with this release as `excalidraw-mcp-server.mjs`. For Claude Code:

  ```bash
  claude mcp add excalidraw -- node excalidraw-mcp-server.mjs
  ```

  Files are read and written only in the folders you list when the server starts: add `--folder "C:\path\to\folder"` to the command, once for each folder.

- **Pair the two.** The assistant asks its `status` tool for the **pairing code** - eight characters - and you type it once in the **Assistant** tab of the sidebar. It is remembered on this computer.
- **Allow changes.** The tab has an **Allow changes** switch. With it off the assistant may look at the board but not change it; with it on it may draw, edit and delete. **Every change it makes is one undo step** - Ctrl+Z takes the whole of it back.
- **Allow internet**, off by default: nothing is fetched from the web until you turn it on.

The tools are in **groups** - what the board can look at, what it can change, the pages, the pictures and files, the charts, the slides and the lesson pages - so a model finds the right one. The server also offers ready-made **prompts** (a deck of slides for a lesson, a chart of a process, a lesson page out of a document, a check of a page before a class), a **guide** to the tools, and a **skill** an assistant can load.

---

## The OCR engines and the ladder

You do not have to choose an engine: the machine chooses, and it says what it chose and why. Where a page is read there is a picker - each engine with the speed that was measured for it and what it needs - if you would rather choose:

| order | engine | when it is used | rough speed on an ordinary laptop |
| --- | --- | --- | --- |
| 1 | **indra** | when the bridge is connected and _indra_ is installed | ~150 ms |
| 2 | **tesseract** | always available: it runs in the browser (downloaded the first time) or in the bridge | ~250–500 ms |

The numbers are a guide, not a promise — they were measured on one machine and depend on the engine's model, the resolution of the region, and the machine itself.

_indra_ is a Python package, so it cannot run inside a web page: it runs in a small helper that the VS Code extension starts, and it is **not installed by default** (`pip install indra-ocr`). _tesseract_ needs nothing installed.

---

## The editor's window: control, parking and the virtual display

The mirror shows the editor's own window, live, and the canvas can **control** it when you choose: the mouse, the wheel and the keyboard go into the real window. There are three views - the **whole** window, a **part** you pick, and a part that **follows** the pointer. The input reaches the window **without bringing it forward**; where that does not work it goes **with the focus**, and the panel says which of the two it is on.

- **Parking.** The editor's window can be **parked**: kept out of the way, off every screen, with the mirror still showing it and still controlling it. Nothing parks it unless you ask.
- **The virtual display.** Where the machine has a virtual display - this project does not install one - one button moves the editor's window onto it and one brings it back to the main display. Give the virtual display the **same Windows scale** as the main display, or the editor looks smaller there and the zoom follows it back.
- **A window cannot be lost.** A window that was moved is **brought back** with its place restored. A window found on a screen that no longer exists is brought to the main display when the editor starts, and a one-file **rescue** script brings it back when the editor cannot be reached at all.
- Every placement reports the **measured** rectangle. A move that did not happen is never reported as one that did.

---

## Privacy and security

This is the part worth reading before you point it at a class.

- The bridge listens on **127.0.0.1 only**. Nothing outside your machine can reach it.
- The assistant's server listens on **127.0.0.1 only**, accepts only a page served from this machine, and asks for the pairing code before it does anything.
- The session token is per-session, in memory, and **never** in a URL, **never** in the document and **never** in a payload.
- The captured frames **never reach the document**. The live view is an MJPEG stream served by the extension's own local HTTP server; the document only ever holds a small descriptor.
- The OCR runs **on your machine**. The picture is not sent anywhere.
- The captions are read by the bridge, locally. If no bridge is connected, the panel says so instead of silently showing nothing.

---

## Known limitations

This is a hobby project. These are the real limitations, not the pleasant ones.

- **It is not in sync with upstream Excalidraw**, and it will not be. Upstream changes do not arrive here automatically.
- **The YouTube caption's second tier needs a YouTube Data API key** (`excalidraw-bridge.youtubeApiKey`). Without a key that tier is unavailable and the third tier is the normal one.
- **_indra_ is not installed by default.** The ladder falls back to _tesseract_ and says so.
- **The first use needs a connection.** The in-browser Python, the PDF reader and the in-browser OCR are each downloaded from a public CDN the first time they are used.
- **Go, Java, C and C++ are not available in the browser editor yet.** They run from VS Code when the bridge is connected and the language is installed on the machine.
- **Bold and italic are drawn by thickening and leaning the letters**, not by another face of the font: the letters keep their width, so nothing moves, and the look is close to - not the same as - a font's own bold.
- **The virtual display must already be on the machine**, and be **attached** (on Windows, the control panel of whatever made it — _Extend_), and the same Windows scale as the main display.
- **The OCR speed depends on the machine** and on the region you read.
- **The clips were recorded on one machine, on one browser.** They are a demonstration, not a benchmark.
- There is **no test for the recorder** — the extension finds the editor's window by rule, but an editor that titles itself unusually can defeat it.

---

## Upstream, licence and credits

This is a **fork of [Excalidraw](https://github.com/excalidraw/excalidraw)**, which is MIT licensed. The licence in this repository is upstream's, unchanged — see [LICENSE](LICENSE).

The Excalidraw project and its contributors deserve the credit. This fork exists because of that work.

Other pieces, and the people who made them:

- [CodeMirror](https://codemirror.net/) — the editor in the panel
- [tesseract.js](https://tesseract.projectnaptha.com/) — OCR in the browser's Node process
- [Pyodide](https://pyodide.org/) — Python in the browser
- [pdf.js](https://mozilla.github.io/pdf.js/) — the PDF viewer
- [indra-ocr](https://pypi.org/project/indra-ocr/) — the fastest engine
- [tesseract.js-core](https://github.com/naptha/tesseract.js-core) — the wasm cores that ship inside the extension

All names belong to their owners.

---

## Contributing and reporting a problem

This is a hobby project. Issues and pull requests are welcome, but there is no guarantee of a reply, and issues here do **not** go to the Excalidraw project. If your problem is with Excalidraw itself, report it [upstream](https://github.com/excalidraw/excalidraw/issues).

**To contribute code:** commit to `dev-draft` and open a pull request to `dev`. The maintainer does not merge a pull request as it stands: the change is described, rebuilt in the maintainer's own tree with its tests, and published back to `dev` - your pull request is then closed with thanks. Nothing is merged into `main` by a pull request.

---

## The clips

Fourteen of the features above have a short recording in [`clips/`](clips/). Open [`clips/index.html`](clips/index.html) to play them. The newer ones - the flow studio, the emoji and GIF bar, the media in a chart, the ink looks, the paper, the assistant and the parking of the editor's window - do not have one yet.

## Licence

MIT — see [LICENSE](LICENSE).
