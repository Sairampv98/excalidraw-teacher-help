# SPEC — excalidraw fork

The source of truth for this project. Rows are `D-n` (decisions) and `AC-n` (acceptance, each naming the test file that checks it). Format required by `.tins/kit/src/spec.mjs`:

- a decision row is `| D-n | <label> | locked | <detail> |` — the **label** cell (2nd column) is where a dependency name must appear, and the **status** cell (3rd column) must be `locked`, `open` or `superseded by D-n`;
- an acceptance row is `| AC-n | <label> | <check-file> | <detail> |` — the **check** cell (3rd column) names a file that must exist and must mention the `AC-n` id.

Wave 1 (this file) covers user items 1, 4, 5 and 8. The design that these rows implement is `docs/superpowers/specs/2026-10-20-page-document-model-design.md`.

---

## Decisions

| id | label | status | detail |
| --- | --- | --- | --- |
| D-1 | page geometry | locked | `ExcalidrawPage` gains `width`, `height` and `contentScale`. 1920x1080 is the **minimum** page size; a page may only grow. Pages are laid out left-to-right by **cumulative offsets**, because the index-based `index * PAGE_GAP` formula cannot express pages of differing sizes. `PAGE_GAP` is retained. The three fields are **optional in the type** and resolved by `normalizePage` to `PAGE_WIDTH` / `PAGE_HEIGHT` / `1`, so a document written before pages carried a size (and a host that builds a page itself) keeps working; a page's rect is always at least the minimum size. `PAGE_GAP` keeps its value — the pitch between two default-sized page origins — and `PAGE_SPACING` (200) is the gap between the two page rects, so the cumulative layout reproduces the old `index * PAGE_GAP` positions exactly for default-sized pages. |
| D-2 | two scaling axes | locked | **Grow page** multiplies the page rect by 2 and leaves element geometry alone. **Scale content** divides element geometry by 2 and leaves the page rect alone. They are independent, per page, and each has a reverse. Used together (grow x2, scale x0.5) the content keeps its apparent size while the room around it doubles. Implemented as the pure helpers `growPage` / `shrinkPage` (`scene/pages.ts`) and `scalePageContent` (the same file), which rewrite stored geometry and touch no renderer state. |
| D-3 | scaling persists geometry | locked | Scaling rewrites the **stored** element geometry. It is NOT a render-time multiplier. Reason: the fork has already been broken once by coordinate-convention drift (the scroll-sign defect recorded in `HANDOVER.md` section 2). A render-time multiplier would spread that class of bug across the renderer, exporter, hit-testing, bounds and presenter. The scale step is 0.5 and its inverse 2, both exact in binary floating point, so a down/up round trip is lossless. Scaled: `x`, `y`, `width`, `height`, free-draw / linear `points`, `strokeWidth`, and `fontSize` for text. Not scaled: `angle`, `groupIds`, `boundElements`, `link`, `frameId` — those are references, not geometry. A text container and its bound text are both anchored, so they scale together and the binding survives. |
| D-4 | floating elements | locked | A new **optional** per-element flag `floating?: boolean` marks an element as not owned by its page's coordinate space. A floating element is excluded from _scale content_, may sit outside the page rect, and widens the camera clamp domain to the union of the page rect and the floating elements' bounding box (`getPageClampRect`, used by the editor's camera clamp). The flag is opt-in and never set automatically — an element that does not carry it does not grow one on restore. |
| D-5 | imported content | locked | After restoring a scene, any page whose element bounding box exceeds the page rect **grows the page** to contain it, so imported content is never silently unreachable. To keep specific content deliberately outside, the user marks it floating and drags it out. Both directions are reversible. A page's origin is derived from the layout and is not stored, so a page can only grow to the right and downwards: content left of / above the page's origin cannot be contained by growing the page and has to be marked floating to be reachable. |
| D-6 | document storage | locked | The document is persisted through a `DocumentStore` interface with two backends: **IndexedDB is primary** (`idb-keyval`, already a dependency) and **localStorage is the fallback** when IndexedDB is unavailable. The page index and the per-page element buckets are written as **separate records**, so a failed element write cannot lose the page list. A write failure is surfaced to the user, never swallowed. |
| D-7 | restore does not inherit local structure | locked | `restoreAppState` must not take the running app's `pages` or `currentPageId` for a file that does not define them. The local appState is a fallback for **view preferences** only (theme, sidebar, grid), never for the document's own structure. A file without `pages` restores to exactly one page, and its elements are stamped to it. The file's own pages win (`getFilePages`), and elements without a `pageId` are stamped to the file's **first** page (`restoreElements`'s `defaultPageId`), not to a hard-coded default. |
| D-8 | page operations are undoable and synced | locked | `pages` and `currentPageId` are added to `getObservedAppState`, so adding, renaming or deleting a page becomes an undoable, collab-synced operation. Today they are omitted, which is why page changes are neither. They are standalone (not element) props, so `AppStateDelta.stripStandaloneProps` keeps them out of the element delta. |
| D-9 | page list and deletion | locked | The `PageBar` page list is **virtualised** — only the visible window of rows is rendered — so a document with thousands of pages does not create thousands of DOM nodes. A **single-page delete** control is added, using the existing two-step `guardDestructive` pattern. Deleting the last remaining page leaves one empty page rather than an empty document. |
| D-10 | measured, not guessed | locked | The document is instrumented: total and per-page element counts, save latency, page-switch latency, page count, active storage backend. A lazy-hydration redesign (loading only the current page's elements into memory) is **deferred** until a real document crosses a measured threshold: save p95 > 250 ms, page-switch p95 > 120 ms, more than 50,000 elements, or more than 2,000 pages. |
| D-11 | no new dependency | locked | Wave 1 adds **no** dependency. Everything it needs is already available: `idb-keyval` (storage), the existing `files-db` binary store (images/GIFs), and the existing fractional-indexing package. |
| D-100 | @babel/preset-env @excalidraw/eslint-config @excalidraw/prettier-config @types/chai @types/jest @types/lodash.throttle @types/react @types/react-dom @types/socket.io-client @vitejs/plugin-react @vitest/coverage-v8 @vitest/ui chai dotenv eslint-config-prettier eslint-config-react-app eslint-plugin-import eslint-plugin-prettier http-server husky jsdom lint-staged pepjs prettier rewire rimraf typescript vite vite-plugin-checker vite-plugin-ejs vite-plugin-pwa vite-plugin-svgr vitest vitest-canvas-mock | locked | The fork's pre-existing toolchain, inherited from upstream Excalidraw. Locked here unchanged: Wave 1 neither adds nor upgrades any of them, and the dependency lint in `.tins/kit/src/spec.mjs` requires every root `package.json` dependency to be named in a locked decision row. |
| D-200 | no behavioural change without a row | locked | Any change to the behaviour paths in `tins.json` must add or change a row in this file, or the session close is refused. This is the kit's rule made mechanical, and it is how "never fix a defect in code alone" is enforced. |

---

## Acceptance — Wave 1

Every row names the test file that checks it. The file must exist and must mention the row's id; the kit's SPEC lint enforces both at gate time.

| id | label | check | detail |
| --- | --- | --- | --- |
| AC-1 | vanilla file opens | `packages/excalidraw/tests/pages.test.tsx` | A `.excalidraw` file that has no `pages` in its appState restores to exactly one page, every element is stamped to that page, and **every** element is reachable by the clamped camera. The regression: with the app on a second page, the same file must still open on page one. Test: `AC-1 opens a vanilla file on the first page`. |
| AC-2 | imported content is reachable | `packages/excalidraw/tests/pages.test.tsx` | A scene whose element bounding box exceeds the page rect makes the page grow to contain it, and the clamped camera can then reach every element. Test: `AC-2 grows the page to contain imported content`. |
| AC-3 | scaling geometry | `packages/excalidraw/tests/pages.test.tsx` | _Grow page_ doubles the page rect and leaves element geometry untouched. _Scale content_ divides the geometry of that page's **anchored** elements by two and leaves **floating** elements untouched. Scaling down and back up is lossless. The pivot is the page origin, so content keeps its position relative to the page. Test: `AC-3 scales the page and its content independently`. |
| AC-4 | single page delete | `packages/excalidraw/tests/pages.test.tsx` | Deleting one page removes that page and its elements, leaves every other page and its elements untouched, and leaves `currentPageId` pointing at a page that exists. Deleting the last page leaves one empty page. Test: `AC-4 deletes a single page`. |
| AC-5 | restore isolation | `packages/excalidraw/tests/pages.test.tsx` | Restoring a file that defines its own pages keeps **those** pages and stamps elements without a `pageId` to the file's first page. Restoring a file that defines none must not inherit the running app's pages or current page, whatever page the app was on. Test: `AC-5 restores a file's own pages in isolation`. |
| AC-6 | page bar | `excalidraw-app/tests/pageBar.test.tsx` | The page list renders as a virtualised window — a document with 10,000 pages does not create 10,000 DOM nodes — and a single-page delete control is present and guarded by the two-step confirmation. |
| AC-7 | unbounded pages | `excalidraw-app/tests/pageBar.test.tsx` | 10,000 pages can be created, switched between, and survive a reload through the document store. The page index and the element buckets are written independently, so a failed element write cannot lose the page list. |
| AC-8 | storage fallback | `excalidraw-app/tests/pageBar.test.tsx` | The IndexedDB backend is used when it is available. When IndexedDB cannot be opened, the localStorage backend takes over and the document still persists. The active backend is reported. |

---

## Later waves — not implemented by this task

These are recorded so the numbering does not shift. Their design documents are in `docs/superpowers/specs/`.

| area | items | design document |
| --- | --- | --- |
| image and GIF page stamping | 2 | `2026-10-20-image-page-stamping-design.md` |
| draw performance | 3 | `2026-10-20-draw-performance-design.md` |
| canvas panels (the shared primitive) | 6, 7, 10, 11 | `2026-10-20-canvas-panel-foundation-design.md` |
| VS Code bridge | 6 | `2026-10-20-vscode-bridge-design.md` |
| video panel | 7 | `2026-10-20-video-panel-design.md` |
| presenter panels | 10 | `2026-10-20-presenter-panels-design.md` |
| sidebar unification | 9 | `2026-10-20-sidebar-unification-design.md` |
| animated flowcharts | 11 | `2026-10-20-animated-flowcharts-design.md` |
