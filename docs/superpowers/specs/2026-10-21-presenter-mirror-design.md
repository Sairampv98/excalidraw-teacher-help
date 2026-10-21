# Design — the presenter must mirror a page that is bigger than the window

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

The fork owner's 2026-10-21 observation, bundled with the performance report:

> "the presenter does not mirror what I see"

This document is the **diagnosis and the fix**, and the diagnosis is measured, not guessed.

## The measurement

The fork's own board, `day-1.excalidraw`: a vanilla file whose content sprawls over about 5.3 × 13.2 pages. On import the page is **grown to hold the whole board** — about 10,243 × 14,285 scene units. The editor then frames that page.

Running the library's own functions on that geometry:

| quantity | value |
| --- | --- |
| the page rect | x 0, y 0, 10243 × 14285 |
| the editor's zoom after framing the page | 0.1 |
| the editor's visible width at that zoom | 19,200 |
| is the viewport wider than the page? | **yes** (19,200 > 10,243) |
| the editor's camera (scene x of the viewport's left edge) | **−4,478.5** |
| the page-relative offset the presenter is given | **0** |
| the presenter's camera (scene x of the viewport's left edge) | **0** |
| **the drift** | **4,478.5 scene units** |

So the two windows are looking at **different parts of the board**, a third of a page apart. That is the owner's report.

## The cause

The page-relative camera is the anchor the presenter mirrors with (`packages/excalidraw/scene/pages.ts`):

```ts
export const getPageRelativeCamera = ({ scrollX, scrollY, pageRect }) => ({
  offsetX: clamp(-(pageRect.x + scrollX) / pageRect.width, 0, 1),
  offsetY: clamp(-(pageRect.y + scrollY) / pageRect.height, 0, 1),
});
```

The offset is **how far the page's near edge sits behind the viewport's near edge**, as a fraction of the page's size.

Now look at what the camera clamp does when the viewport is **wider** than the page (`clampCameraToPage`, same file):

```ts
// the page fits on this axis: centre it, no panning
visible >= size
  ? visible / 2 - offset - size / 2
  : clamp(current, visible - offset - size, -offset);
```

The page is **centred**. Its near edge therefore sits _in front of_ the viewport's near edge, and the offset becomes **negative**: in the measured case, `−4478.5 / 10243 = −0.437`.

**And the clamp throws it away.** `clamp(…, 0, 1)` turns −0.437 into 0 — "the page's near edge is exactly at the viewport's near edge" — which is a different camera entirely. The presenter then rebuilds `scrollX = −pageRect.x − 0 × width = 0` and anchors the page to its **corner**.

## Why it is legacy-specific

The offset only goes negative when **the viewport is wider than the page on that axis**. That needs a page that is much bigger than the window — which is exactly what a **legacy file** gets when the page is grown to hold the whole board. A document with ordinary pages never has a page bigger than the window at the zoom that fits it, so its offset stays in 0..1 and the presenter mirrors correctly.

**That is why the owner sees the fault on their old board and not on a new one.**

## The fix

The offset must be allowed to go negative. The camera clamp already guarantees the offset is at most 1 (when the viewport is narrower than the page, the camera may travel until the page's far edge is at the viewport's far edge, and no further), so the **upper** bound stays and the **lower** bound goes:

```ts
offsetX: Math.min(-(pageRect.x + scrollX) / pageRect.width, 1),
offsetY: Math.min(-(pageRect.y + scrollY) / pageRect.height, 1),
```

The value is no longer a "fraction of the page" in 0..1 — it is a **signed** ratio: how far the page's near edge is behind the viewport's near edge, measured in page widths. Negative means the page overhangs the viewport's near edge, which is what centring looks like.

Its lower end is unbounded in principle: a page that is narrow and very tall, seen in a wide window, gives a ratio of −80 or worse. A fixed lower bound would clamp that away too, so there is none.

**The presenter's own clamp then does the rest.** Given the corrected anchor, the presenter's `clampCameraToPage` centres its page exactly the way the editor's does — and when the two windows are the same size, the presenter's camera becomes **identical** to the editor's, not merely equivalent.

## The second defect: the test re-derives the layout

`excalidraw-app/tests/presenterCamera.test.ts` does not use the library's page layout. It builds its own:

```ts
/** the page rect the camera is anchored to (index-based, as the app does it) */
const getPageRect = (camera: PresenterCamera) => {
  const index = Math.max(
    0,
    camera.pages.findIndex((page) => page.id === camera.currentPageId),
  );
  return { x: index * PAGE_GAP, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT };
};
```

That is the **old** fixed-pitch layout with the fixed page size. The fork's layout is **cumulative** (`getPageRectAtIndex`: the pitch is the previous page's _width_ plus the spacing) and a page's size is its own content's bounding box. The two agree only while every page is exactly `PAGE_WIDTH` wide — which is why the test still passes today, and why it would not have caught this bug.

The project rule is that **the library's own functions are the oracle**. The helper must be replaced by `getCurrentPageRect(camera.pages, camera.currentPageId)`, which the library exports (`packages/excalidraw/index.tsx`).

## The locked decisions

| Row | The decision in one line |
| --- | --- |
| D-27 | The page-relative camera offset is a **signed** ratio, not a 0..1 fraction: it is how far the page's near edge is behind the viewport's near edge, measured in page widths. It is **negative** when the viewport is wider than the page and the camera has centred the page, and that negative value is what makes the mirrored window show the same slice. |
| D-28 | The offset is bounded **above** at 1 and is **not** bounded below. The camera clamp guarantees the upper bound; the lower end is unbounded (a narrow, tall page in a wide window), so a lower clamp would throw away real geometry. |
| D-29 | The presenter camera test uses the **library's** `getCurrentPageRect`, not a re-derived page rect. The fork's page layout is cumulative and each page is as big as its own content, so a fixed-pitch re-derivation silently stops being the truth. |

## The files

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/scene/pages.ts` | changed | the offset's clamp |
| `excalidraw-app/tests/presenterCamera.test.ts` | changed | the oracle, and the new case |
| `packages/excalidraw/tests/pages.test.tsx` | changed | the library-side assertion of the signed offset |
| `SPEC.md` | changed | D-27, D-28, D-29 and the acceptance rows |

## The acceptance rows

| Row | What it checks | File |
| --- | --- | --- |
| AC-32 | A page **bigger than the window** is centred by the camera clamp, and the page-relative offset that reaches the presenter is **negative** — not clamped to zero. | `packages/excalidraw/tests/pages.test.tsx` |
| AC-33 | The presenter's camera, rebuilt from the offset, is **the editor's camera** — not a different slice of the page. | `excalidraw-app/tests/presenterCamera.test.ts` |
| AC-34 | The presenter camera test anchors on the **library's** page rect. | `excalidraw-app/tests/presenterCamera.test.ts` |

## Rejected alternatives

- **Clamp the offset to 0..1 and centre the presenter separately.** Rejected: the presenter does not know how wide the editor's window is, so it cannot reproduce the editor's centring.
- **Express the camera as an absolute scene position.** Rejected: the presenter's window is usually a different size, and an absolute position would need the editor's window size, which the mirror deliberately does not assume.
- **Make the editor's camera left-align the page instead of centring it.** Rejected: centring is the better behaviour on screen, and the mirror should reproduce the editor, not the other way round.
- **Leave the test's re-derived page rect.** Rejected: it is a second, wrong copy of the page layout, and it is exactly what would have hidden this bug.
