# Draw Performance

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 3 **Depends on:** none (independent of the page model)

---

## 1. Problem statement

The user reports that after drawing a few **text** elements with the pen, smooth curves start coming out as **multiple small disconnected line segments**.

## 2. What is _not_ the cause

Two plausible explanations were tested and **refuted**:

- **Not multi-element splitting.** There is no multi-element free-draw path in this tree. One stroke is always exactly one element (`App.tsx:9345` -> `11160`). The stroke cannot have been "converted to multiple elements".
- **Not text elements.** During a stroke the static canvas is **not** re-rendered: the mutation uses `informMutation:false`, so `scene.triggerUpdate()` is skipped (`packages/element/src/Scene.ts:434-442`), `canvasNonce` stays stable, and the memoised `visibleElements`/`elementsMap` (`packages/excalidraw/scene/Renderer.ts:161-214`) are cache hits. `StaticCanvas`'s comparator then returns true (`components/canvases/StaticCanvas.tsx:118-145`).

  Text's real cost is therefore **memory** (one offscreen canvas per text element, `packages/element/src/renderElement.ts:204-226`) plus one `drawImage` per text element **per repaint** — not per-frame CPU during a stroke. Text elements make the _board_ heavier, but they do not degrade the stroke.

## 3. The actual cause

### 3.1 Dropped pointer samples

`packages/common/src/utils.ts:155-195` `throttleRAF` overwrites `lastArgs = args` on every call (`:172`) and schedules a rAF only if none is pending (`:173-175`). When the frame fires it takes the **latest** args, nulls the slot, and calls the handler **once** (`:162-167`).

**All intermediate pointer positions are discarded.** At most one point is recorded per animation frame.

The freedraw branch (`App.tsx:10667-10696`) appends a point per _handler invocation_, so the number of points in a stroke equals the number of frames, not the number of samples the device produced. When the frame rate drops, the stroke is recorded with fewer, farther-apart points — a polyline with visible corners, which is exactly "multiple small lines instead of a smooth curve".

`streamline: 0.5` in the shape generation (`packages/element/src/shape.ts:1191-1199`) smooths the points it is given but cannot invent the missing ones.

### 3.2 What makes the frame rate drop

| Cause | Cost | Where |
| --- | --- | --- |
| Full React re-render per frame | the whole `LayerUI` tree re-renders | `App.tsx:10693` |
| `getSizeFromPoints` | `Math.max(...xs)` over a growing array, **eagerly** evaluated every frame => **O(n^2) per stroke** | `packages/element/src/mutateElement.ts:73-75`, `packages/common/src/points.ts:9-18` |
| `updateEmbeddables` | filters **all** elements, validates embeddable URLs | `App.tsx:1543-1576`, called from `componentDidUpdate` (`App.tsx:3487`) |
| `syncAnimatedImageFileIds` | O(V) loop + a new `Set` every render | `App.tsx:3252-3267` |
| `getAnimatedImageElements` | a **new array every render** -> `<AnimatedImageOverlay>` gets a new prop -> re-renders (it is **not** `React.memo`) | `App.tsx:2390-2394`, `scene/animatedImages.ts:71-80` |

### 3.3 The dev-server tax (a separate, real complaint)

`excalidraw-app/vite.config.mts:137-147` runs `vite-plugin-checker` with `typescript: true` **and** ESLint (`.env.development:41` sets `VITE_APP_ENABLE_ESLINT=true`). So every change spawns a `tsc --noEmit` worker and an ESLint pass. This is why `yarn start` feels slow — and it is a **Vite plugin** cost, not a package-manager cost.

## 4. Goals

1. Curves stay smooth regardless of frame rate.
2. Per-frame work stops growing with the length of the stroke and the size of the document.
3. The dev server stops paying for type-checking and linting on every keystroke, **on demand**.
4. The user gets a straight answer on whether **bun** would help.

## 5. The fixes

### 5.1 Recover the dropped samples — `getCoalescedEvents()`

The pointermove handler is registered as a **native** window listener (`App.tsx:8433`), so it receives a real native `PointerEvent`. Modern browsers **coalesce** high-frequency pointer events and expose the full set through `PointerEvent.getCoalescedEvents()`.

```ts
// packages/common/src/utils.ts (or a sibling pointer module)

/**
 * Every sample the device produced for this dispatch.
 *
 * Browsers coalesce high-frequency pointer events and deliver the batch in
 * `getCoalescedEvents()`. Without it, a throttled handler sees only the last
 * event of the frame and the intermediate samples are lost.
 *
 * Feature-detected: jsdom has no `window.PointerEvent`, and older browsers
 * lack the method.
 */
export const getPointerSamples = (
  event: PointerEvent,
): readonly PointerEvent[] =>
  typeof event.getCoalescedEvents === "function"
    ? event.getCoalescedEvents()
    : [event];
```

