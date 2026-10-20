# Wave 1 — Page & Document Model

**Status:** design approved in principle; awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` (worktree at `C:\Users\user\projects\excalidraw\.worktrees\feature-problems`) **Covers user items:** 1, 4, 5, 8 **Does not cover:** 2, 3, 6, 7, 9, 10, 11 (see §11)

---

## 1. Problem statement

The fork replaced Excalidraw's infinite canvas with a **fixed page rect** — every page is `PAGE_WIDTH x PAGE_HEIGHT` (1920x1080) laid out left-to-right at `index * PAGE_GAP`, and the camera is hard-clamped to that rect. The page model was never given a size, a scale, or a delete affordance, and the document is persisted to `localStorage` with a write-ordering bug.

Four user-visible problems follow from this:

| Item | Symptom | Root cause |
| --- | --- | --- |
| 1 | Vanilla `.excalidraw` files "don't open" | Two independent bugs — see §4.1, §4.2 |
| 4 | Can't add pages past ~15 | `localStorage` quota + a write-ordering bug (§4.3) |
| 5 | Can't delete a single page | Only "clear this page's elements" and "delete all pages" exist |
| 8 | Pages can't have different sizes | `ExcalidrawPage` is `{ id, name }` — no size, no scale, no geometry |

Two further defects surfaced during investigation and are in scope because they live in the same code:

- `getObservedAppState` omits `pages` / `currentPageId`, so **page add/remove is neither undoable nor collab-synced**.
- `element.index` is one global z-order sequence across all pages, which is meaningless now that pages are separate coordinate spaces.

## 2. Goals

1. A vanilla `.excalidraw` file opens with **all** its content visible.
2. The page count is bounded only by storage, not by a 5 MB quota. 10,000 pages is a supported target.
3. A single page can be deleted without touching the others.
4. Each page independently supports **grow page** and **scale content**.
5. The document lives in IndexedDB, with `localStorage` as an automatic fallback.
6. The build **measures itself**, so the decision to move to lazy per-page hydration (option A) is made on data rather than on guesswork.

## 3. Non-goals

- Lazy hydration (loading only the current page's elements into memory). Deferred to a later wave, gated on the measurements in §9.
- Any change to the `.excalidraw` **top-level** file shape. It stays upstream-identical, so files saved by this fork continue to open in vanilla upstream (§4.6).
- Items 2, 3, 6, 7, 9, 10, 11.

## 4. Current behaviour, precisely

### 4.1 Bug 1A — a vanilla file renders blank

`packages/excalidraw/data/restore.ts:1042-1056` resolves each appState key as _file value -> local app value -> default_. A vanilla file has no `pages` and no `currentPageId`, so the fork inherits **the running app's** page list and **current page**. Meanwhile `restore.ts:377` stamps every element without a `pageId` with `DEFAULT_PAGE_ID` (`"page-1"`). The renderer filters `element.pageId === currentPageId` (`packages/excalidraw/scene/Renderer.ts:185-187`).

**Result:** elements on page 1, camera on page 2 -> nothing renders. Clicking "Previous page" reveals the content. Only reproduces once the app holds 2+ pages, which is why it looks intermittent.

### 4.2 Bug 1B — content outside the page rect is unreachable

`packages/excalidraw/scene/pages.ts:134-177` clamps the camera so the visible region stays inside the page rect. The reachable scene range is therefore bounded by the page rect regardless of where elements are. Verified live: an image at scene `x=5241` on page 1 was invisible and could not be panned to.

### 4.3 Bug 4 — pages stop persisting past ~15

`excalidraw-app/data/LocalData.ts:90-97` writes the **elements** blob first and the **appState** blob (which holds `pages`) second, inside **one** `try`. A `QuotaExceededError` on the first write aborts the second, so new pages are never persisted and vanish on reload. The threshold is therefore content-dependent, not a constant — no page cap exists anywhere in the code (checked to 5,000 pages).

### 4.4 Item 5 — no single-page delete

`excalidraw-app/components/PageBar.tsx` offers: hide bar, **delete all pages** (two-step), previous, next, add, **clear this page's elements** (two-step), export PDF. The clear button soft-deletes a page's _elements_ and keeps the page. There is no control that removes one page.

### 4.5 Item 8 — no page geometry

`packages/excalidraw/types.ts:145-148`:

```ts
export type ExcalidrawPage = {
  id: string;
  name: string;
};
```

Page size is the global constant pair `PAGE_WIDTH = 1920`, `PAGE_HEIGHT = 1080`; layout is `getPageRectByIndex` = `index * PAGE_GAP`. There is no size, no scale, and no per-page camera (the camera is global appState, merely clamped into the current page).

### 4.6 Format compatibility status

The load path is **byte-identical to upstream** except for 26 added lines, so the fork did not rewrite it. Consequences:

- **Forward compat is already correct.** A file saved by this fork opens in vanilla upstream: the top-level shape is unchanged, `pageId` is an unknown element prop that upstream preserves and ignores, there are no fork-only element types, and upstream's `restoreAppState` copies only known appState keys — `pages` and `currentPageId` are dropped harmlessly.
- **Backward compat is broken** by 4.1 and 4.2 only.

## 5. Data model

```ts
export type ExcalidrawPage = {
  id: string;
  name: string;
  /**
   * Multiplier applied to this page's element geometry.
   * 1 = as drawn. 0.5 = content half size relative to the page.
   * Steps of 0.5; the lower bound is 0.125.
   */
  contentScale: number;
};
```

> **Revised 2026-10-20.** `width` and `height` are **gone** from the page record. Every page is a fixed 1920x1080 sheet; the only size knob is `contentScale` on the content. A per-page size was tried and rejected: growing a page pushed the neighbouring pages sideways, because the layout is cumulative.

Page **origin** is not stored on the page; it is derived by layout (§5.2) so that inserting or removing a page cannot leave stale offsets behind.

### 5.1 The scaling axis

> **Revised 2026-10-20, after live testing.** This section originally specified **two** independent axes (_grow page_ and _scale content_). The user tested both on a 38-page document and found that _grow page_ **encroaches on the neighbouring pages**: because pages are laid out by cumulative offsets, enlarging page 2 pushes page 3 sideways. Their own proposed solution was "select all the content on the page and scale it down" — which is exactly _scale content_, and which **never moves another page**. Decision: **drop the grow/shrink-page axis entirely. One knob, not two.**

| Operation | Effect on page rect | Effect on elements | Result on screen |
| --- | --- | --- | --- |
| **Scale content up** | unchanged | geometry x2 | content physically larger relative to the page |
| **Scale content down** | unchanged | geometry /2 | content physically smaller relative to the page, more relative room, **no other page moves** |

The page rect stays 1920x1080 for every page. There is no per-page size, and pages no longer need cumulative offsets — each page keeps the same fixed pitch, so `getPageRectByIndex` is sufficient and the layout refactor described in §5.2 is dropped, because all pages are the same size again.

**What this removes.** `ExcalidrawPage` does not need `width`/`height`; the _grow page_ / _shrink page_ controls are deleted; and the page-layout change from index-based to offset-based is no longer needed.

**What this keeps.** Everything below about _how_ scaling is applied still holds: the transform table, the pivot, the `floating` exclusion, and the rule that scaling persists rescaled geometry rather than being a render-time multiplier.

**One consequence to be explicit about.** Because the page no longer grows, a scene whose content exceeds the 1920x1080 page still needs somewhere to go. That is what the `floating` flag is for (§5.3), and it is now load-bearing rather than a convenience: content that must sit outside the page is marked floating, and the camera clamp widens to include it.

```ts
/** multiplier applied to element geometry by "scale content" */
export const CONTENT_SCALE_STEP = 0.5;
```

`contentScale` is stored **as a number on the page**, and scaling is applied by **persisting rescaled geometry**, not as a render-time multiplier. Rationale: the fork has already been burned once by coordinate convention drift — `HANDOVER.md` §2 records that `pages.ts` computed scroll bounds with the wrong sign while `packages/common/src/utils.ts` was correct. A render-time multiplier would spread that class of bug across the renderer, exporter, hit-testing, bounds and presenter. Persisting the transform keeps exactly one authoritative conversion.

Because `CONTENT_SCALE_STEP` is 0.5 and its inverse 2 — both exact in binary floating point — scaling down and back up is lossless.

### 5.2 Layout

```ts
export const getPageRect = (
  pages: readonly ExcalidrawPage[],
  pageId: string,
): PageRect;
```

Pages are laid out left-to-right at a **fixed pitch**: page _n_ starts at `n * PAGE_PITCH`. Since every page is the same size, the existing index-based `getPageRectByIndex` is sufficient and stays as it is.

> **Revised 2026-10-20.** The **cumulative-offset layout is dropped**. It only existed so that pages could differ in size, and per-page size was rejected. `PAGE_GAP` (the 200px gap between page rects) is retained as-is, so the page pitch is unchanged and existing scenes keep their geometry.

### 5.3 Anchored vs floating elements

Elements keep absolute scene coordinates and a `pageId`, as today. A new **optional** per-element flag distinguishes two kinds:

```ts
/** When true the element is not owned by its page's coordinate space. */
floating?: boolean;
```

- **Anchored** (default): belongs to the page; scales with `scale content`; expected to sit inside the page rect.
- **Floating**: explicitly **not** owned by the page. It is excluded from `scale content`, it may sit outside the page rect, and the camera clamp is relaxed to include it (the clamp domain becomes the union of the page rect and the bounding box of floating elements on that page).

This is the mechanism behind "grow the page to contain imported content, **and** let the user un-anchor content to keep it outside". `floating` is opt-in and never set automatically.

### 5.4 Z-order

`element.index` becomes **per page**. Each page's elements carry their own fractional-index sequence. Today's single global sequence interleaves pages and is meaningless once pages are separate coordinate spaces. The `packages/fractional-indexing` dependency is reused unchanged.

## 6. Scaling transform

`scale content` multiplies these properties of every **anchored** element on the page:

| Property | Scaled |
| --- | --- |
| `x`, `y` | yes |
| `width`, `height` | yes |
| `points[]` (free-draw) | yes |
| `strokeWidth` | yes |
| `fontSize` (text) | yes |
| `angle` | no |
| `groupIds`, `boundElements`, `link`, `frameId` | no (references, not geometry) |

The pivot is the page origin, so content keeps its position **relative to the page**. Floating elements are untouched.

Text elements need care: `fontSize` scales, and the element's `width`/`height` scale with it. If a text element is bound to a container, both scale together so the binding survives.

## 7. Storage

### 7.1 The store interface

```ts
/** Everything the document consists of, as persisted. */
export type StoredDocument = {
  pages: readonly ExcalidrawPage[];
  /** Element buckets keyed by page id. */
  elementsByPage: Record<string, readonly ExcalidrawElement[]>;
};

