---
id: wave4d-presenter-mirror
paths: packages/excalidraw,excalidraw-app,SPEC.md,docs/superpowers/specs
read: SPEC.md,packages/excalidraw/scene/pages.ts,excalidraw-app/tests/presenterCamera.test.ts,excalidraw-app/presenter/presenterChannel.ts,docs/superpowers/specs/2026-10-21-presenter-mirror-design.md,docs/tins-tasks/wave4d-presenter-mirror-brief.md,AGENTS.md,HANDOVER.md
base: main
status: open
---

Wave 4d - the presenter must mirror a page that is bigger than the window. This is the owners report that the presenter does not mirror what they see, and it is legacy-specific. The cause is measured, not guessed: getPageRelativeCamera in packages/excalidraw/scene/pages.ts clamps the page-relative offset to 0..1, and a page bigger than the window makes the camera clamp CENTRE the page, which makes the offset NEGATIVE. The clamp throws that negative value away, so the presenter rebuilds a camera anchored to the page corner instead of the editors centred one - a measured 4478 scene units of drift on the owners own board. The fix: the offset becomes a signed ratio, bounded above at 1 and not bounded below. The second defect: excalidraw-app/tests/presenterCamera.test.ts re-derives the page rect with the old fixed-pitch layout instead of using the librarys getCurrentPageRect, and that is what would have hidden this bug. The design is docs/superpowers/specs/2026-10-21-presenter-mirror-design.md and the build sheet is docs/tins-tasks/wave4d-presenter-mirror-brief.md - read both before writing code. Add the locked rows D-27, D-28 and D-29 to SPEC.md together with the acceptance rows AC-32, AC-33 and AC-34.
