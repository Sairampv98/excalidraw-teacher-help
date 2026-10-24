# The owner's review of 2026-10-24 — eight items, two decisions, one programme

Everything below is the **owner's own words** from 2026-10-24, with the diagnosis and the wave
that answers it. The numbers are measurements, not opinions.

## The item → wave map

| # | what the owner said | the diagnosis | wave |
| --- | --- | --- | --- |
| 1 | *"the screenshot button is inside the panel and i cant click it and the read text button doesnot do anything sadly for now - (even if it takes does ocr where does it send the ocr'd text? i cant use it if it does not provide me a way to paste it into the canvas same with screenshot/camera-icon if i can. u can see the extra options with the panel, kind, video, state, live things i think all the panels have this y not use this for the ocr, crop and other options instead of whatever these buttons that dont click do"* | The camera and the OCR button are drawn **inside the panel overlay**. On a YouTube panel the overlay's iframe is a **foreign document**: the click never reaches the button. The OCR button also has **no target** - the read lands nowhere the teacher can use. The **properties panel** (`packages/excalidraw/actions/actionProperties.tsx` - the "Panel / Kind / State / Live" fieldset) is ordinary DOM beside the canvas, so its buttons always work. | **6a** |
| 2 | *"the screenshot works but as u can see i only see 1 out of the 3 options, maybe we should combine the cropping and the ocr together, default uses tessaract, with vscode/vscodium bridge it can use indra and if nothing works they can use paddle put in a loading animation so they know when to expexct the text to be come visible again."* | The three choices are three **separate** flows and only one is reachable from where the teacher is. The engines are picked by the **extension's setting**, not by what is actually available on the machine. There is **no loading state**: a slow read looks like a dead button. | **6b** |
| 3 | *"the screenshot is correctly poping up but the panels are also in the same z plane ... we should get that option after selecting the 1st option (*crop image)->insert image in this page -> (*crop image)-> select where the screenshot goes to (and the popup vanishes and we return back to the canvas instead of how it is now), ocr/read the text and wher the text goes i.e; 2nd option (*crop image)->read text in this cropped region->select where the extracted text goes to and finally 3rd option (*crop image)->insert image in another page-> select the page (through the page selecter ribbon-> (*crop image)-> select where the screenshot goes to"* | The order is wrong: the **crop** must come before the target is chosen, the "place here" wireframe must not compete with the panels in the same z-plane, and the popup must **close** and hand the canvas back. The third flow must go through the **page selector ribbon** first. | **6c** |
| 4 | *"cropping of images doesnot seem to work i can see the handles to crop the image but not do anything to it"* | The crop handles are drawn, but the drag that should change the crop does not change it. | **6c** |
| 5 | *"somehow the presenter view is dead this is what the failure is about"* | The presenter view is broken (the owner's screenshot is the failure). | **6d** |
| 6 | *"the live editor is weird i can see the text from the connection to vscode/vscodium scroll through that text, cannot select that text and paste it as a codeblock (same as when i select copy code or use the insert as code block in the markdown viewer), nor select the programming language of my choice, zoom in/ zoom out both the page and inside the editor (requires more scrolling is all)"* | The mirrored text is **read-only**: it cannot be selected, copied or pasted as a code block. The **language picker** is not reachable from the editor. There is **no zoom inside** the editor, so a long file is unusable. | **6e** |
| 7 | *"i cannot take a screen shot from the live window button does nothing and the visibility is not there, why is the bridge visible over both the vscode editor and live window even after connecting? (y not move it to the extra options that read panel, kind, code, state, and live?)"* | The live window's camera button is inside the overlay again, and the **bridge box floats over the picture** - over the VS Code editor and over the live window - even after the connection is made. | **6a** |
| 8 | *"why is the vscode/vscodium what i want section from the vscode that i want to mirror to the canvas option not available? i.e; it should show me the full vscode window (same as when i take a screenshot - only when i click change what is mirrored button or something) and i crop the section i want mirrored (i should be able to edit it as many times as possible, and maybe it can even have a follow the cursor option that dynamically moves the mirrored section based on the position of the mouse that is being moved inside the panel)"* | The mirrored **region** cannot be chosen: the panel mirrors the **whole** window, and there is no "change what is mirrored" control, no repeatable crop, and no follow-the-cursor. | **6f** |

## The two decisions the owner made

| decision | the owner's answer | wave |
| --- | --- | --- |
| the pages | *"pages visible frame can be toggled on/off with a page number etc (the same options one gets in the microsoft word, header/fotter -> page number thingy), ok include presets for width and height. (this should help the export page as now the format in which the text appears would be different based on the preset selected)"* | **6g** |
| the virtual display + input panel | *"yes work on the virtual display+input panel"* | **6h** |

## The order, and why

**6a → 6b → 6c** first: the teacher's complaint is *"the buttons don't work and I don't know where
the result goes"*. Until the actions live in the properties panel (6a), the engine ladder and the
loading animation have nowhere to live (6b), and the placement flow has nothing to place (6c).

**6d** (the presenter) next: it is broken, and it is how the owner teaches.

**6e** (the live editor) and **6f** (what to mirror) are the same feature seen from two sides - the
editor you read and the window you mirror - so they follow each other.

**6g** (the pages) and **6h** (the virtual display) are the two decisions the owner just made;
they are self-contained and land last.

## The waves

| wave | what it answers | paths |
| --- | --- | --- |
| 6a | the panel's actions live in the **properties panel**, not inside the picture; the bridge box stops floating over the picture | `packages/excalidraw,excalidraw-app` |
| 6b | one crop-and-read flow; the engine ladder **tesseract → indra → paddle**; a loading animation | `packages/excalidraw,excalidraw-app` |
| 6c | the crop really crops; the three placement flows, in the order the owner wrote them, and the popup hands the canvas back | `packages/excalidraw,excalidraw-app` |
| 6d | the presenter view works | `excalidraw-app` |
| 6e | the live editor: select the text, copy it as a code block, choose the language, zoom inside | `packages/excalidraw,excalidraw-app` |
| 6f | "what to mirror": the whole VS Code window, a region the teacher crops and re-crops, and follow the cursor | `packages/excalidraw,excalidraw-app,packages/vscode-bridge` |
| 6g | the pages: a visible frame, a page number, width/height presets | `packages/excalidraw,excalidraw-app` |
| 6h | the virtual display + the input panel | `packages/vscode-bridge,excalidraw-app` |
