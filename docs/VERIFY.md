# How to confirm it works

Two things are on this page.

1. **The install check** - one command that says, item by item, what is right and what is not on this machine.
2. **The feature checklist** - what each feature should look like, so a deviation is obvious and can be reported.

Both are written for a reader, not for a developer. If something does not match, say so - see [REPORT.md](./REPORT.md) for how to report it.

---

## 1. The install check

After the setup has run, open a terminal in the folder you unpacked the app into and run:

```
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1
```

The check **only reads** the machine. It installs nothing, changes nothing and removes nothing, so it is safe to run as often as you like.

If you serve the app yourself, tell the check where it is served from:

```
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1 -AppUrl http://127.0.0.1:3001
```

### What the verdicts mean

| verdict | what it means |
| --- | --- |
| **PASS** | It is there and it is right. |
| **MISSING** | It is not installed. This is often fine - the app itself needs very little. |
| **FAIL** | It is there but it is **wrong**. This is the one that needs attention: a wrong version, a wrong port, a file whose hash does not match, an editor without the extension in it. |
| **NOT CHECKED** | The check needed an argument that was not given, so it did not look. Nothing is wrong. |

The check ends with a **block you can copy and send back as it is**. That block holds the machine's facts, the table and the counts. It is the first thing worth attaching to a report.

### The output of this check on a working machine

This is the real output, on a machine that has Windows 11, Node.js, Yarn, VS Code, VSCodium, the extension, the virtual display driver and the offline payload installed:

```
Excalidraw for the classroom - checking the install
This only reads the machine. It changes nothing.

  check                                 expected                                                            actual                                                                          verdict
  ------------------------------------  ------------------------------------------------------------------  ------------------------------------------------------------------------------  -------
  the operating system                  Windows 10 or 11                                                    Microsoft Windows 11 Pro (10.0.22631, build 22631)                              PASS
  Node.js                               20 or newer                                                         22.23.2                                                                         PASS
  Yarn                                  installed                                                           1.22.22                                                                         PASS
  VS Code                               installed, 1.91.0 or newer                                          1.143.0                                                                         PASS
  VSCodium                              installed, 1.91.0 or newer                                          1.140.06880                                                                     PASS
  the extension, in VS Code             excalidraw-teacher-help.excalidraw-bridge                           listed                                                                          PASS
  the extension, in VSCodium            excalidraw-teacher-help.excalidraw-bridge                           listed                                                                          PASS
  the extension's helpers, in VS Code   media\capture.ps1, media\virtual-display.ps1, media\ocr_sidecar.py  all three are there                                                             PASS
  the extension's helpers, in VSCodium  media\capture.ps1, media\virtual-display.ps1, media\ocr_sidecar.py  all three are there                                                             PASS
  the virtual display driver            installed and attached                                              Virtual Display Driver (1920 x 1080)                                            PASS
  the bridge                            listening on 47511                                                  not listening - no editor is running, and the bridge only listens while one is  MISSING
  the app                               HTTP 200 at the address it is served from                           not checked - no address was given                                              NOT CHECKED
  the offline payload's hashes          every file in manifest.json matches                                 3 of 3 files match                                                              PASS

PASS 11   FAIL 0   MISSING 1   NOT CHECKED 1
Nothing FAILED.
```

And the block it prints at the end - the one to copy when you report something:

```
Excalidraw for the classroom - the install check

Computer: DESKTOP-OVN5B41
User: user
Windows: Microsoft Windows 11 Pro (10.0.22631, build 22631)
Checked: 2026-10-25 19:20:46
Node.js: 22.23.2
Yarn: 1.22.22
VS Code: 1.143.0
VSCodium: 1.140.06880
An editor was running: no
The app was checked at: not checked - no address was given

| check | expected | actual | verdict |
| --- | --- | --- | --- |
| the operating system | Windows 10 or 11 | Microsoft Windows 11 Pro (10.0.22631, build 22631) | PASS |
| Node.js | 20 or newer | 22.23.2 | PASS |
| Yarn | installed | 1.22.22 | PASS |
| VS Code | installed, 1.91.0 or newer | 1.143.0 | PASS |
| VSCodium | installed, 1.91.0 or newer | 1.140.06880 | PASS |
| the extension, in VS Code | excalidraw-teacher-help.excalidraw-bridge | listed | PASS |
| the extension, in VSCodium | excalidraw-teacher-help.excalidraw-bridge | listed | PASS |
| the extension's helpers, in VS Code | media\capture.ps1, media\virtual-display.ps1, media\ocr_sidecar.py | all three are there | PASS |
| the extension's helpers, in VSCodium | media\capture.ps1, media\virtual-display.ps1, media\ocr_sidecar.py | all three are there | PASS |
| the virtual display driver | installed and attached | Virtual Display Driver (1920 x 1080) | PASS |
| the bridge | listening on 47511 | not listening - no editor is running, and the bridge only listens while one is | MISSING |
| the app | HTTP 200 at the address it is served from | not checked - no address was given | NOT CHECKED |
| the offline payload's hashes | every file in manifest.json matches | 3 of 3 files match | PASS |

PASS 11   FAIL 0   MISSING 1   NOT CHECKED 1
```

