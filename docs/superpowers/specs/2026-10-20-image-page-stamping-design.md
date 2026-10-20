# Image & GIF Page Stamping

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 2 **Depends on:** `2026-10-20-page-document-model-design.md` (Wave 1)

---

## 1. Problem statement

The user reports that **images and GIFs work on page 1 but do not appear on page 2**.

The symptom is not what it looks like. The camera is _not_ the problem: the DOM overlay and the canvas read the **same** global camera, so they cannot disagree. The real cause is that **two insertion paths never stamp `pageId`**, so the element lands on page 1 while the user is looking at page 2.

## 2. Root cause

### 2.1 The two unstamped paths

**Path A — paste.** `App.tsx:4099` `addElementsFromPasteOrLibrary` calls `restoreElements` (`:4107`), which stamps `pageId ?? DEFAULT_PAGE_ID` — i.e. **`"page-1"`** (`restore.ts:377`). `duplicateElements` (`App.tsx:4138`) preserves that, and `Scene.replaceAllElements` (`App.tsx:4176` -> `packages/element/src/Scene.ts:271`) does not stamp it either.

**Path B — the app's sidebar insert.** `excalidraw-app/sidebar/insertIntoScene.ts:266-273` calls `newImageElement({...})` with **no `pageId`**, so it defaults to `"page-1"` (`packages/element/src/newElement.ts:100`). This path covers the sidebar click, click-then-paste, and drag-and-drop flows.

The only places that stamp `pageId` are `App.tsx:6619-6621`, `App.tsx:7136-7145` (`insertNewElements`) and `App.tsx:9839` — the **draw** path.

### 2.2 Why it looks like the wrong place

The renderer filters `element.pageId === currentPageId` (`packages/excalidraw/scene/Renderer.ts:185-187`). So on page 2, the page-1 element is filtered out and simply **not drawn**.

Worse: when the user goes back to page 1, the element _is_ drawn — but at the wrong place. Its scene X was computed from the **page-2 camera** (`packages/common/src/utils.ts:433`), which lands it around `x ≈ PAGE_GAP` — i.e. off the right edge of page 1, outside the clamped viewport. So it is invisible on page 2 and "in the wrong place" on page 1.

### 2.3 Why the tests did not catch it

`packages/excalidraw/tests/pages.test.tsx:41-99` asserts that the **draw** path stamps `pageId`. Its header comment (`:1-9`) claims _"Every creation path funnels through `App.insertNewElements()`"_ — **false** for paste and for the app's sidebar insert.

`packages/excalidraw/tests/animatedImageOverlay.test.ts:510-536` covers page-2 geometry under a real `getCameraForPage` camera, but the element is **hand-built** at `pageRect.x + 40` (`:527`); `pageId` is never set and never asserted, and no editor is mounted. It assumes the very precondition that is broken.

## 3. Goals

1. Every path that inserts an element stamps `pageId` with the **current** page.
2. A pasted or sidebar-inserted image lands on the page the user is on, at the position they clicked.
3. The regression is covered by a test that would fail if the stamping were removed.

## 4. Non-goals

- Backfilling `pageId` onto elements that were already stored wrong. (See §7 — a migration is proposed but is a separate decision.)
- The `floating` element flag from the Wave 1 spec.
- Changing how images are rendered.

## 5. The fix

### 5.1 A single stamping point

Rather than fixing two call sites and hoping a third is not added later, the fix introduces one authoritative helper and routes every insertion through it.

```ts
// packages/excalidraw/scene/pages.ts (or a sibling module)

/**
 * Stamps `pageId` on elements that do not have one, using the page the user
 * is currently on.
 *
 * Every path that introduces elements into the scene must go through this.
 */
export const stampCurrentPage = <T extends ExcalidrawElement>(
  elements: readonly T[],
  currentPageId: string,
): T[] =>
  elements.map((element) =>
    element.pageId ? element : { ...element, pageId: currentPageId },
  );
```

Applied at:

- `App.tsx:4138` (`addElementsFromPasteOrLibrary`) — before `replaceAllElements`.
- `excalidraw-app/sidebar/insertIntoScene.ts:266` — pass `pageId: api.getAppState().currentPageId` into `newImageElement`, and stamp the whole batch for the drag-and-drop path.

### 5.2 The rule

**An element without a `pageId` belongs to the page the user is acting on.** The only exception is restore from a file, which is a different rule and is handled in the Wave 1 spec (§F1).

### 5.3 Why `pageId` is not stamped during restore

`restore.ts:377` currently stamps `DEFAULT_PAGE_ID`. Under the Wave 1 rules, restore resolves the page from the **file**, not from the running app. So `restore.ts:377` becomes: stamp with the file's first page id (or `DEFAULT_PAGE_ID` if the file has no pages). The two rules must not be conflated: _restoring a file_ resolves from the file; _inserting into the live scene_ resolves from the current page.

## 6. Test coverage

| Test | Asserts |
| --- | --- |
| paste on page 2 | after a paste on page 2, the new element's `pageId` is page 2's id |
| sidebar insert on page 2 | the element created by `insertIntoScene` carries page 2's id |
| draw on page 2 | the existing draw-path stamping still holds (no regression) |
| element is reachable | after the insert, the element's scene position maps **inside the current page's viewport** through `sceneCoordsToViewportCoords` — oracle-based, not a re-derivation |

**Teeth check:** removing the stamping call in either path must make the corresponding test fail. If it does not, the test has no teeth and must be rewritten.

## 7. The migration question (a decision, not an assumption)

Elements that were stored **before** this fix carry `pageId = "page-1"` even when the user inserted them while looking at page 2. Those elements are currently stuck on page 1 at a page-2-derived coordinate.

Options:

- **(a) Leave them.** They are recoverable by hand (drag them where you want), and they are few.
- **(b) Auto-migrate on load.** Heuristic: an element whose `pageId` is page 1 but whose position falls inside another page's rect is moved to that page. This is a guess, and a wrong guess silently moves someone's content.
- **(c) Offer a one-time "repair misplaced elements" action** that applies (b) behind a preview.

Recommendation: **(a) for now**, with the repair action available later. The bug is about _new_ insertions; guessing at history risks moving content the user deliberately placed. This is called out here because it is a judgement call, not a technical constraint.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A third insertion path is missed | One helper, one rule; the tests cover paste, sidebar and draw |
| Stamping breaks restore | Restore is explicitly excluded from this rule and handled by the Wave 1 spec |
| Already-stored wrong elements | §7 — deliberately left alone, with the option to revisit |

## 9. Success criteria

1. An image or GIF pasted or sidebar-inserted on page 2 appears on page 2, at the clicked position.
2. The same still works on page 1.
3. The four gates are green.
4. Two new tests exist, each verified to fail when its fix is reverted.

## 10. Ordering

**Wave 2**, immediately after the Wave 1 page model. The fix is small and independent of the panel foundation; it can land on its own.
