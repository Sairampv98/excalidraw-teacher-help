---
id: wave3-page-layout
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: SPEC.md,packages/excalidraw/scene/pages.ts,excalidraw-app/components/PageBar.tsx,AGENTS.md,HANDOVER.md
base: main
status: merged
---

CRITICAL FIX: deleting a page in the middle of a document strands the content of
every page after it, and inserting a page does not move the later pages content.

REPORTED BY THE USER on 2026-10-21, live, on a 22-page document:
  When