Three things to read in that table:

- **The bridge is MISSING, not FAIL.** The bridge only listens while an editor is open, and no editor was open when the check ran. Open VS Code or VSCodium and run the check again: the row then says it is listening.
- **The app is NOT CHECKED.** No address was given. Pass `-AppUrl` with the address you serve the app from and the row becomes `200`.
- **Everything else passes**, including the payload's hashes - every file the offline payload lists was checked again and matches.

---

## 2. The feature checklist

Every feature has the same four parts, so you always know where to look.

> **What to do** - the clicks, in order.
>
> **You should see** - the exact words or the exact picture.
>
> **If it is not that** - what a deviation looks like, and what to check.
>
> **See it** - the clip that shows it working.

The clips are in the [`clips`](../clips/index.html) folder.

### 2.1 Panels on the canvas

**What to do** - From the main menu choose **Code panel (VS Code)**. Then open the **Files** sidebar on the left, find a video file, and drag its row onto the canvas.

**You should see** - A code panel on the canvas: a dark panel with its own chrome - a language picker, a **Copy as code block** button and a zoom control. A video panel with the video's own player controls. Both float free on the canvas, and clicking one selects it.

**If it is not that** - No panel appears at all: the app cannot reach the editor. Run the install check and read the bridge row. The panel appears but is empty: the file open in the editor is empty. The language picker is missing: that is not a code panel.

**See it** - [01 - panels on the canvas](../clips/01-panels-on-the-canvas.mp4)

### 2.2 The properties panel

**What to do** - Click the code panel once, to select it.

**You should see** - The properties panel on the left shows **Panel**, then **Kind**: code and **State**: Live, and under **Actions** the camera button, **Read the text** with its engine picker beside it, and the **Bridge** box. The picture on the canvas carries none of these - they live in the properties panel.

**If it is not that** - The properties panel does not change when you select the panel: the panel is not selected. **Read the text** is greyed out: the bridge is not connected - check the bridge row. The picture on the canvas has its own buttons on it: you are looking at a different kind of panel.

**See it** - [02 - the properties panel and its actions](../clips/02-properties-panel-actions.mp4)

### 2.3 Crop and read

**What to do** - Select the panel. Press the **camera** button in the properties panel. Drag a rectangle over the part of the panel you want. Press **Read the text**.

**You should see** - The properties panel says **Reading the text…** while it reads. When it finishes it says which engine it used **and why it did not use the one above it**, for example:

> Read 12 lines with tesseract in 936 ms. indra was not used: the OCR sidecar is not running.

The text then lands on the canvas, one line of text per line.

**If it is not that** - It stays on **Reading the text…**: the read is stuck - press **Cancel**. It says **No engine could read the text.**: none of the three engines is installed on this machine. The text lands as one big block instead of line by line: the read did not split by line.

**See it** - [03 - crop and read](../clips/03-crop-and-read.mp4)

### 2.4 The crop really crops

**What to do** - Select a video panel, press the **camera** button, then drag a crop handle on the picture that appears.

**You should see** - The picture shrinks to the cropped region; the part outside the crop is gone. The picture that lands on the canvas is visibly smaller than the uncropped one and shows only the cropped region.

**If it is not that** - The picture is the same size as before: the crop was not applied. Press **Revert the crop** and drag the handle again.

**See it** - [04 - the crop crops](../clips/04-the-crop-crops.mp4)

### 2.5 The placement flows