The freedraw branch then iterates **all** samples, converting each with `viewportCoordsToSceneCoords` (`packages/common/src/utils.ts:417`) and appending every distinct point.

**Rejected alternative — accumulate in a ref and commit on pointerup.** The live stroke is painted _only_ from state: `this.state.newElement` -> `Renderer.getRenderableElements` (`scene/Renderer.ts:216-237`) -> `<NewElementCanvas>` (`App.tsx:2412-2415`) -> a `useEffect` with **no dependency array** (`canvases/NewElementCanvas.tsx:27-44`) -> `renderNewElementScene`. Bypassing state during the stroke would mean **no live painting at all**, and the element would additionally be drawn twice (the renderer excludes the live element by id at `Renderer.ts:103-106`, which assumes it is in state). This alternative has the highest risk and is not recommended.

### 5.2 Make `getSizeFromPoints` cheap

Two layers:

1. **Rewrite it as a single pass**, mirroring `getBoundsFromPoints` (`packages/element/src/bounds.ts:683-700`). This removes two array allocations and four spread calls per frame, and also removes the `Math.max(...xs)` argument-count hazard on very long strokes.
2. **Make it O(1) per frame for free-draw.** A free-draw element's `x`/`y` are fixed at pointer-down (`App.tsx:9326-9343`) and its points are local offsets, so the bounding box only ever grows. Tracking the running min/max in the freedraw branch and passing `width`/`height` explicitly makes the per-frame cost constant.

   `mutateElement.ts:74` evaluates `getSizeFromPoints(points)` **eagerly** before the spread, so layer 2 needs an explicit opt-out (e.g. `options.skipSizeFromPoints`). Because `updates` is spread _after_ the computed size, an explicitly supplied `width`/`height` already wins.

### 5.3 Stop the O(elements) scans from running per frame

| Scan | Fix |
| --- | --- |
| `updateEmbeddables` (`App.tsx:1543-1576`) | gate on the element set actually changing, not on every `componentDidUpdate`. It only matters when elements are added/removed or their links change. Note it calls `scene.triggerUpdate()` (`:1567`) when it validates a new embeddable, forcing a static repaint |
| `syncAnimatedImageFileIds` (`App.tsx:3252-3267`) | memoise on the `visibleElements` + `files` references. The helper already returns the _previous_ `Set` when unchanged (`scene/animatedImages.ts:33-48`), so memoising preserves that stability |
| `getAnimatedImageElements` (`App.tsx:2390-2394`) | memoise on the same references, and wrap `<AnimatedImageOverlay>` in `React.memo` so a new array identity does not force a re-render |

With no GIFs the overlay costs one array allocation and one component call — cheap. With GIFs, the whole `<img>` tree currently re-renders on **every** frame.

### 5.4 The dev server

Two changes, both on demand:

- **ESLint** — `VITE_APP_ENABLE_ESLINT=false` in `.env.development.local` already disables the ESLint half of `vite-plugin-checker` (the config reads that variable at `vite.config.mts:137-147`). This needs no code change.
- **TypeScript** — the `typescript: true` half is **hard-coded**. It should be gated behind an env var (e.g. `VITE_APP_ENABLE_TSC`), defaulting on but switchable off.

Running the checks on demand (`yarn test:typecheck`, `yarn test:code`) is already the project's convention; the dev server does not need to duplicate it on every keystroke.

## 6. The bun question, answered

The user asked whether **bun** would be faster than yarn. The honest answer has two halves.

### 6.1 Would bun speed up `install`? Yes, probably.

Evidence that the repo is bun-compatible:

- `packageManager: "yarn@1.22.22"` (`package.json:4`) is a pin, not a blocker.
- `workspaces: ["excalidraw-app", "packages/*", "examples/*"]` (`:5-9`) — bun supports workspaces, but the yarn-1-style globs should be confirmed.
- `resolutions: { "strip-ansi": "6.0.1" }` (`:92-94`) — **bun explicitly supports Yarn's `resolutions`** (its `overrides` takes precedence if both are present).
- **No** yarn-only features to port: no `yarn workspaces foreach`, no `patch:` protocol, no `.yarnrc`, no `workspace:` protocol in the workspace manifests.

Risks:

