---
id: wave2b-single-scaling-axis
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: SPEC.md,excalidraw-app/components/PageBar.tsx,packages/excalidraw/scene/pages.ts,AGENTS.md,HANDOVER.md
base: main
status: open
---

Remove the Grow this page / Shrink this page controls. Scaling the content down
is the only way to get more room on a page.

DECISION (the user, 2026-10-21, after live testing on a 38-page document):
  The four page buttons are: Grow this page, Shrink this page, Scale this
  page content up, Scale this page content down. The first two did the same
  job as the last two, with the side effect that growing a page pushes the
  LATER pages sideways, because the layout is positional and the later pages
  rects move. The user described the fix themselves: just
