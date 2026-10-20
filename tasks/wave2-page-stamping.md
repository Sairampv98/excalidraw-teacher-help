---
id: wave2-page-stamping
paths: packages/excalidraw,excalidraw-app,packages/common,packages/element,packages/utils,SPEC.md
read: SPEC.md,docs/superpowers/specs/2026-10-20-image-page-stamping-design.md,docs/tins-tasks/wave1-page-model-brief.md,AGENTS.md,HANDOVER.md
base: main
status: merged
---

Fix item 2: content inserted on a page other than page 1 is invisible.

SYMPTOM, observed live by the user on 2026-10-20:
- Copying content and pasting it while on page 2+ does not show up there.
- Inserting an image, a GIF, or a code block from the sidebar while on page 2+
  does not show up there.
- The content IS in the document: the export dialog renders it, because the
  exporter draws the whole scene rather than the current page.
- The canvas shows nothing, because the renderer filters
  element.pageId === currentPageId.

ROOT CAUSE (already established - do not re-derive, but do verify each claim
against the code before you change it):
- The paste path, App.tsx around the addElementsFromPasteOrLibrary function
  (near line 4099), calls restoreElements, which stamps
  pageId ?? DEFAULT_PAGE_ID - that is, page-1 - on every element.
  duplicateElements preserves that stamp, and Scene.replaceAllElements does
  not stamp it. So a paste on page 2 lands on page 1.
- The app's sidebar insert path, excalidraw-app/sidebar/insertIntoScene.ts
  (around line 266), calls newImageElement with no pageId at all, so it also
  defaults to page-1. This path covers the sidebar click, the
  click-then-paste-on-canvas flow, and the drag-and-drop flow.
- The only places that DO stamp pageId are App.tsx near lines 6619, 7136 and
  9839 - the draw path.
- The pageId is on the element, and the renderer filters on it. See
  packages/excalidraw/scene/Renderer.ts around lines 185-187.

THE RULE TO IMPLEMENT:
An element inserted into the live scene belongs to the page the user is
acting on. The only exception is RESTORING A FILE, which resolves from the
file, and is already handled by the Wave 1 work - do not change restore
behaviour in this task.

READ FIRST:
1. SPEC.md - the locked decisions. Do not change D-7 (restore isolation).
2. docs/superpowers/specs/2026-10-20-image-page-stamping-design.md - the full
   design for this fix, including the options that were rejected and why.
3. packages/excalidraw/tests/pages.test.tsx - the existing page tests, and the
   assertion style this project uses.
4. AGENTS.md and HANDOVER.md - the project rules.

SCOPE: packages/excalidraw, excalidraw-app, packages/common, packages/element,
packages/utils, SPEC.md.

ACCEPTANCE ROWS TO ADD:
Add two new acceptance rows to SPEC.md, in the existing row format
(| AC-n | <label> | <check-file> | <detail> |), each naming its check file
and mentioning its own id:
- AC-10, check file packages/excalidraw/tests/pages.test.tsx: pasting while
  on page 2 puts the pasted element on page 2, not page 1.
- AC-11, check file excalidraw-app/tests/pageBar.test.tsx: inserting an image
  through the app's sidebar insert path while on page 2 puts the element on
  page 2, not page 1.
Append the tests to those two existing files. Every test must mention its row
id in the test name, or the kit's SPEC lint will fail the gate.

REQUIRED:
- One authoritative helper that stamps the current page onto elements, used
  by every insertion path. Do not fix one call site and leave the others.
- The paste path, the sidebar insert path, and the draw path must all agree.
- The helper must use the CURRENT page id, not a constant.
- Do not change how restore resolves a page.
- Do not add a dependency.

TESTING DISCIPLINE (the project rule):
- Oracle-based assertions: assert through the library's own conversion
  functions, never by re-deriving a formula in the test.
- Teeth: for each fix, revert it and confirm the corresponding test FAILS,
  then restore it. Report which teeth checks you performed.
- A test that cannot fail protects nothing.

FEEDBACK:
  node scripts/rowcheck.mjs --all      (fast: only the files the rows name)
  node scripts/rowcheck.mjs AC-10
  node scripts/tins-gate.mjs           (slow: the full four-gate suite)
Never run `yarn test:app` without `--watch=false` - it is bare vitest and
enters watch mode and never exits. Run the full suite before you report.

RULES:
- Commit your work. The harness records the session from git.
- Do NOT run `kit gate`, `kit close` or `kit merge`. The harness closes the
  session; closing it yourself ends the session before your work is in it.
- When you change behaviour, change the matching SPEC.md row too.
- If a decision in SPEC.md is wrong or unimplementable, say so in your report
  rather than working around it.

REPORT (max 300 words):
- AC-10 and AC-11: green or not, with the test names.
- The final `rowcheck --all` output.
- The teeth checks you performed and what happened when you reverted.
- Any insertion path you found that the fix did NOT cover.
- Anything in SPEC.md that was unclear.
