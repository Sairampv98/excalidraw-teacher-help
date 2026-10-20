---
id: wave3c-page-split-offer
paths: packages/excalidraw,SPEC.md,docs/superpowers/specs
read: SPEC.md,packages/excalidraw/scene/pages.ts,packages/excalidraw/data/blob.ts,packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState.ts,packages/excalidraw/components/Modal.tsx,packages/excalidraw/components/LayerUI.tsx,packages/excalidraw/tests/pages.test.tsx,docs/superpowers/specs/2026-10-21-page-split-offer-design.md,docs/tins-tasks/wave3c-page-split-offer-brief.md,AGENTS.md,HANDOVER.md
base: main
status: open
---

App wiring for the legacy page split: when a file that defines no pages is opened and its content does not fit on one page, offer the user the choice - split across pages (recommended), keep on one big page, or cancel. The tiling is computed once and reused for the import. The design is docs/superpowers/specs/2026-10-21-page-split-offer-design.md and the build sheet is docs/tins-tasks/wave3c-page-split-offer-brief.md - read both before writing code. Add the locked rows D-14, D-15 and D-16 to SPEC.md together with the acceptance rows AC-21 and AC-22.
