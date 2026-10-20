---
id: wave1-page-model
paths: packages/excalidraw,excalidraw-app,packages/common,packages/element,packages/utils
read: SPEC.md,docs/tins-tasks/wave1-page-model-brief.md,docs/superpowers/specs/2026-10-20-page-document-model-design.md,AGENTS.md,HANDOVER.md
base: main
status: open
---

Build Wave 1 of the excalidraw fork page and document model.

The fork is a modified Excalidraw at the repository root. It has a custom pages
system with a fixed 1920x1080 page, a localStorage document, and no way to
delete one page. Wave 1 fixes the four user problems named in the acceptance
rows below.

READ THESE, in this order:
  1. SPEC.md - the locked decisions D-1 to D-11 and the acceptance rows AC-1 to
     AC-8. This is the source of truth. The decisions are settled; implement them.
  2. docs/tins-tasks/wave1-page-model-brief.md - the design reference: the two
     bugs behind item 1 in detail, and how this project asserts things.
  3. docs/superpowers/specs/2026-10-20-page-document-model-design.md - the full
     design with the file and line evidence.
  4. AGENTS.md and HANDOVER.md - the project rules.

WHAT TO BUILD (the decisions, restated so nothing is lost):
  D-1  ExcalidrawPage gains width, height and contentScale. 1920x1080 is the
       minimum page size. Pages lay out by cumulative offsets, because the
       index times PAGE_GAP formula cannot express pages of different sizes.
  D-2  Grow page doubles the page rect and leaves element geometry alone.
       Scale content halves element geometry and leaves the page rect alone.
       They are separate operations, per page, each reversible.
  D-3  Scaling rewrites the stored element geometry. It is NOT a render-time
       multiplier - one authoritative conversion, because this fork has already
       been broken once by coordinate-sign drift.
  D-4  A new optional floating boolean on an element marks content that is not
       owned by its page. Floating elements are excluded from scale content and
       widen the camera clamp domain. Opt-in, never set automatically.
  D-5  On import, a page whose content does not fit grows to contain it, so
       imported content is never unreachable. The user can mark content
       floating and drag it outside deliberately. Both directions reversible.
  D-6  The document is persisted through a DocumentStore: IndexedDB primary
       using the idb-keyval dependency that is already present, localStorage as
       the fallback. The page index and the per-page element buckets are written
       as separate records, so a failed element write cannot lose the page list.
       Write failures are surfaced to the user, never swallowed.
  D-7  restoreAppState must not take the running app pages or currentPageId
       for a file that does not define them. The local appState is a fallback
       for view preferences only.
  D-8  pages and currentPageId are added to getObservedAppState, so page
       operations become undoable and collab-synced.
  D-9  The PageBar page list is virtualised, so ten thousand pages do not
       create ten thousand DOM nodes, and a single-page delete control is added
       using the existing two-step guardDestructive pattern.
  D-10 Instrument the document: element counts, save latency, page-switch
       latency, page count, active backend. Lazy hydration stays deferred until
       a measured threshold is crossed.
  D-11 No new dependency.

THE TWO BUGS BEHIND ITEM 1:
  1A  The file loads but renders blank. restore.ts resolves each appState key as
       file value, then local app value, then default. A vanilla file has no
       pages and no currentPageId, so the fork inherits the running app page
       list and current page, while every element without a pageId is stamped
       with the default first page. The renderer filters on element.pageId
       equal to currentPageId, so the elements are on page one and the camera
       is on page two and nothing is drawn. It only reproduces once the app
       holds two or more pages.
  1B  The camera is clamped to the page rect, so content outside it can never be
       reached by panning.

THE ACCEPTANCE ROWS:
  AC-1 to AC-5 are checked by packages/excalidraw/tests/pages.test.tsx, which
       already exists - append to it.
  AC-6 to AC-8 are checked by excalidraw-app/tests/pageBar.test.tsx, which you
       create.
  Every check file must mention its row id, in the test name. The kit SPEC lint
       fails if a check file does not mention the id it is checked by.

HOW TO GET FEEDBACK:
  node scripts/rowcheck.mjs AC-1
  node scripts/rowcheck.mjs --all
  node scripts/tins-gate.mjs
  Never run yarn test:app without the --watch=false flag - the script is bare
  vitest and on its own it starts watch mode and never exits.

YOUR SCOPE (do not change files outside it):
  packages/excalidraw
  excalidraw-app
  packages/common
  packages/element
  packages/utils

WHAT DONE MEANS:
  Every AC row is green, and all four gates pass. You do NOT need to run the
  full gate yourself - the harness runs it when the session closes. Your
  done-test is rowcheck.
  Do not run kit gate, kit close or kit merge. The harness closes the session
  for you. If you close it yourself the session ends early and your work is not
  in it.
  When you change behaviour, change the matching SPEC.md row too - the row
  text should name the test you wrote. The session is refused at close if
  behaviour moved without a spec row moving.

  Report at the end: which AC rows are green, the rowcheck output, how many
  failures you hit before green, and anything in the spec that was unclear.
