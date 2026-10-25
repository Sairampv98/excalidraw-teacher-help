# The owner's review of 2026-10-24 — eight items, two decisions, one programme

Everything below is the **owner's own words** from 2026-10-24, with the diagnosis and the wave that answers it. The numbers are measurements, not opinions.

## The item → wave map

| # | what the owner said | the diagnosis | wave |
| --- | --- | --- | --- |
| 1 | _"the screenshot button is inside the panel and i cant click it and the read text button doesnot do anything sadly for now - (even if it takes does ocr where does it send the ocr'd text? i cant use it if it does not provide me a way to paste it into the canvas same with screenshot/camera-icon if i can. u can see the extra options with the panel, kind, video, state, live things i think all the panels have this y not use this for the ocr, crop and other options instead of whatever these buttons that dont click do"_ | The camera and the OCR button are drawn **inside the panel overlay**. On a YouTube panel the overlay's iframe is a **foreign document**: the click never reaches the button. The OCR button also has **no target** - the read lands nowhere the teacher can use. The **properties panel** (`packages/excalidraw/actions/actionProperties.tsx` - the "Panel / Kind / State / Live" fieldset) is ordinary DOM beside the canvas, so its buttons always work. | **6a** |
| 2 | _"the screenshot works but as u can see i only see 1 out of the 3 options, maybe we should combine the cropping and the ocr together, default uses tessaract, with vscode/vscodium bridge it can use indra and if nothing works they can use paddle put in a loading animation so they know when to expexct the text to be come visible again."_ | The three choices are three **separate** flows and only one is reachable from where the teacher is. The engines are picked by the **extension's setting**, not by what is actually available on the machine. There is **no loading state**: a slow read looks like a dead button. | **6b** |
| 3 | *"the screenshot is correctly poping up but the panels are also in the same z plane ... we should get that option after selecting the 1st option (*crop image)->insert image in this page -> (*crop image)-> select where the screenshot goes to (and the popup vanishes and we return back to the canvas instead of how it is now), ocr/read the text and wher the text goes i.e; 2nd option (*crop image)->read text in this cropped region->select where the extracted text goes to and finally 3rd option (*crop image)->insert image in another page-> select the page (through the page selecter ribbon-> (*crop image)-> select where the screenshot goes to"\* | The order is wrong: the **crop** must come before the target is chosen, the "place here" wireframe must not compete with the panels in the same z-plane, and the popup must **close** and hand the canvas back. The third flow must go through the **page selector ribbon** first. | **6c** |
| 4 | _"cropping of images doesnot seem to work i can see the handles to crop the image but not do anything to it"_ | The crop handles are drawn, but the drag that should change the crop does not change it. | **6c** |
| 5 | _"somehow the presenter view is dead this is what the failure is about"_ | The presenter view is broken (the owner's screenshot is the failure). | **6d** |
| 6 | _"the live editor is weird i can see the text from the connection to vscode/vscodium scroll through that text, cannot select that text and paste it as a codeblock (same as when i select copy code or use the insert as code block in the markdown viewer), nor select the programming language of my choice, zoom in/ zoom out both the page and inside the editor (requires more scrolling is all)"_ | The mirrored text is **read-only**: it cannot be selected, copied or pasted as a code block. The **language picker** is not reachable from the editor. There is **no zoom inside** the editor, so a long file is unusable. | **6e** |
| 7 | _"i cannot take a screen shot from the live window button does nothing and the visibility is not there, why is the bridge visible over both the vscode editor and live window even after connecting? (y not move it to the extra options that read panel, kind, code, state, and live?)"_ | The live window's camera button is inside the overlay again, and the **bridge box floats over the picture** - over the VS Code editor and over the live window - even after the connection is made. | **6a** |
| 8 | _"why is the vscode/vscodium what i want section from the vscode that i want to mirror to the canvas option not available? i.e; it should show me the full vscode window (same as when i take a screenshot - only when i click change what is mirrored button or something) and i crop the section i want mirrored (i should be able to edit it as many times as possible, and maybe it can even have a follow the cursor option that dynamically moves the mirrored section based on the position of the mouse that is being moved inside the panel)"_ | The mirrored **region** cannot be chosen: the panel mirrors the **whole** window, and there is no "change what is mirrored" control, no repeatable crop, and no follow-the-cursor. | **6f** |

## The two decisions the owner made

| decision | the owner's answer | wave |
| --- | --- | --- |
| the pages | _"pages visible frame can be toggled on/off with a page number etc (the same options one gets in the microsoft word, header/fotter -> page number thingy), ok include presets for width and height. (this should help the export page as now the format in which the text appears would be different based on the preset selected)"_ | **6g** |
| the virtual display + input panel | _"yes work on the virtual display+input panel"_ | **6h** |

## The order, and why

**6a → 6b → 6c** first: the teacher's complaint is _"the buttons don't work and I don't know where the result goes"_. Until the actions live in the properties panel (6a), the engine ladder and the loading animation have nowhere to live (6b), and the placement flow has nothing to place (6c).

**6d** (the presenter) next: it is broken, and it is how the owner teaches.

**6e** (the live editor) and **6f** (what to mirror) are the same feature seen from two sides - the editor you read and the window you mirror - so they follow each other.

**6g** (the pages) and **6h** (the virtual display) are the two decisions the owner just made; they are self-contained and land last.

## The waves

| wave | what it answers | paths |
| --- | --- | --- |
| 6a | the panel's actions live in the **properties panel**, not inside the picture; the bridge box stops floating over the picture | `packages/excalidraw,excalidraw-app` |
| 6b | one crop-and-read flow; the engine ladder: **indra** with the bridge, **tesseract** without it, **paddle** last; a loading animation | `packages/excalidraw,excalidraw-app` |
| 6c | the crop really crops; the three placement flows, in the order the owner wrote them, and the popup hands the canvas back | `packages/excalidraw,excalidraw-app` |
| 6d | the presenter view works | `excalidraw-app` |
| 6e | the live editor: select the text, copy it as a code block, choose the language, zoom inside | `packages/excalidraw,excalidraw-app` |
| 6f | "what to mirror": the whole VS Code window, a region the teacher crops and re-crops, and follow the cursor | `packages/excalidraw,excalidraw-app,packages/vscode-bridge` |
| 6g | the pages: a visible frame, a page number, width/height presets | `packages/excalidraw,excalidraw-app` |
| 6h | the virtual display + the input panel | `packages/vscode-bridge,excalidraw-app` |
| 6i | the virtual display, reported the way a teacher needs it: the **click that attaches it**, an **opt-in** window move, and a **bring it back** | `packages/vscode-bridge,excalidraw-app` |

## Where each wave landed

Every wave below is **merged into `main`**, and every one passed the gate **4/4** with `node scripts/rowcheck.mjs --all` at **0**. The numbers are measurements taken on this machine.

| wave | merged | what it now does | the measurement that proves it |
| --- | --- | --- | --- |
| 6a | yes | the panel's **actions** live in the properties panel - camera, _Read the text_ with its engine picker, and the bridge box. The picture carries none of them. | live: the properties panel showed **Actions → Read the text → indra** and the bridge box; the panel chrome showed **no** camera, OCR or bridge control. `D-135`, `D-136`; `D-115` superseded. |
| 6b | yes | **one** crop-and-read action. The ladder tries **indra with the bridge**, then **tesseract** without it, then **paddle** last - and says which rung it used and why. A loading state with a cancel. | tesseract **262 ms** / **519 ms**; paddle **17,083 ms** warm, **45,235 ms** cold; **indra not installed** on this box. A real browser read landed **per-line** text on the canvas. |
| 6c | yes | the crop **crops**, and the three placement flows are in the owner's order. | **Cause found:** the focus popup sat at `--zIndex-panelFocus: 2` - under the interactive canvas, which took the pointer, and under the panels (3). The handles were visible and dead. Now **z-index 9**. Crop width **1 → 0.792**; the placed picture is **635.1 × 601.4** scene units against the uncropped **800 × 600**; flow 2 reads _"The text goes here"_; flow 3 goes **through the page ribbon**. |
| 6d | yes | the presenter view works. | **Two causes:** `yarn build` was failing outright - the service worker's **2.3 MB** precache limit against a **2.56 MB** bundle - and the presenter's fullscreen control called `requestFullscreen()` unguarded. Both fixed. |
| 6e | yes | the live editor is a **real editor**: the text can be selected and copied as a **code block** (the same card the markdown viewer's _Copy code_ makes), the language can be chosen, and the editor zooms inside itself. | merged on a tree that also carries the markdown-clipboard wait fix (`0ccebd1`), so the gate is green on the merged result, not only on the branch. |
| 6g | yes | a page has a **frame** (togglable), a **number**, and a **size** from presets - A4 and Letter portrait and landscape, 16:9, 4:3, 1920×1080 - and the export honours it. | A4 portrait → page **1920 × 2716**, exported raster **1920 × 2716 px** (PDF MediaBox **1440 × 2037 pt**). 16:9 → **1920 × 1080 px** (**1440 × 810 pt**). |
| 6h | yes | the virtual display + the input panel. | five measurements: **no virtual display on this box** (DISPLAY1 1920×1080 only) → the feature says so plainly and falls back; a window on another display's rectangle is still **found** by the capture (`HEADER 642 350`, a **6,447-byte** JPEG); the teacher's keystrokes are **not stolen** (the window received exactly the typed text, the panel sent **0** commands); **latency 24–28 ms**; the desktop is untouched, and a bad capability → **404**. The page carries **no token**. |
| 6i | yes | the virtual display is reported the way a teacher needs it: an installed-but-**detached** driver is **named** together with the click that attaches it (VDD Control → Extend); moving the editor's window is **opt-in, never by default**; a window on the virtual display can be **brought back** with its maximised state restored; every placement reports the **measured** rect. | **A silent failure found:** `SetWindowPos` on a **maximised** window returns `true` and does **nothing** (`1295x703 at 1273,-7` → unchanged). After `SW_RESTORE` (9) it lands at `1920x1080 at 1920,0`. The round trip back: `SW_RESTORE` → `SetWindowPos(0,0,1295,687)` → `SW_MAXIMIZE` (3) → `1295x687 at -7,-7`, the exact original rect. `D-146`..`D-150`, `AC-183`. |
| 6f | yes | _"what to mirror"_: the **whole** VS Code window by default, a region the teacher crops and **re-crops**, and an optional **follow-the-cursor** mode. | **Merged** (`8246b20`). Gate **4/4**, `rowcheck --all` exit 0, **60 tests pass**. The panel's bar now carries **"Change what is mirrored"** and **"Follow the cursor"**; the region travels to the editor in the capture descriptor and comes back; the window is still found **by rule**. The five-step browser proof ran with screenshots. **The teeth check:** with the fix reverted, **5** of the AC-182 tests FAIL (3 in `packages/vscode-bridge/tests/bridge.test.ts`, 2 in `packages/excalidraw/tests/codePanel.test.tsx`); with it restored, all 60 pass. |

### What the live clips found

Recording the feature clips - by driving the **real** app with a **real** editor behind it - found five defects the tests had not. Two of them meant a **shipped install did not work at all**.

| # | the defect | the fix |
| --- | --- | --- |
| 1 | the `.vsix` did not ship `media/virtual-display.ps1` - so **every** install had a **dead virtual display** | `build-vsix.mjs` copies the helper into the stage **and** adds it to the `entries` list that becomes the `.vsix` |
| 2 | the snapshot endpoint sent **no `Access-Control-Allow-Origin`** - the page is on `localhost:3001` and the extension on `127.0.0.1:47511`, so a **stock browser refused the app's fetch**: "take a screenshot of the editor's window" and "crop and read" from the editor died with _"Failed to fetch"_ | the snapshot now answers the **same** loopback origins `isAllowedOrigin` already accepts, echoing the origin back, plus `Access-Control-Expose-Headers` for the frame's size (not CORS-safelisted, so the app read size 0) |
| 3 | the mirror picker's choice buttons sat at **z-index 8** and the app's page bar covered them at **70** - the picker could not be worked with the mouse | a new `--zIndex-panelPicker: 90` |
| 4 | the YouTube caption note was painted **under** the composited iframe, and its background (`var(--color-surface)`) was **not a theme variable** | a z-index above the iframe, and `var(--color-surface-high)` |
| 5 | the input panel did `var status = document.getElementById("status")` - which collides with **`window.status`**, a string the browser owns - so the status line never showed anything | renamed to `statusLine` |

Wave **6j** (`D-151`, **AC-184**, **AC-185**): gate **4/4**, `rowcheck --all` exit **0**. The teeth check: with the fix reverted, the AC-184 and AC-185 tests **FAIL**; with it restored they pass. The real proof: the built `.vsix`'s own **entry list** now carries `extension/media/virtual-display.ps1`, an install into a throwaway folder really has it, and in a **stock browser** the snapshot arrives - _"OK: the picture arrived - 14142 bytes, content-type image/jpeg, the frame's own size 640x360"_ - where the unfixed code gave the browser's own _"Failed to fetch"_.

The order is **indra with the bridge → tesseract without it → paddle last**, and each rung names the reason it was tried. `D-137` is the authority.

### What the teacher still has to do

1. **Reload the VS Code window**, then click the **status-bar item → "Copy token"** and paste it into the app's bridge box. **Once per tab.** The token is per-session and is never in a URL, never in the document and never in a payload.
2. Set the virtual display's **HardwareCursor back to true** if the pointer should appear in the projector capture. It affects only a **display capture** of the virtual monitor - the extension's own window capture (`PrintWindow` + `PW_RENDERFULLCONTENT`) never contained the pointer.
3. Close the **3 elevated VDD Control** windows left open by the CLI attempts. They run elevated, so they could not be closed without a prompt.