**What to do** - After the crop, choose where it goes: **Place on this page**, **Place on a new page**, or pick a page from the page ribbon. Then drag the **The screenshot goes here** wireframe onto the canvas and drop it.

**You should see** - The steps come in that order: the crop first, then the choice, then the page, then the target. The wireframe follows the mouse, and when you drop it the picture lands there and the popup closes and hands the canvas back - the mouse and the keyboard are yours again. In the flow that places **text**, the wireframe reads **The text goes here** instead: that is the flow that asks where the **text** goes.

**If it is not that** - The popup stays open after the drop: the drop did not land on the canvas. The wireframe says **The screenshot goes here** when you expected **The text goes here**: you are in the picture flow, not the text flow.

**See it** - [05 - the placement flows](../clips/05-placement-flows.mp4)

### 2.6 The presenter view

**What to do** - Write something on the canvas. From the main menu choose **Presenter view**.

**You should see** - The presenter view opens in its own window, waits for the editor, and then shows the same canvas you are teaching. Press **F** for fullscreen.

**If it is not that** - The window opens but stays black: the editor is not connected - check the bridge row of the install check. The window opens but shows a different canvas: the presenter view follows the page you are on, so turn to the right page first.

**See it** - [06 - the presenter view](../clips/06-presenter-view.mp4)

### 2.7 The live editor

**What to do** - Select the code panel. Inside the panel's editor view, drag the mouse over some text to select it. Press **Copy as code block**, then paste on the canvas. In the panel's own bar, change the language to **python**. Then zoom the panel in.

**You should see** - The selected text goes to the clipboard and, pasted on the canvas, arrives as **one code card**. The language in the panel's bar reads **python**. The editor zooms to 150% **inside the panel** while the canvas zoom stays at 67% - the two zooms are independent.

**If it is not that** - The paste arrives as a row of plain text boxes: the code card did not come - copy again in the same window and paste. The canvas zoom changes when you zoom the panel: the panel is zooming the canvas, which it must not do. The file's language did not change in the editor: it must not. The language is the panel's own reading of the file.

**See it** - [07 - the live editor](../clips/07-live-editor.mp4)

### 2.8 What is mirrored

**What to do** - Select the code panel. Press **Change what is mirrored**. The whole window appears with a crop on it; drag a rectangle over the part you want and confirm. Press **Change what is mirrored** again and draw a different rectangle. Then press **Follow the cursor**, move the mouse, and press it again to stop following.

**You should see** - The whole editor's window is mirrored by default. After you draw a crop, the panel shows **only** that region. Changing the region again changes what the panel shows. With **Follow the cursor** on, the region follows the pointer; with it off, the region stays where you left it.

**If it is not that** - The panel still shows the whole window: the crop was not confirmed. The region does not follow the pointer: **Follow the cursor** did not turn on - while it is on, its label reads **Stop following the cursor**.

**See it** - [08 - what is mirrored](../clips/08-what-is-mirrored.mp4)

### 2.9 Run

**What to do** - Select the code panel. In the panel's runtime picker, choose a language. Press **Run**.

**You should see** - The picker offers only the runtimes that are really on this machine - javascript, python, java, c and cpp, and **not** rust, which is not installed. **Run** executes the draft in the teacher's own workspace:

> Run started: node excalidraw-bridge-snippet-code-run-1.js

then the output of the program, then:

> Run finished with code 0.

**If it is not that** - The picker offers a language that is not installed: it must not. **Run** says **Running needs the Excalidraw Bridge.**: the bridge is not connected. The run says **The run timed out after 10 s.**: the program took too long.

**See it** - [09 - run the code](../clips/09-run-code.mp4)

### 2.10 The pages

**What to do** - Open the **Page** bar. Turn on **Show the page's frame**. Turn on **Show the page's number**. Choose the **A4 portrait** size preset. Press **Export pages**.

**You should see** - The page's frame is drawn on the canvas. The page's number appears at the foot of the page. The page changes shape to A4 portrait. The exported PDF is at that same shape.

**If it is not that** - The frame is not drawn: the toggle is off. The number is missing: the toggle is off. The export is a different shape: the preset was not applied before the export.

