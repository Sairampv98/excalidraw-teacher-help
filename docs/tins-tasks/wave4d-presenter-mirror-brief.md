# Builder brief — Wave 4d, the presenter must mirror a big page

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's 2026-10-21 observation:

> "the presenter does not mirror what I see"

The full diagnosis, with the measured numbers, is `docs/superpowers/specs/2026-10-21-presenter-mirror-design.md`. **Read it first** — it carries the measurement, the cause and the fix.

## The one-paragraph version

A legacy file's page is **grown to hold the whole board** (about 10,243 × 14,285 scene units for the owner's `day-1.excalidraw`). The editor frames that page, and at that zoom the viewport is **wider than the page** — so the camera clamp **centres** the page, and the page-relative offset becomes **negative** (−0.437 in the measured case).

`getPageRelativeCamera` in `packages/excalidraw/scene/pages.ts` clamps that offset to `0..1`, which throws the negative value away and turns it into "the page's near edge is at the viewport's near edge". The presenter rebuilds its camera from that anchor and lands **4,478 scene units** to the side of the editor — a third of a page away. Different slice, same page.

**The fix: the offset is a signed ratio, not a 0..1 fraction.**

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-27 | The page-relative camera offset is a **signed** ratio, not a 0..1 fraction: it is how far the page's near edge is behind the viewport's near edge, measured in page widths. It is **negative** when the viewport is wider than the page and the camera has centred the page, and that negative value is what makes the mirrored window show the same slice. |
| D-28 | The offset is bounded **above** at 1 and is **not** bounded below. The camera clamp guarantees the upper bound; the lower end is unbounded (a narrow, tall page in a wide window), so a lower clamp would throw away real geometry. |
| D-29 | The presenter camera test uses the **library's** `getCurrentPageRect`, not a re-derived page rect. The fork's page layout is cumulative and each page is as big as its own content, so a fixed-pitch re-derivation silently stops being the truth. |

Add these three rows to `SPEC.md` in the Decisions table (after `D-26`), and the three acceptance rows below to the Wave 4 acceptance table.

## The fix, precisely

In `packages/excalidraw/scene/pages.ts`:

```ts
export const getPageRelativeCamera = ({ scrollX, scrollY, pageRect }) => ({
  offsetX: clamp(-(pageRect.x + scrollX) / pageRect.width, 0, 1),
  offsetY: clamp(-(pageRect.y + scrollY) / pageRect.height, 0, 1),
});
```

becomes

```ts
export const getPageRelativeCamera = ({ scrollX, scrollY, pageRect }) => ({
  offsetX: Math.min(-(pageRect.x + scrollX) / pageRect.width, 1),
  offsetY: Math.min(-(pageRect.y + scrollY) / pageRect.height, 1),
});
```

**Do not clamp the lower bound.** A page that is narrow and very tall, seen in a wide window, produces a ratio of −80 or worse; a fixed lower bound would clamp that away too.

`getCameraFromPageRelative` needs **no** change — it is already the inverse (`scrollX = -pageRect.x - offsetX * pageRect.width`), and with the corrected anchor the presenter's own `clampCameraToPage` re-centres its page exactly the way the editor's does.

Update the doc comment above `getPageRelativeCamera`: the offset is no longer "fraction of the page width scrolled off to the left, 0..1" — it is a **signed** ratio, and negative means the page overhangs the viewport's near edge (which is what centring looks like).

## The second defect: the test re-derives the page layout

`excalidraw-app/tests/presenterCamera.test.ts` builds its own page rect:

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

That is the **old** fixed-pitch layout with the fixed page size. The fork's layout is **cumulative** and a page's size is its own content's bounding box. Replace it with the library's own function, which is exported from `@excalidraw/excalidraw`:

```ts
import { getCurrentPageRect } from "@excalidraw/excalidraw";

const getPageRect = (camera: PresenterCamera) =>
  getCurrentPageRect(camera.pages, camera.currentPageId);
```

The `PAGE_GAP` / `PAGE_WIDTH` / `PAGE_HEIGHT` imports in that file may become unused — remove them if so. **The project rule is that the library's own functions are the oracle**; a second, hand-written copy of the page layout is exactly what hid this bug.

## The files you own

Everything below is inside the task scope `packages/excalidraw,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/scene/pages.ts` | changed | the offset's clamp, and its doc comment |
| `packages/excalidraw/tests/pages.test.tsx` | changed | AC-32 |
| `excalidraw-app/tests/presenterCamera.test.ts` | changed | the oracle, and AC-33 / AC-34 |
| `SPEC.md` | changed | D-27, D-28, D-29 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-32 | `packages/excalidraw/tests/pages.test.tsx` | A page **bigger than the window** is centred by the camera clamp, and the page-relative offset that reaches the presenter is **negative** — not clamped to zero. |
| AC-33 | `excalidraw-app/tests/presenterCamera.test.ts` | The presenter's camera, rebuilt from the offset, is **the editor's camera** — not a different slice of the page. |
| AC-34 | `excalidraw-app/tests/presenterCamera.test.ts` | The presenter camera test anchors on the **library's** page rect. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-32 the page-relative offset is negative when the page is bigger than the window', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

### How to build the test case

Use the library's own functions — do not re-derive the geometry:

- a page of, say, 10243 × 14285 (`getCurrentPageRect` gives you the rect);
- `getCameraForPage` frames it;
- `clampCameraToPage` clamps it (this is what centres the page when the viewport is wider);
- `getPageRelativeCamera` reads the offset off the clamped camera.

The measured values, for the case the design quotes: the page rect is `{ x: 0, y: 0, width: 10243, height: 14285 }`, the editor's zoom after framing is `0.1`, the editor's visible width is `19200` (wider than the page), the editor's camera is `scrollX = 4478.5` and the offset must be about `−0.437` — **not** 0.

**Do not hard-code the expected numbers**: assert the _relationships_ — the offset is negative, and the camera rebuilt from it equals the editor's camera. Those are the properties that matter and they hold for any page size.

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your three new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the offset's lower clamp is put back, (b) the test's re-derived page rect is put back. Record what you broke and what failed — the orchestrator needs that in the close note.
