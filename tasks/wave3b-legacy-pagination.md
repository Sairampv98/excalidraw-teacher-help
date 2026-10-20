---
id: wave3b-legacy-pagination
paths: packages/excalidraw,SPEC.md,vitest.config.mts
read: SPEC.md,packages/excalidraw/scene/pages.ts,packages/excalidraw/data/blob.ts,AGENTS.md,HANDOVER.md
base: main
status: open
---

Library half of the legacy-file split: turn a vanilla file whose content sprawls
across many pages into a document whose content is tiled across pages.

BACKGROUND - REPORTED BY THE USER on 2026-10-21 with a real file:
  Their board (C:\Users\user\projects\day-1.excalidraw) is a VANILLA
  excalidraw file: 2,507 elements, 97,228 points, 10.9 MB, and its content
  spans x -6648..3595, y 74..14285 - about 5.3 x 13.2 pages of area, with a
  1920x1080 page. No element has a pageId, so on import every element is
  stamped page-1.
  Two symptoms, one cause:
    1. it is slow to open, and
    2. navigating it is hard - most of the board is OUTSIDE the page rect the
       camera is clamped to, so it cannot be reached.
  Tiling the content across pages fixes both: each page then holds only its
  own elements, so the renderer draws ~88 elements per frame instead of 2,438,
  and the camera clamp covers the content page by page.

  THE USER CHOSE THE TILED OPTION (over keeping one big page).

THIS TASK IS THE LIBRARY PRIMITIVE ONLY. The app-level offer (split