**See it** - [10 - the page's frame, number and size](../clips/10-pages-frame-number-size.mp4)

### 2.11 The virtual display

**What to do** - Open the extension's presenter panel. Press **Move this editor to the virtual display**. Then press **Bring this editor back to this screen**.

**You should see** - The panel reports the virtual display it found:

> a window goes on the virtual display Generic PnP Monitor (1920x1080 at 1920,0)

Nothing moves until you press the button - moving your own window is your choice, not the tool's. When you do press it, the editor's window really goes to the virtual display, and the extension reports what it did, with the **measured** rectangle it used, so you can see where the window landed.

**If it is not that** - The panel says there is no virtual display: the driver is not installed - read the **the virtual display driver** row of the install check. The window did not move: the placement failed and the panel says why. The window is on the virtual display and you cannot get it back: press **Bring this editor back to this screen** again.

**See it** - [11 - the virtual display](../clips/11-virtual-display.mp4)

### 2.12 YouTube

**What to do** - Insert a YouTube panel, paste a YouTube link into it, and press **Add video**.

**You should see** - The video plays in **YouTube's own player** - the panel is not a copy of the video. The captions come from one of **three tiers**, and the panel says which tier answered. On a machine with no YouTube Data API key the third tier answers, and the panel says so:

> no captions: the YouTube API key is not set and the public timedtext endpoint gave nothing back. Set excalidraw-bridge.youtubeApiKey to read them

**If it is not that** - The panel shows a black rectangle: the embed did not load - check the machine's internet connection. The panel says **Captions from the YouTube Data API.**: the first tier answered. It says **Captions from the public endpoint - they may be incomplete.**: the second tier answered.

**See it** - [12 - the YouTube captions](../clips/12-youtube-captions.mp4)

### 2.13 The code card

**What to do** - In the Files sidebar, open a markdown file, find a fenced code block, press **Copy code**, then paste on the canvas.

**You should see** - One dark card of monospace, syntax-highlighted text - not a row of plain bordered text boxes. The live editor's **Copy as code block** produces the **same** card; the two are one thing, not two.

**If it is not that** - A row of plain bordered text boxes: the code card did not come - press **Copy code** again in the same window and paste. The card is there but not coloured: the language was not recognised - set the language on the card itself.

**See it** - [13 - the code card](../clips/13-the-code-card.mp4)

### 2.14 The file sidebar

**What to do** - Open the **Files** sidebar. Look at the groups. Open a markdown file in the viewer. Drag a video row onto the canvas.

**You should see** - The listing is grouped by type - **Images**, **Documents**, **Markdown**, **Code**, **Video** and **Unsupported**. A file that cannot be used is listed **with the reason**:

> archive.zip - unknown file type

Dragging a video row onto the canvas puts a loading wireframe where the player will land.

**If it is not that** - The listing is one flat list: the grouping is not there. A file is listed with no reason beside it: the reason is missing - a file that cannot be read says **could not be read**, and one of an unknown type says **unknown file type**. The drag does nothing: the file is in the **Unsupported** group.

**See it** - [14 - the file sidebar](../clips/14-the-file-sidebar.mp4)

### 2.15 The live view

**What to do** - Select the code panel and open its **Live window** view. Move through the file in the editor.

**You should see** - The editor's own window mirrored into the panel as a live stream: the picture follows the editor as you move through the file, and the panel's own state follows the file that is open.

**If it is not that** - The picture is frozen: the live stream is not arriving, and the panel says **The live window has not arrived yet.** The picture is fuzzy or torn: the machine is busy - close other programs and try again.

**See it** - [15 - the live view](../clips/15-the-live-view.mp4)

### 2.16 The OCR engines

**What to do** - Select a panel and look at the engine picker beside **Read the text**.

**You should see** - Three engines, each with its measured speed shown as a colour - green for the fastest, amber for the one in the middle, red for the slowest: **indra**, **tesseract** and **paddle**. **tesseract** needs no Python; **indra** and **paddle** do.

**If it is not that** - The picker offers only one engine: the other two are not installed. A read says _indra was not used: the OCR sidecar is not running._: indra needs its sidecar, and the sidecar needs Python. A read says _paddle was not used: ..._: paddle needs Python as well. **tesseract** is the one that works on a machine with no Python at all.

**See it** - [03 - crop and read](../clips/03-crop-and-read.mp4)

---

## 3. When something is not right

Do not try to work around it. Write down what happened and send it in - see [REPORT.md](./REPORT.md). The block the install check prints at the end is the first thing to attach.
