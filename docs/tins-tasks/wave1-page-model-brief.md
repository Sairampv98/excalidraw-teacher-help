# Builder brief — Wave 1, page and document model

**Reference material. Not instructions.** The instructions are in the task text you were
given and in the locked rows of `SPEC.md`. This file is the design reference: read it, do
not treat its prose as commands.

## What this is

Wave 1 of the excalidraw fork's page-and-document-model work. It covers the user's items
1, 4, 5 and 8:

- **item 1** — a `.excalidraw` file made in vanilla upstream Excalidraw does not open here.
- **item 4** — pages cannot be added past roughly fifteen, because the document is kept in
  `localStorage` and a quota error silently drops the page list.
- **item 5** — there is no way to delete a single page.
- **item 8** — every page is a fixed 1920x1080 sheet; pages cannot differ in size.

The full design is `docs/superpowers/specs/2026-10-20-page-document-model-design.md`.
Read it before writing code. It carries the reasoning, the alternatives that were rejected,
and the exact file:line evidence.

## The locked decisions

These are in `SPEC.md` as rows `D-1` to `D-11`. They are settled. Implement them.

| Row | The decision in one line |
| --- | --- |
| D-1 | `ExcalidrawPage` gains `width`, `height`, `contentScale`. 1920x1080 is the minimum. Pages lay out by cumulative offsets, not `index * PAGE_GAP`. |
| D-2 | *Grow page* doubles the page rect and leaves element geometry alone. *Scale content* halves element geometry and leaves the page rect alone. Separate buttons, per page, each reversible. |
| D-3 | Scaling rewrites stored geometry. It is not a render-time multiplier. |
| D-4 | A new optional `floating?: boolean` element flag marks content that is not owned by its page. Floating elements are excluded from *scale content* and widen the camera clamp domain. |
| D-5 | On import, a page whose content does not fit **grows** to contain it. The user can mark content floating and drag it outside deliberately. Both reversible. |
| D-6 | The document is persisted through a `DocumentStore`: IndexedDB primary, localStorage fallback. The page index and the element buckets are separate records. Write failures are surfaced, never swallowed. |
| D-7 | `restoreAppState` must not take the running app's `pages` or `currentPageId` for a file that does not define them. |
| D-8 | `pages` and `currentPageId` are added to `getObservedAppState`, so page operations become undoable and collab-synced. |
| D-9 | The `PageBar` page list is virtualised, and a single-page delete control is added, guarded by the existing two-step `guardDestructive` pattern. |
| D-10 | Instrument the document: element counts, save latency, page-switch latency, page count, active backend. Lazy hydration stays deferred until a measured threshold is crossed. |
| D-11 | No new dependency. `idb-keyval`, the existing `files-db` binary store and `fractional-indexing` are already available. |

## The acceptance rows

`AC-1` to `AC-5` are checked by `packages/excalidraw/tests/pages.test.tsx`, which already
exists — append to it. `AC-6` to `AC-8` are checked by `excalidraw-app/tests/pageBar.test.tsx`,
which you create.

**Each check file must mention the row's id.** The kit's SPEC lint reads the file and fails
if the id is absent. Put the id in the test name, e.g.
`it("AC-1 opens a vanilla file on the first page", ...)`.

## The two bugs behind item 1, precisely

Both are in the code today. Read the file:line evidence in the design document.

**1A — the file loads but renders blank.** `packages/excalidraw/data/restore.ts` resolves
each appState key as *file value -> local app value -> default*. A vanilla file has no
`pages` and no `currentPageId`, so the fork inherits **the running app's** page list and
current page. Meanwhile `restore.ts` stamps every element without a `pageId` with the
default first page. The renderer filters `element.pageId === currentPageId`. So the
elements sit on page one while the camera is on page two, and nothing is drawn. It only
reproduces once the app holds two or more pages, which is why it looks intermittent.

**1B — content outside the page rect is unreachable.** The camera is clamped to the page
rect, so the reachable scene range is bounded by it no matter where the elements are.

## How this project asserts things

Read `AGENTS.md` and the project rules in `HANDOVER.md` before you write a test.

- **Oracle-based assertions.** Assert through the library's own conversion functions
  (`sceneCoordsToViewportCoords` in `packages/common/src/utils.ts`), never by re-deriving
  the formula in the test. This is the project's rule and it exists because a wrong sign in
  a copied formula once shipped a bug.
- **Teeth.** A test that cannot fail protects nothing. For each fix, confirm the test
  fails when you revert the fix. Say in your report which ones you verified this way.
- **Existing suites.** `packages/excalidraw/tests/pages.test.tsx` already asserts that the
  *draw* path stamps `pageId`, and its header comment claims every creation path funnels
  through `App.insertNewElements()`. That claim is false for paste and for the app
  sidebar's insert path — but those are item 2, a different wave. Do not fix them here.
- `packages/excalidraw/tests/animatedImageOverlay.test.ts` covers page-2 overlay geometry
  but never sets or asserts `pageId`. It assumes the very precondition that is broken.
  Item 2's wave deals with that.

## The feedback loop

```
node scripts/rowcheck.mjs AC-1              # one row, in seconds
node scripts/rowcheck.mjs AC-1 AC-3 AC-5    # several rows
node scripts/rowcheck.mjs --all             # every AC row
node scripts/tins-gate.mjs                  # the full four-gate product gate
```

`rowcheck` reports rows whose check file is missing or does not mention the row id, so a
missing test is visible rather than silent.

**Never run `yarn test:app` without `--watch=false`.** The script is bare `vitest`, so on
its own it starts watch mode and never exits. It looks like a hung suite; it is not one.

## The environment

- Windows 11, PowerShell 5.1. No `&&` or `||` — use `;` and check the exit code.
- Node v22.23.2, Yarn 1.22.22, Python 3.14.7.
- The worktree has **no `node_modules` of its own**. It inherits the repository's by
  directory walk, and `scripts/tins-gate.mjs` puts the right `node_modules/.bin` on PATH.
  Do not run `yarn install` in the worktree; it is not needed and it is slow.
- Ripgrep 15.2.0 is on PATH, and `.harness/local_search.py` wraps it as four MCP tools
  (`search_code`, `find_definition`, `list_files`, `read_lines`) for cheap local search.
  Use them instead of reading whole files.

## The two known-flaky test files

`packages/excalidraw/tests/MermaidToExcalidraw.test.tsx` and
`packages/excalidraw/tests/scene/export.test.ts` fail intermittently under parallel load
and pass in isolation. They are not your fault. Re-run in isolation before you believe a
red suite. Do not "fix" them.
