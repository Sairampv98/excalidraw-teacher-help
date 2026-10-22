# The owner's review of 2026-10-22 — seven items, what each turned out to be, and which wave answers it

This is the on-disk record of the owner's own words and of what each item turned out
to be when it was measured in the running app. It is the companion to `SPEC.md`:
`SPEC.md` says what we **decided**, this says **what was asked**.

The review was made against `main` at `f5d2633` (wave 5j merged), in the owner's own
app on `http://localhost:3001/`.

---

## The review, as written

> **1.** i need to click live editor (why is it not on by default) to check the output. dont u see the presenter doesnot show the editor view. i am not sure how to test ocr or select the ocr models because i dont see a easy to use ocr option to use it (here is where i mentioned this option should only come up after we click the screen shot option similiar to the move and close option, and maybe use the same theme for all the things u develop)
>
> **2.** as u can see the vscode is visible in the normal editor but not visible on the presenter
>
> **3.** as u can see the video is not there in the presenter view.
>
> **4.** as u can see the 600+ mb video that i selected to be inserted into the canvas doesnt actually allow to play the video.
>
> **5.** why is the video not having the same option same as the draggable gif and image onto canvas. (just put a loading screen for when it is being loaded into the canvas with a wireframe of where the player will be.
>
> **6.** after taking a screenshot of either vscode or video player's current frame (for video that should pause the video). this should trigger 3 options place in current page - ocr the screenshot - maybe we can add this to regular images aswell i suppose, place the image on a new page (one question if i cut a image from one page and move to another page can i paste it there?) a wire frame of where to place the image similiar to the draggablity of gif and images from the sidebar.
>
> **7.** there is a extra options panel and i dont undertand y there are unclickable buttons

A second, earlier message in the same session asked how to insert YouTube videos, how to
move the video and the VS Code windows, whether those windows can be deleted, what could be
done about the "atrocious ui" of the two, what the screenshot feature would be, and why the
audio stays on when the volume slider is all the way down.

---

## Item by item: what was asked, what it actually was, and where it is answered

| # | The owner's item | What it turned out to be, measured | Answered by | The rows |
| --- | --- | --- | --- | --- |
| 1 | the live window is not on by default | `DEFAULT_CODE_PANEL_VIEW` is `"editor"` — wave 5h made the mirrored editor the default at the owner's request, and the owner has now said the opposite. The panels that exist carry `view: "editor"` because that *was* the default, not because the teacher chose it. | **5m** | `D-99`, `AC-137` |
| 1b | the presenter does not show the editor view | the live view's descriptor lives in the library's **in-memory registry** (`panelFrames.ts`, `setPanelCapture`) in the editor's JavaScript context; the presenter window is a **second context** with an empty registry. Reproduced live: the presenter window contains the code panel and **no `<img>` at all**. | **5m** | `D-100`, `AC-138` |
| 1c | no easy OCR option; it should only appear after the screenshot option | there was no screenshot option, so there was no place for it to appear. The OCR that exists (the picture's OCR) stays; the screenshot's OCR **is** that path. | **5n** | `D-102`, `D-104`, `AC-140`, `AC-142` |
| 1d | one theme for everything developed | the panel chrome had no theme of its own: it was sized in canvas units, so it was scaled down with the canvas. | **5k** (chrome) + **5n** (the rest) | `D-92`, `D-102` |
| 2 | VS Code is visible in the editor but not in the presenter | same cause as 1b — the descriptor never leaves the editor's context. | **5m** | `D-100`, `AC-138` |
| 3 | the video is not in the presenter | the presenter refuses any file over **32 MB** (`presenterChannel.ts:174`), and the video was never stored in the first place. | **5l** | `D-96`, `AC-134` |
| 4 | the 600+ MB video does not play | **two** independent causes. (a) The insert reads the whole file into a base64 string (`getDataURL`) and then reads it **again** for a SHA-1 (`generateIdFromFile`) — about 2.5 GB of allocation, so the insert dies and leaves an empty panel. (b) **Matroska is not a container Chrome decodes**: even with the bytes, `<video src="....mkv">` cannot play. | **5l** | `D-94`, `D-97`, `AC-133`, `AC-135` |
| 5 | the video has no drag path like the GIF and the image | `FilesTab.tsx:609` is `draggable={image}` — an image drags, a video does not. | **5l** | `D-98`, `AC-136` |
| 6 | a screenshot of VS Code or of the video's paused frame, with three choices and a wireframe | no such feature exists. The nearest things are the video's poster and the picture's OCR. | **5n** | `D-101`, `D-102`, `D-103`, `D-104`, `AC-139`–`AC-142` |
| 6b | *can an image cut on one page be pasted on another?* | **yes** — a paste is stamped with the **current** page (`App.tsx:4786-4788`), so a picture cut on page 1 and pasted while page 2 is active lands on page 2. That line is itself the fix of an earlier wave: pasted content used to land on the first page and be invisible. | answered now; the same machinery serves "place on a new page" | `D-103` |
| 7 | an extra options panel with unclickable buttons | the "extra options panel" is the **panel's own chrome** (the header with the view toggle, the video's control strip). It was sized in canvas units: measured in the owner's app at 51% zoom, the header was **11.2 px** tall and the control button's font **5.1 px** — the "about 5". The buttons were not broken; they were **a fifth of a pixel tall**. | **5k** | `D-92`, `D-93`, `AC-128`–`AC-132` |

### The earlier message, answered

| Asked | Answered |
| --- | --- |
| how to insert a YouTube video | **not implemented.** The protocol messages exist (`excalidraw-app/bridge/videoCaptions.ts`), but nothing sends them; only the local sidecar path exists. |
| how to move the video and the VS Code windows | panels move by **drag** or with the **arrow keys** (`App.tsx:6322-6332`). The OS window itself is only **captured**, never moved. |
| can those windows be deleted | yes — a panel is an ordinary element; **Delete** removes it. The underlying file stays in the Files list. |
| the "atrocious ui" of the two | the chrome was fixed-pixel while the panel was zoom-scaled. Fixed in wave 5k and measured. |
| what about the screenshot feature | did not exist; it is wave 5n. |
| the audio stays on when the volume slider is all the way down | the volume and mute logic was never wrong — there was **no test** for either, and the control was about **5 px** tall, so the slider could not be used. Wave 5k added the test, a 72×20 px slider, a 24×24 px button, and a **visible** muted state. |

### The questions the review also answered about the models

The owner could not see how to choose an OCR engine. The engine is a **setting**:
`excalidraw-bridge.ocrEngine` is `tesseract`, `indra` or `paddle`, and
`excalidraw-bridge.pythonPath` names the Python the Python engines use.

Measured on this machine, on the same full VS Code frame:

| engine | median read | note |
| --- | --- | --- |
| `indra` | **147 ms** full / 74 ms crop | fastest here |
| `tesseract` | **278 ms** full / 120 ms crop | in-process, inside the `.vsix` |
| `paddle` | **27,822 ms** | **crashes** on this box without a fall-back; see wave 5o |

`paddle` is the slowest by a wide margin here, not the fastest: PaddlePaddle 3.3.1 hits a
oneDNN/PIR bug on Windows (`ConvertPirAttribute2RuntimeAttribute not support`), and the only
working configuration — `enable_mkldnn=False` — is the slow path. That is a fact to report
(D-91), and wave 5o makes the engine work and says so.

---

## Where each wave's design lives

| wave | what it answers | the design document |
| --- | --- | --- |
| 5l | items 3, 4, 5 — the video at any size | `tasks/wave5l-big-video.md` (in the repo once the task starts) |
| 5m | items 1, 1b, 2 — the live window by default, and the presenter | `docs/tins-tasks/wave5m-live-default-brief.md` |
| 5n | items 1c, 1d, 6 — the screenshot, the three choices, the theme | `docs/tins-tasks/wave5n-screenshot-brief.md` |
| 5o | PaddleOCR's crash, and the truth about its speed | `docs/tins-tasks/wave5o-paddle-fallback-brief.md` |