export interface DocumentStore {
  readonly backend: "indexeddb" | "localstorage";
  load(): Promise<StoredDocument>;
  savePages(pages: readonly ExcalidrawPage[]): Promise<void>;
  savePageElements(
    pageId: string,
    elements: readonly ExcalidrawElement[],
  ): Promise<void>;
  removePage(pageId: string): Promise<void>;
  clear(): Promise<void>;
}
```

Two backends implement it:

- **`IndexedDbDocumentStore`** (primary) — `idb-keyval`, already a dependency of `excalidraw-app`. Stores the page index and per-page element buckets as **separate records**, so a failed element write cannot lose the page list. This is the structural fix for 4.3.
- **`LocalStorageDocumentStore`** (fallback) — the same shape, one JSON blob, used when IndexedDB is unavailable (private mode, disabled, or throwing on open).

Backend selection happens once at startup, and the active backend is surfaced in the UI so the user knows whether they are on the durable or the degraded store. A write failure on the primary backend is **surfaced as a visible error**, not swallowed — the current silent catch is what made 4.3 invisible.

### 7.2 What stays where

Binary assets (images, GIFs) keep using the existing `files-db` IndexedDB store (`excalidraw-app/data/LocalData.ts`). They are referenced by `fileId` from elements and are unaffected by per-page bucketing.

### 7.3 Page list rendering

`PageBar` must **not** create one DOM node per page. With 10,000 pages the list is virtualised: only the visible window of rows is rendered. The counter and prev/next keep working regardless.

## 8. The fixes

### F1 — a vanilla file opens (item 1A)

In `restoreAppState` / `restoreElements`:

- If the imported appState defines `pages`, use them, and stamp elements without a `pageId` to the file's **first** page.
- If it does not, use exactly `[DEFAULT_PAGE_ID]` and set `currentPageId = DEFAULT_PAGE_ID`.
- In neither case may the restore inherit the **local** app's page list or current page. Concretely: `pages` and `currentPageId` are **excluded from the generic local-fallback loop** at `restore.ts:1042-1056` and resolved only from the imported file (falling back to the default page). The local appState remains a fallback for _view preferences_ (theme, sidebar, grid), never for the document's own structure.

### F2 — imported content is always reachable (item 1B)

After restore, compute each page's element bounding box. If it exceeds the page rect, the content must still be reachable — and since the page can no longer grow (§5.1), the mechanism is the **floating** flag, not a larger page.

**Rule:** on import, any element that falls outside its page's rect is marked `floating`. A floating element is excluded from _scale content_, and the camera clamp for that page widens to the union of the page rect and the floating elements' bounding box — so the content is visible and pannable to, exactly as it was before the fix, while the page itself stays a 1920x1080 sheet.

This makes the import path the **one** place where `floating` is set automatically. Everywhere else the flag is opt-in by the user (§5.3): a user may mark content floating to keep it outside a page, and may un-mark it to bring it back under the page's scale.

**The manual half the user asked for** is unchanged and still supported: to keep specific content outside the page, mark it floating and drag it beyond the page rect. The camera clamp covers it, because the clamp domain is the union of the page rect and the floating elements' bounding box.

### F3 — unbounded pages (item 4)

- Document persisted through `DocumentStore` (§7).
- Page index and element buckets written independently (§7.1).
- `PageBar` page list virtualised (§7.3).
- `pages` and `currentPageId` added to `getObservedAppState` (`packages/element/src/store.ts:1006-1023`) so page operations are undoable and collab-synced.

### F4 — delete a single page (item 5)

A per-page delete control in `PageBar`, using the existing two-step `guardDestructive` pattern (`PageBar.tsx:296-306`). Deleting a page removes the page record, removes its elements, and repoints `currentPageId` to a valid neighbour. Deleting the last remaining page leaves a single empty page 1 rather than an empty document.

### F5 — per-page size and content scale (item 8)

- `ExcalidrawPage` gains `width`, `height`, `contentScale` (§5).
- Controls to **grow/shrink page** and **scale content up/down**, acting on the current page.
- Layout by cumulative offsets (§5.2).
- `contentScale` and the new geometry persist in the saved file and survive a reload.

### F6 — format round-trip

- `.excalidraw` files save the new page fields inside `appState.pages` (the top-level shape is unchanged, so forward compatibility with vanilla upstream is preserved).
- Files written by an **older build of this fork** (pages without the new fields) restore with defaults: `width = PAGE_WIDTH`, `height = PAGE_HEIGHT`, `contentScale = 1`.

## 9. Instrumentation — making the option-A decision measurable

A `documentStats` module records, in a rolling window:

- total element count and current-page element count
- save latency (ms) — per backend
- page-switch latency (ms)
- page count
- active backend
- storage bytes written per save

Exposed through a dev-only panel and a console API.

**Decision thresholds** — if a real document crosses either, lazy per-page hydration (option A) becomes worth its cost and is scheduled:

| Signal                  | Threshold |
| ----------------------- | --------- |
| save p95 latency        | > 250 ms  |
| page-switch p95 latency | > 120 ms  |
| total elements          | > 50,000  |
| page count              | > 2,000   |

Until then the flat in-memory model stands.

## 10. Testing strategy

The project's rules apply: **oracle-based assertions** go through the library's own conversion functions (`sceneCoordsToViewportCoords`), never a re-derivation of the formula in the test. Every fix is verified by **reverting it and confirming the test fails** — a test that cannot fail protects nothing.

New/extended test coverage:

| Test | Asserts |
| --- | --- |
| `restore` — vanilla file | `currentPageId` is page 1, elements stamped page 1, **all** elements reachable by the clamped camera |
| `restore` — file with pages | pages preserved, elements land on the file's first page |
| `restore` — file with content outside the page rect | page grows to contain it; camera reaches every element |
| `restore` — file from an older fork build | new page fields default correctly |
| page add / remove / delete | appState correct, `currentPageId` always valid, undoable |
| single-page delete | that page gone, its elements gone, **other pages untouched** |
| grow page | width/height doubled, anchored content unmoved, floating content unmoved |
| scale content | element geometry scaled per §6, floating untouched, x0.5 then x2 is lossless |
| store — IndexedDB backend | page index and element buckets written independently |
| store — fallback | localStorage backend used when IndexedDB throws on open |
| `PageBar` — 10,000 pages | renders without creating 10,000 DOM nodes |

## 11. Sequencing — what comes after Wave 1

| Wave | Items | Depends on |
| --- | --- | --- |
| **1 (this spec)** | 1, 4, 5, 8 | — |
| 2 | 2 (image/GIF `pageId` stamping), 3 (pen perf) | none |
| 3 | 6, 7, 10 (VS Code panel, video panel, presenter) | a **canvas-panel primitive** — resizable, positionable, lock-to-screenshot, crop — which does not exist yet and must be built first |
| 4 | 9 (sidebar merge), 11 (animated flowcharts) | wave 3's panel primitive |

Item 7 additionally requires, before implementation: a **benchmark** of OCR duration on a full-resolution video frame, and confirmation that screenshots are captured at intrinsic resolution (`video.videoWidth x video.videoHeight`) rather than screen-grabbed from the on-canvas DOM.

Item 6's editor is the agreed **hybrid**: a VS Code/VSCodium extension over a local socket is the live path; an in-browser compiler is the fallback when no bridge is connected.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| `ExcalidrawPage` is a published type — changing it is a breaking API change | Acceptable in a fork; `examples/` and `excalidraw-app` updated in the same change |
| Collab behaviour changes when `pages` enters `getObservedAppState` | Page ops become syncable; intentional and called out in the commit message |
| Per-page z-order changes element ordering in existing files | Migration assigns each page's elements a fresh per-page sequence; a file round-trip is covered by tests |
| Text elements scaling font size changes layout of bound containers | Bound text containers scale together (§6) |
| Virtualised `PageBar` changes DOM structure | Existing `sidebar-ui` / `PageBar` tests updated; no behavioural change to the user |

## 13. Success criteria

1. All four gates green: `yarn test:typecheck`, `yarn test:code`, `yarn test:other`, `yarn test:app --watch=false`.
2. The existing 1606 tests still pass, plus the new ones in §10.
3. A vanilla `.excalidraw` file opens with **every** element visible and reachable.
4. 10,000 pages can be created, switched between, and survive a reload.
5. A page can be deleted without affecting any other page.
6. Grow page and scale content work independently per page and persist across reload.
7. With IndexedDB unavailable, the document still persists via the `localStorage` fallback.
8. The instrumentation in §9 reports save and page-switch latency, with the decision thresholds recorded.

## 14. Known pitfall carried from `HANDOVER.md`

`yarn test:app` is bare `vitest` with **no `--watch=false`** — it enters watch mode and never exits. Always pass `--watch=false`, or use `yarn test:all`.

## 15. Verified baseline (worktree, 2026-10-20)

Measured in the worktree at commit `12d1e41`, before any Wave 1 change:

| Gate | Result |
| --- | --- |
| `yarn test:typecheck` | exit 0 |
| `yarn test:code` | exit 0 |
| `yarn test:other` | exit 0 |
| `yarn test:app --watch=false` | exit 0 — **120 files, 1606 passed, 48 skipped, 1 todo, 0 failed** |

One caveat, recorded so a later failure can be told apart from it: an **earlier** run of the same suite in the same worktree reported `2 failed | 1604 passed`. Both failing files were `packages/excalidraw/tests/MermaidToExcalidraw.test.tsx` and `packages/excalidraw/tests/scene/export.test.ts`, and both **pass in isolation** (17/17, exit 0) — the flake signature `HANDOVER.md` §1 documents for exactly these two files under parallel load. The suite was re-run and came back fully green. Treat these two files as known-flaky; do not chase them, and re-run in isolation before believing a red suite.