- `yarn.lock` (v1) is unusable by bun, so it would re-resolve everything and produce a new `bun.lock` — real dependency-tree drift, and the committed `yarn.lock` would no longer be authoritative.
- `.npmrc` `legacy-peer-deps=true` is ignored by bun, so peer resolution may differ.
- `prepare: "husky install"` (`:82`) may misbehave; `--ignore-scripts` plus a manual hook install is the fallback.
- Every `yarn --cwd ...` script (`:53-66`) keeps working only if yarn 1 stays installed.

### 6.2 Would bun speed up `vite dev`? **No.**

The dev server is **Vite 5.0.12 on Node v22.23.2**. The tax the user feels is `vite-plugin-checker` spawning `tsc --noEmit` and ESLint workers on every change — a **Vite plugin** cost. Swapping the package manager does not touch it. Running Vite under Bun's runtime is a separate, unsupported experiment (rollup's native bindings).

### 6.3 Recommendation

**Do not migrate to bun now.** Install time would improve; the thing the user actually complained about — slow live editing — would not. Fix the real cost (§5.4) instead. If install time later matters, a bun migration is a contained, reversible change (it touches the lockfile and the package manager, not the app).

## 7. Test coverage

**A hard constraint was discovered:** `setupTests.ts:19-26` replaces `@excalidraw/common`'s `throttleRAF` with `mockThrottleRAF` (`tests/helpers/mocks.ts:13-24`), which calls `fn(...args)` synchronously. **The throttle is a no-op in tests**, so the harness cannot reproduce dropped samples today (5 pointermoves produce 5 points). The real `throttleRAF` is unit-tested separately by direct import, bypassing the mock (`packages/common/src/utils.test.ts:89-165`, comment at `:8-9`).

A second constraint: **jsdom 22.1.0 has no `window.PointerEvent`** (verified), and `@testing-library/dom` falls back to `window.Event` (`node_modules/@testing-library/dom/dist/events.js:56`). So `getCoalescedEvents` must be feature-detected, and any test that exercises it must construct the event itself.

| Test | Asserts |
| --- | --- |
| `getPointerSamples` (pure unit test) | with `getCoalescedEvents` present, all samples are returned; without it, the event itself is returned — placed beside `packages/common/src/utils.test.ts` |
| sampling integration | a synthetic event whose `getCoalescedEvents()` returns N samples produces `element.points.length === N + 1` (the initial point plus the samples) |
| fallback path | an event without `getCoalescedEvents` still produces a usable stroke |
| `getSizeFromPoints` | matches the previous implementation exactly on a set of point arrays (the rewrite must be behaviour-preserving) — a property-style test over random inputs |
| incremental size | the freedraw element's width/height equal the bounding box of its points after a stroke |
| per-frame scans | `updateEmbeddables` does not re-run when only the pointer moves; `getAnimatedImageElements` returns a stable reference when the element set is unchanged |
| overlay memo | `<AnimatedImageOverlay>` does not re-render when its inputs are unchanged |

Existing free-draw tests that must keep passing: `tests/flip.test.tsx:126-134, 687-690`, `tests/history.test.tsx:1256-1258, 3255-3258`, `tests/lasso.test.tsx:256-266`, `tests/selection.test.tsx:683-730`, `tests/data/restore.test.ts:145-180`. The helper that drives pointer movement is `Pointer.moveTo` (`tests/helpers/ui.ts:259-265`) and `UI.createElement("freedraw", …)` (`:537-545`).

**Teeth check:** reverting the sampling fix must make the sampling integration test fail; reverting the `getSizeFromPoints` rewrite must fail the equivalence test.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| `getCoalescedEvents` is not universally available | Feature-detected, with `[event]` as the fallback |
| Pen pressure per coalesced sample is ignored | The freedraw branch already stores a `pressures` array (`App.tsx:10684-10691`); the sampling helper must return the pressure with each sample |
| Recovering more samples makes each frame heavier | §5.2 and §5.3 make frames cheaper, so the net is a win |
| The `getSizeFromPoints` rewrite changes behaviour | A property-style equivalence test over random point arrays |
| Disabling the dev-server type checker hides real errors | The checks remain one command away and are the project's own gate |

## 9. Success criteria

1. A stroke drawn during a slow frame keeps its shape — the point count tracks the device samples, not the frame count.
2. Per-frame cost is independent of stroke length and document size.
3. `VITE_APP_ENABLE_ESLINT=false` and `VITE_APP_ENABLE_TSC=false` both silence the dev-server checker, and the checks still run on demand.
4. The four gates are green.

## 10. Ordering

**Wave 2**, alongside the image-stamping fix. Independent of the page model, so it can land on its own.
