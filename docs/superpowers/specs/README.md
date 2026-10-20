# Excalidraw fork — design specs

**Prepared:** 2026-10-20, on the `feature/problem-wave-1` branch **Covers:** all eleven items raised by the user

---

## Read in this order

| # | Spec | Item | Wave | Size |
| --- | --- | --- | --- | --- |
| 1 | [Page & Document Model](./2026-10-20-page-document-model-design.md) | 1, 4, 5, 8 | **1** | large |
| 2 | [Image & GIF Page Stamping](./2026-10-20-image-page-stamping-design.md) | 2 | 2 | small |
| 3 | [Draw Performance](./2026-10-20-draw-performance-design.md) | 3 | 2 | medium |
| 4 | [Canvas Panel Foundation](./2026-10-20-canvas-panel-foundation-design.md) | shared by 6, 7, 10, 11 | **3** | large |
| 5 | [VS Code Mirror Panel](./2026-10-20-vscode-bridge-design.md) | 6 | 3 | large |
| 6 | [Video Panel](./2026-10-20-video-panel-design.md) | 7 | 3 | large |
| 7 | [Presenter Panels](./2026-10-20-presenter-panels-design.md) | 10 | 3 | medium |
| 8 | [Sidebar Unification](./2026-10-20-sidebar-unification-design.md) | 9 | 4 | medium |
| 9 | [Animated Flowcharts](./2026-10-20-animated-flowcharts-design.md) | 11 | 4 | medium |

Spec 4 is the keystone: items 6, 7, 10 and 11 are all the same request in different clothes, and this document specifies the machinery they share **once** — a canvas-resident, resizable panel with a lock-to-screenshot, crop and OCR pipeline.

## The wave plan

```
Wave 1   Page & document model          1, 4, 5, 8      [spec 1]
Wave 2   Bugs                           2, 3           [specs 2, 3]
Wave 3   Canvas panels                  6, 7, 10       [specs 4, 5, 6, 7]
Wave 4   UI + animation                 9, 11          [specs 8, 9]
```

Wave 1 first because items 1, 4, 5 and 8 all trace back to one missing concept — a page that has a size. Wave 3 comes before Wave 4 because the sidebar surfaces the video and code entries, and the flowchart feature needs the same panel primitive.

## What each item actually turned out to be

Every item was diagnosed against the code before any of it was designed. Three of them were not what they looked like:

| Item | Looked like | Actually is |
| --- | --- | --- |
| 1 — vanilla files won't open | a file-format incompatibility | **two** bugs: the restore inherits the _local_ app's page list while stamping elements page 1 (so the file renders blank on page 2+), and the camera hard-clamps to the page rect so content outside it is unreachable. Forward compatibility already works — a file saved by this fork opens in vanilla upstream |
| 2 — images broken on page 2 | a camera or overlay bug | the camera hypothesis is **refuted**; the real cause is that the paste path and the sidebar insert path never stamp `pageId`, so elements land on page 1 |
| 3 — pen curves degrade | text elements being slow | text is **not** the cause (the static canvas does not repaint mid-stroke). The cause is `throttleRAF` discarding intermediate pointer samples, compounded by an O(n^2) bounding-box computation and three per-frame O(elements) scans |

## Decisions already taken

| Decision | Choice | Rationale |
| --- | --- | --- |
| Wave order | 1 -> 2 -> 3 -> 4 | agreed |
| Storage | IndexedDB primary, localStorage fallback, document split per page | kills the ~15-page loss (a quota + write-ordering bug, not a page cap) |
| Lazy hydration | **defer**; build the per-page store now, measure, switch only if a document needs it | the decision thresholds are in spec 1 §9 |
| Editor source | **hybrid**: VS Code extension bridge when connected, in-browser compiler when not | agreed |
| Page scaling | two separate buttons: _grow page_ and _scale content_ | agreed |
| Imported content | grow the page to contain it, **and** allow explicitly un-anchored ("floating") content | agreed |
| Per-page size | 1920x1080 is the **minimum**; pages may grow | agreed |

## Verified baseline

Measured in the worktree before any change: `typecheck` 0, `eslint` 0, `prettier` 0, `vitest` 0 — **120 files, 1606 passed, 48 skipped, 1 todo, 0 failed**.

One caveat, recorded in spec 1 §15: `MermaidToExcalidraw.test.tsx` and `scene/export.test.ts` fail intermittently under parallel load and pass in isolation. They are known flakes; re-run in isolation before believing a red suite.

## Two facts worth knowing before reading the specs

- **The PDF viewer's text selection is not OCR.** The sidebar preview is the browser's native viewer showing that PDF's own text layer. There is no OCR in the app today. But this app's _exported_ PDFs are pure raster, so they have no selectable text at all.
- **YouTube captions cannot be fetched from a browser.** The official API requires video ownership; the internal endpoint needs a PO token that only the player's own JavaScript can mint, and datacenter IPs are blocked outright. `yt-dlp` works. So captions are fetched by the **local bridge** — which is already being built for the editor.

## Scope discipline

Each spec carries its own non-goals. Two things deliberately stay out:

- **The `bun` migration.** Spec 3 §6 answers it: it would speed up `install` but **not** `vite dev`, because the tax the user felt is `vite-plugin-checker` (tsc + ESLint workers on every change), which is a Vite plugin cost. The fix is in spec 3 §5.4 and needs no migration.
- **Time-based export.** There is no animated GIF or video export today (`ExportType` is `png | clipboard | clipboard-svg | backend | svg`). Spec 9 §5.5 covers exporting a flow statically and as a single still, and leaves animated export as a later, explicit decision.
