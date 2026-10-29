# Excalidraw for the classroom

A **modified Excalidraw**: a fork that adds the things a teacher needs when a VS Code or VSCodium window is the thing being taught — a bridge between the editor and the canvas, panels, OCR, a presenter view, pages with a frame and a number, and a virtual display for the projector.

![the clips](clips/index.html)

> ### This release is superseded
>
> `version-1` is the **first public release**, kept as it was published. It is **no longer maintained**, and several of the features it lists **did not work when they were tested in a browser**. The repaired code is in [`main`](../../tree/main), the second release; the first release with only its repairs, as it was before that, is the [`v1.1`](../../tree/v1.1) branch.
>
> What did not work in this release:
>
> - **Undo of a page delete** brought the page back **without** what was drawn on it.
> - The camera was **locked to the page**: content outside the page could not be reached, and there was no way back to the page.
> - A document **inserted as a code block** that was taller than the page gave **no offer to split it**, and could not be scrolled.
> - **Selected text in the viewer** could not be sent to the page as a code card or a table.
> - **Run with no bridge** said that running needs the bridge: there was **no in-browser Python**.
> - The **presenter view stopped following** the editor past a hard limit down a long page.
> - The **code panel's editor** had no syntax colours until a language was chosen, and the **OCR text** was not shown anywhere.
> - The **screenshot** of a panel could be taken and cropped, but there was **no way to place it or leave** the crop without reloading the page.
> - **PDFs** in a browser without a PDF plug-in could not be opened at all.
>
> These are fixed in the development line (`dev`).

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
| **What is mirrored** | The panel mirrors the **whole** editor window by default. You can **crop a region**, change the crop as often as you like, and turn on **follow the cursor** so the region follows your pointer. |
| **OCR** | One action: **crop and read**. The machine picks the engine it can actually run — _indra_ with the bridge, _tesseract_ without it, _paddle_ last — and tells you which one it used and why. |
| **The presenter view** | A second window for the projector: the same canvas, full screen, following you. |
| **Pages** | A page has a **frame** you can toggle, a **page number** in its footer, and a **size** from presets (A4, Letter, 16:9, 4:3, 1920×1080) — and the export honours it. |
| **The virtual display** | Move the editor's window onto a **virtual display** for the projector, and bring it back — but only when **you** choose to. |
| **YouTube captions** | Three tiers, and the panel says which tier answered. |

The [clips](clips/index.html) show each of these working. The long version, with what each feature will and will not do, is in [`docs/FEATURES.md`](docs/FEATURES.md).

---

## The branches of this repository

`main` holds the current release - the second one - `dev` is where the next is prepared and follows `main`, `dev-draft` is where contributors commit, `v1.1` is the first release with its repairs, and `version-1` - this branch - is the first release, kept as it was published.

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

Some rooms have no internet, or the teacher would rather not trust it. The **offline setup** is one file that carries everything it needs inside itself - the app, the extension, Node.js, the editors, Python, Java and the virtual display driver.

Download `OfflineSetup.exe` from the [releases page](https://github.com/Sairampv98/excalidraw-classroom/releases) and double-click it. It:

- unpacks what it carries and **checks every file against its hash** - a file that does not match is refused, never downloaded;
- **serves the app straight away** - the app is a static bundle, so **nothing has to be installed for it to run**;
- then asks, **one thing at a time**, whether to install the rest from its own payload: Node.js, VS Code or VSCodium, Python (only for the _paddle_ OCR engine), Java (only to build the app yourself) and the virtual display driver (which needs **administrator rights** and a **reboot** afterwards).

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

The extension is published as a **release asset** - download `excalidraw-bridge-0.1.0.vsix` from the [releases page](https://github.com/Sairampv98/excalidraw-classroom/releases) and install it:

```bash
code    --install-extension excalidraw-bridge-0.1.0.vsix --force
codium  --install-extension excalidraw-bridge-0.1.0.vsix --force
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
3. In the canvas, open the main menu (the **hamburger**, top left) and choose **"Code panel (VS Code)"**. The panel lands in the middle of what you can see.
4. The panel mirrors the file you are editing. **choose a language**, **zoom inside** the editor, and use **Run** to execute the draft.
5. Open the **presenter view** for the projector window.
6. **Take a picture** of anything on a panel — the crop it, read the text out of it, or drop it onto another page.

---

## The OCR engines and the ladder

You never have to choose an engine. The machine chooses, and it says what it chose and why:

| order | engine | when it is used | rough speed on an ordinary laptop |
| --- | --- | --- | --- |
| 1 | **indra** | when the bridge is connected and _indra_ is installed | ~150 ms |
| 2 | **tesseract** | when the bridge is not connected — it runs in the browser's own Node process | ~250–500 ms |
| 3 | **paddle** | last resort, when nothing else is there | **17–45 seconds** |

The numbers are a guide, not a promise — they were measured on one machine and depend on the engine's model, the resolution of the region, and the machine itself.

_indra_ is **not installed by default**. Install it with `pip install indra-ocr`, and the ladder will find it. _tesseract_ ships **inside the extension** — no install needed. _paddle_ needs Python and PaddleOCR; the extension ships a path to an interpreter as its default.

---

## The virtual display and the input panel

The extension can put a window on a **virtual display** — a second screen the projector sees, so the students see the editor and you see something else.

- **Moving the editor's own window is an option you choose**, never something that happens by default. The presenter placement is unchanged.
- A window that was moved can be **brought back**, with its maximised state restored.
- If a virtual display driver is installed but **not attached**, the panel says so and names the click that attaches it — it never claims there is no display when there is one.
- Every placement reports the **measured** rectangle. A move that did not happen is never reported as one that did.

---

## Privacy and security

This is the part worth reading before you point it at a class.

- The bridge listens on **127.0.0.1 only**. Nothing outside your machine can reach it.
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
- **_paddle_ is slow** — tens of seconds on a full frame. It is the last resort, not the default.
- **The virtual display needs a virtual display driver** installed and **attached** (on Windows, the driver's own control panel — _Extend_).
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
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — the OCR sidecar
- [indra-ocr](https://pypi.org/project/indra-ocr/) — the fastest engine
- [tesseract.js-core](https://github.com/naptha/tesseract.js-core) — the wasm cores that ship inside the extension

All names belong to their owners.

---

## Contributing and reporting a problem

This is a hobby project. Issues and pull requests are welcome, but there is no guarantee of a reply, and issues here do **not** go to the Excalidraw project. If your problem is with Excalidraw itself, report it [upstream](https://github.com/excalidraw/excalidraw/issues).

---

## The clips

Every feature above has a short recording in [`clips/`](clips/). Open [`clips/index.html`](clips/index.html) to play them.

## Licence

MIT — see [LICENSE](LICENSE).
