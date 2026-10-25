# How to report something that is not right

If something did not behave the way [VERIFY.md](./VERIFY.md) says it should, this is how to report it. The report is the only thing that makes a deviation fixable, so please send one even if you are not sure it is a real problem.

A report takes five minutes to write.

> **The session token is a secret. Never put it in a report - not in the text, not in a screenshot, not in a copied block.** The check below never asks for it and never prints it, so there is nothing you need to remove. If a token ever appears in what you are about to send, delete that part and send the report without it.

## 1. What you did

The clicks, in order. A sentence or two is enough.

> Example: I selected the code panel, pressed the camera button, dragged a rectangle over the top half of the code, and pressed **Read the text**.

## 2. What you expected

What [VERIFY.md](./VERIFY.md) says should happen, and which part of it you were following.

> Example: section 2.3 "Crop and read" says the text should land on the canvas, one line of text per line, and that the panel should say which engine it used.

## 3. What you actually saw

**Quote it exactly** - copy the words from the screen rather than describing them. "Read 12 lines with tesseract in 936 ms" is useful; "it read some text" is not. If there was an error message, quote all of it.

> Example: the properties panel said `Reading the text…` and stayed there for about a minute. I pressed **Cancel** and it said `The read was cancelled.` Nothing landed on the canvas.

## 4. Which feature

The number of the section in [VERIFY.md](./VERIFY.md) - for example **2.3** for "Crop and read". If you are not sure which one, say which button you pressed.

## 5. The check report

Run the check again and copy the block it prints at the end, exactly as it is:

```
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1
```

The block looks like this:

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

Paste the whole block, between the three backticks, into your report. If you serve the app yourself, run the check with the address so the **the app** row is checked too:

```
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1 -AppUrl http://127.0.0.1:3001
```

## 6. The machine

Two facts the block above may not carry on its own:

- **The Windows version** - press **Windows key + R**, type `winver`, press **Enter**. The window that opens says the edition and the version, for example _Microsoft Windows 11 Pro, version 23H2_.
- **Was the editor running** - was VS Code or VSCodium open on this screen when the problem happened? The bridge only listens while an editor is open, so this changes what the **the bridge** row means.

## 7. Anything else

- Did it happen every time, or only once?
- Does it happen on another machine too?
- A screenshot is worth a thousand words - but check it for the token first.

That is all. There is nothing else you need to find out.
