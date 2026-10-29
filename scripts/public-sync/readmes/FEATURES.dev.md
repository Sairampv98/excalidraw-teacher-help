# The features, in more depth

A reader's guide to what this fork adds to Excalidraw, and what each feature will and will not do. Every feature below has a short recording in [`../clips/`](../clips/index.html).

This is a hobby project. It is not maintained, and it is not in sync with upstream Excalidraw. Read [Known limitations](#known-limitations) in the [README](../README.md) before you rely on it.

---

## Panels

A **panel** is a canvas element that holds something: the editor's text, a video, a YouTube player, a picture. It is one element with one overlay, and the different kinds of panel only differ in what is **inside** it.

- It **floats** over the canvas, and it can be **locked** in place - and unlocking is reversible.
- Its live state - whether it is connected, whether it is reading - rides **inside** the element as plain data, so a saved document keeps what the panel was doing.
- It never sits **blank**: a region with nothing in it says **why**, and names what to do about it.
- The chrome is sized for the **screen** and the content for the **panel**, and the panel's own transform is the one source of the scale - so the panel looks the same at every zoom.

**What it does not do:** the panel is a _view_, not an editor for the file itself. The file in your editor is the source of truth; the panel mirrors it.

## The bridge

The bridge is a VS Code / VSCodium extension. It connects your editor to the canvas.

- The editor's file is **mirrored into a panel**, and it follows the file you are editing - not merely whatever has focus.
- **Run** executes the panel's draft **in your workspace**, with a timeout and a bounded output.
- The **runtime picker** offers only the runtimes that are really on this machine, and a runtime that is missing is an explicit state, never a silent failure.
- The editor's window is found **by rule**, even when it is not the foreground window, and the capture **re-resolves** the window whenever it stops producing a picture - it restarts a helper that has died.

### The token

The extension listens on the **loopback interface** on a **fixed port** (`47511` by default) and asks for a **per-session token**.

- The token is negotiated **in band**, in the first WebSocket frame. It is never in a URL.
- It is held **in memory** for the session only. It is never written to the document and never to local storage.
- The app remembers it for the **tab's session**, so a reload does not ask for it again.

### If another editor has the port

Only one editor can hold the port, and the app reaches that one - so it may not be the editor you have your file open in. The extension says so loudly when it cannot start, and gives both ways out: close the other editor, or give this one a different port (`excalidraw-bridge.port`) and point the app at it with `VITE_APP_BRIDGE_URL`.

## The live editor

The mirrored text is a **real editor**, not a read-only dump.

- You can **select** the text and copy it, and it pastes onto the canvas as the **same code card** the markdown viewer's _Copy code_ makes - the dark card with the monospace, not a row of plain bordered boxes.
- You can choose the **language** the file is read as. That is the panel's own reading of the file; it never changes the file in the editor.
- The editor **zooms inside** the panel. That zoom is the editor's, and it never moves the canvas's zoom.
- Your own edits are a **draft** on the panel. The mirror never overwrites your draft, and the mirror is only what a draft starts from.

**What it does not do:** the editor cannot edit the file. It is a mirror; the file in your editor is the truth.

## A code editor of its own

A panel that needs no VS Code: choose **Code editor (in the browser)** in the main menu.

- **Python and JavaScript run in the browser.** Python is downloaded the first time it runs (a download of several megabytes from a public CDN) and kept by the browser; JavaScript runs in a worker. Nothing is installed.
- The **Input** box under the console holds the lines a program reads with `input()`. When a program asks for more than was typed it says so, and says what to do.
- A program that runs **too long** is stopped after 10 seconds, and the console says it may be an infinite loop. A program that prints too much is stopped at the output limit. A program that dies is reported as a crash. A browser can end a program that uses too much memory without a word - that case is reported, not prevented.
- Each **Run starts on an empty output**.
- The editor has a **dark** and a **light** theme that paint the whole panel. The console can be **docked below or beside** the editor, resized with a divider, zoomed on its own, and cleared.
- A language the browser does not run is run by **VS Code** when the bridge is connected and the language is installed on that machine (Java, Go, C and others), and the picker says so. Without the bridge, those languages say what is missing. **Go, Java, C and C++ are not available in the browser yet.**

## What is mirrored

The panel mirrors the **whole** editor window by default.

- **Change what is mirrored** opens that whole window - the same picture a screenshot gives - so you can see what you are choosing.
- You **crop a region**, and you can change that crop **as often as you like**: it is a setting, not a one-shot.
- **Follow the cursor** is a **mode**. The region follows your pointer inside the panel. It is **off by default**, and you can turn it off again.
- The region is measured in **fractions of the window**, so resizing the window does not move the region out from under you.

**What it does not do:** the region does not change how the window is found. The capture still finds your editor by rule.

## Screenshots, cropping and OCR

One action does the whole thing: **crop and read**.

- The three choices - read the text, put it on this page, put it on another page - appear **only after** the screenshot is taken, and they are the only choices.
- The crop **really crops**: the handles change the picture that is placed.
- Placing shows a **wireframe** where it will land, and you place it. When the picture is placed, the popup **hands the canvas back**.
- The flows run in the order you asked for: **crop first**, then the choice, then the page (through the page selector ribbon), then the target. The flow that writes **text** asks where the **text** goes, not where the picture would go.
- Reading a **PDF page or a picture** shows the whole page first: **drag over the area to read**, or read the whole page. Only that area is read.
- The text that was read is **shown first** - with its indents, and open to correction - and goes to the page only when you choose: as a **code block**, as **text**, or **where it was** (one text for each line, at the place it had on the page).
- A read says how far it is: a progress bar with a Stop button. A read that finds nothing says so.

### The engine ladder

You do not have to choose an engine: the machine chooses, and it says what it chose and why. Wherever a page is read - the PDF's **Read this page**, the question about the area, the crop of a panel - there is a **picker**, each engine with the speed that was measured for it and what it needs, if you would rather choose.

| order | engine | when | rough speed |
| --- | --- | --- | --- |
| 1 | **indra** | the bridge is connected and _indra_ is installed | ~150 ms |
| 2 | **tesseract** | always: it runs in the browser (downloaded the first time) or in the bridge | ~250–500 ms |

A slow read is **visible**: the panel says it is reading, and you are not left looking at a dead button. An engine that is not installed is an **explicit, actionable** state. _indra_ is a Python package, so it runs in a small helper that the VS Code extension starts - it cannot run inside a web page.

## The presenter view

A second window for the projector. It is the **same canvas** the teacher is teaching - the panels come from the scene it already carries, and the live view's descriptor is published to it so it can play the same stream. It follows the teacher all the way down a long page, and when a panel is shown **full screen** the presenter shows it full screen too.

## Pages

A page is a **page**, not just a rectangle of canvas.

- A **frame** you can toggle on and off, drawn around the page's content.
- A **page number** in the page's footer - the page's own number.
- **Undo** of a page delete brings the page back **with** what was drawn on it, and deleted pages are kept by the browser (the 100 newest), so one can be restored even after a reload.
- The camera is **not locked to the page**: content outside the page can be reached, and a **Back to this page** button returns to it.
- A **size** from presets: A4 portrait and landscape, Letter portrait and landscape, 16:9, 4:3 and the project's own 1920×1080. A preset fixes the page's shape, and because a page may only grow, the shape is scaled up to the minimum page size - so the **exported** image comes out in the preset's shape.

## The virtual display and the input panel

- The virtual display is **reported** the way a teacher needs it: if a driver is installed but **not attached**, the panel names it and names the click that attaches it (on Windows, the driver's own control panel - _Extend_).
- Moving **your own** window onto the virtual display is an **option you choose**. It is never on by default, and the presenter's placement is unchanged.
- A window that was moved can be **brought back**, with its maximised state restored.
- Every placement reports the **measured** rectangle. A move that did not happen is never reported as one that did.
- The **input panel** lets the teacher send commands to the app without taking the focus away from their editor - and the teacher's own keystrokes are never stolen.

## YouTube

- A YouTube video is an **iframe of YouTube's own player**. The project never parses YouTube's pages.
- The **captions have three tiers**, and the panel says which tier answered. The second tier needs a YouTube Data API key; without one, the third tier is the normal one.
- The captions live in an ordinary text element **beside** the panel, and the note is **one line** - the whole reason is in its tooltip.
- The video keeps its **whole panel**, and the caption note floats over it.

## Files and the sidebar

- **Open files**, **Open folder** and **YouTube link** are icon buttons in the sidebar's header; the field for a YouTube link opens below when its button is pressed.
- The list is **grouped by type**, and the badge is per kind.
- A file that cannot be used is listed **with the reason why** - a reason you can act on.
- A video row **drags** onto the canvas, and a loading wireframe stands where the player will land.
- A video bigger than **32 MB** does not become a base64 data URL: it is stored as a blob in the origin's own IndexedDB. The library resolves it through a registry the host fills; the library never touches IndexedDB itself, and the presenter resolves it from the same origin's store, so a big video reaches it with no transfer and no size limit.
- A video in a container the browser **cannot play** is never silent: the panel says so and shows the command that fixes it.

## Documents: markdown and source files

- A **markdown** document is shown rendered; a source file is shown highlighted. **Zoom** scales the document.
- A **link** goes where it points. A link to another file of the opened folder - written relative to the document, from the root of the folder, with or without `.md`, to a folder (its index or README) or to a heading - opens that file **in the viewer**; a link to a website opens a **new tab**; a link to a file that was not opened says which one is missing.
- **Select text** and the choices float under the end of the selection, inside the document: a **code card**, a **text box**, a **table**, and a close button. The text is copied as well. The text box has the **bold and italic** parts the document had - a heading, a **strong** phrase, an _emphasised_ word - so it is on the page as it was written.
- The text of a **link** can be selected like any other text.

## Bold and italic

A text on the canvas can have **parts** that are bold, italic or both.

- In the editor of a text, **select** what you want and press **Bold** or **Italic** (under the font family, or Ctrl+B and Ctrl+I): only the selected part changes, and pressing again takes it off. With nothing selected, or with the text only selected on the page, it is the whole text.
- The buttons are lit when everything they are for has the style. What is typed in a bold part is bold; what is deleted takes its style with it. The editor shows the styled parts as you work.
- The styled parts are in the canvas, in an exported image and in the SVG, are saved with the drawing and can be undone.

**What it does not do:** bold and italic are drawn by **thickening and leaning the letters** of the font, not by another face of it - so every letter keeps its width and nothing moves when a part is styled. The look is close to a font's own bold and italic, not the same. A line that reads from right to left is drawn plain.

## Paste and markdown

- Paste a **markdown document** and it becomes real elements - a code block becomes a code card, a table becomes a table, a mermaid fence becomes a diagram.
- **Reformat selection** offers the choices, and it never resolves itself: when a paste does not fit, you are _offered_ the choice.
- The fit is decided **per line** - a line that lies entirely inside the page fits, a line that straddles the edge does not.

## PDFs

A PDF opens in a viewer of its own (pdf.js, downloaded the first time it is used), so it does not depend on the browser having a PDF plug-in.

- The page opens **fitted** to the panel. **Fit width**, **Fit page** and **Read this page** are icon buttons in the row of the zoom, outside the part that scrolls, so they are always in view. Ctrl and the wheel (or a pinch) zoom, the plain wheel scrolls, and the **middle mouse button** drags the page about. A zoom keeps the part of the document you were looking at in the middle of the view.
- It stays smooth at a high zoom: every page has its room at once, only the pages near the view are drawn, and a page that goes far from the view gives its pixels back.
- A drag on a page draws a **dashed box**, and the box is the selection. The choices are a row of icons **under the box**: a **code card**, a **text box**, a **table**, **where it was** (one text for each line, at the place it had on the page) and **as an image**. What is in the box is copied too. The text of a PDF is real text, so the pieces that are bold or italic in the PDF are bold or italic in the text box and in the lines of _where it was_.
- **As an image** draws that part of the page again from the PDF itself, at up to six times its size (never more than 4096 pixels on its long edge), so the picture is as sharp as the page can give at any zoom of the viewer.
- A page with no text - a scan - says so and points to **Read this page**, which reads the page you are on with OCR; the picker next to it chooses the engine.

## The live view

The editor's window is mirrored as a **live MJPEG stream** served by the extension's own local HTTP server.

- The frames **never travel over the websocket**, and they **never reach the document** - the document holds only a small descriptor.
- The stream is authorised by a **per-connection capability** in the URL path. The session token never appears in a URL.
- An unchanged picture is not published again, and the editor's text is published **at most every 100 ms**.
- The capture is the window's **client area**, a JPEG, scaled down - and it is the **whole window**, unless you choose a region.

---

## Setting it up, and checking that it worked

The features above are the point of this project. Getting them onto a machine is a separate job, and it is covered by its own documents:

| document | what it covers |
| --- | --- |
| [`INSTALL.md`](docs/INSTALL.md) | the setup, the container, the extension, the token, and what a machine on ARM64 must change |
| [`OFFLINE.md`](docs/OFFLINE.md) | the setup that needs **no internet at all** - one file that carries everything it needs |
| [`VERIFY.md`](docs/VERIFY.md) | **how to confirm it works**: one entry per feature, with what to do, what you should see and what a deviation looks like |
| [`REPORT.md`](docs/REPORT.md) | how to report a deviation, and how not to leak the bridge token while doing it |

And one command that checks the machine itself:

```powershell
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1
```

It only **reads** the machine. It prints one row per check, and the three verdicts mean different things: `PASS` (it is there and it is right), `MISSING` (it is not installed - often fine) and `FAIL` (it is there but it is **wrong** - the one that needs attention).
