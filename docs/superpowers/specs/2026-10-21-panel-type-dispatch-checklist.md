# The panel-type dispatch checklist

**The gate.** The panel design (§8) says: _"no panel code is written until every dispatch point has a recorded decision."_ This is that artefact.

**How it was produced.** Every place in the repository that switches on an element's `type` was enumerated and read, on 2026-10-21, at `bcd6aee`. The counts, the search patterns and the sweep's limits are in §1. The decisions are in §2–§7, and the two the code forced are locked in `SPEC.md` as **D-33** and **D-34**.

**A tooling note that matters.** Literal `"` characters are **stripped from the command line** in this environment. `rg 'element\.type === "text"'` returns **0 hits**; `rg 'element\.type\s*[!=]==?\s*\x22'` returns the true hits. Any earlier audit done with literal quotes silently under-counted. Every pattern below was re-run with `\x22`.

---

## 1. The totals

| # | Pattern | Scope | Raw hits |
| --- | --- | --- | --- |
| S1 | `element\.type\s*[!=]==?\s*\x22` | `packages` + `excalidraw-app` | 116 (incl. tests) |
| S2 | `case\s+\x22` | `packages/element/src`, `packages/excalidraw` | ~230 case labels |
| S3 | `switch\s*\(\s*[a-zA-Z_$.]*\.?type\s*\)` | all | **24** switches |
| S4 | `export (const\|function) is[A-Z]\w*` in `typeChecks.ts` | — | **33** guards |
| S5 | `\.type\s*[!=]==?\s*\x22(text\|rectangle\|…)` | all, non-test | **208** |
| S6 | `is[A-Z]\w*Element\(` call sites | all, non-test | **~700** |
| S7 | `floating` | all | 49 (9 real read sites) |
| S8 | `AnimatedImageOverlay\|animatedImages\|isAnimatedImageElement` | all | 24 |
| S9 | `assertNever` | all | 15 |

- **130 dispatch points** across **62 files**. 37 of the 99 files the broad sweep matched were false positives (tool types, DOM event types, `isArrowKey`, `isImageFileHandle`, `isLineSegment`, `element.type` on non-element objects).
- **20** `switch` statements over the full `ExcalidrawElement` union.
- **33** type guards in `typeChecks.ts`.
- **21** type-union members to gain or reject.

**Not swept:** `.worktrees/` (git-ignored; three older copies of this same fork — deliberately excluded as duplicates), `node_modules/`, `htr-sandbox/`. Test files were counted but not enumerated as dispatch points, **except** `packages/excalidraw/tests/helpers/api.ts:300-390`, which is a switch over element types that _constructs_ elements — a panel cannot be created in any test without a case there.

**Two files the briefing assumed do not exist:** `packages/element/src/restore.ts` (the only restore is `packages/excalidraw/data/restore.ts`) and a type dispatch in `packages/element/src/mutateElement.ts` (it is type-agnostic; the only type-specific branch is elbow arrows at `:61-66`).

### The single most important structural finding

**TypeScript will not protect you.** `packages/tsconfig.base.json` sets `strict: true` but **not** `noImplicitReturns`. So:

| Switch shape | Example | What happens when `"panel"` is added to the union |
| --- | --- | --- |
| No `default` arm, non-void return | `distance.ts:34`, `shape.ts:1080`, `collision.ts:450` | ✅ TS2366 — **compile error, loud** |
| `default` arm present | `typeChecks.ts:397` (`return false`), `renderElement.ts:93` (`return 20`), `shape.ts:228` (`throw`), `transform.ts:308` (soft assert) | ❌ **No TS error.** Silent wrong behaviour |
| `default` + `assertNever(x, msg)` | `typeChecks.ts:268`, `transform.ts:634` | ✅ TS error — loud |
| `default` + `assertNever(x as never, …, true)` | `transform.ts:323`, `transform.ts:399` | ❌ **No TS error.** The `as never` cast defeats exhaustiveness → console.error only |
| Explicit `return null` fall-through | `data/restore.ts:678` | ❌ **No TS error.** Element silently dropped on load |

**The compiler catches roughly a third of these sites. The rest fail silently** — which is exactly the failure mode this gate exists to prevent.

---

## 2. The highest-risk group: serialisation and restore

### `packages/excalidraw/data/restore.ts:450-679` — `restoreElement`

The switch restores each element type's own properties. It has **no `default` arm** and falls through to `return null` at `:678`. `restoreElements` then filters on `if (migratedElement)` at `:834`.

**The panel would be silently dropped from the loaded scene.** No error, no log. The code's own comment at `:674-678` says: _"Don't use default case so as to catch a missing an element type case. We also don't want to throw, but instead return void so we filter out these unsupported elements from the restored array."_ The intent is exhaustiveness; the compiler does not enforce it.

**Decision: ADD `case "panel":`** restoring `panelKind`, `panel`, `posterMode` and `posterFileId`. The shared base restorer needs no change — `...element` at `:423` preserves unknown props, and `floating` is deliberately excluded from the `Required<>` base at `:345-349` so it is not auto-set, but it survives the spread.

**This is the one failure mode that would make a panel appear to work in the editor and then vanish on reload.** It must be fixed before any panel code exists.

### `packages/excalidraw/data/json.ts` — `serializeAsJSON`

No type filter; a panel serialises as-is. **No change needed** — but it is only _loadable_ if `restore.ts` handles it.

### `packages/excalidraw/data/resave.ts`, `data/reconcile.ts`

No element-type dispatch. A panel's `version`/`versionNonce` flow through unchanged. **No change.**

---

## 3. The type unions

### Must gain `"panel"`

| file:line | union | action |
| --- | --- | --- |
| `packages/element/src/types.ts:219-229` | `ExcalidrawElement` | add `\| ExcalidrawPanelElement` |
| `packages/element/src/types.ts` (new) | `ExcalidrawPanelElement` | new, per the panel design §5.1, with **`posterMode`** not `locked` (**D-33**) |
| `packages/element/src/types.ts:204-212` | `ExcalidrawRectanguloidElement` | **add** — a panel is rectangular |
| `packages/element/src/types.ts:410` | `ExcalidrawElementType` | auto (`ExcalidrawElement["type"]`) |
| `packages/element/src/types.ts:231-234` | `ExcalidrawNonSelectionElement` | auto |
| `packages/excalidraw/types.ts:255` | `ElementOrToolType` | auto |

### Must be decided explicitly, not by accident

| file:line | union | decision |
| --- | --- | --- |
| `packages/element/src/types.ts:136-138` | `ExcalidrawIframeLikeElement` | **reject** — `isIframeLikeElement` gates embed activation (`App.tsx:1372,1446`); a panel must not trigger it |
| `packages/element/src/types.ts:186-188` | `ExcalidrawFrameLikeElement` | **reject** — panels are floating, not frame-owned |
| `packages/element/src/types.ts:193-197` | `ExcalidrawGenericElement` | **reject** — "generic" means no extra props; `newElement()` is typed on this union, so a panel needs its own factory |
| `packages/element/src/types.ts:199-202` | `ExcalidrawFlowchartNodeElement` | **reject** |
| `packages/element/src/types.ts:272-281` | `ExcalidrawBindableElement` | **reject** — an arrow binding to a live DOM surface is meaningless. Record it, do not leave it implicit |
| `packages/element/src/types.ts:283-287` | `ExcalidrawTextContainer` | **reject** |
| `packages/element/src/types.ts:35-38` | `BoundElement["type"]` | **reject** — a panel cannot be an arrow's bound element |
| `packages/element/src/types.ts:453-461` | `ExcalidrawLinearElementSubType`, `Convertible*Types` | **reject** — panels are not convertible |
| `packages/element/src/transform.ts:175-205` | `ExcalidrawElementSkeleton` | **reject** — it is the legacy-converter shape |
| `packages/excalidraw/types.ts:237-253` | `ToolType` | **decide** — a `"panel"` tool only if panels are drag-insertable; otherwise reject and `ElementOrToolType` picks `"panel"` up automatically |
| `packages/element/src/types.ts:87` | `floating?: boolean` | unchanged — a panel **sets** it |

---

## 4. The `floating` flag — the panel needs no new mechanism

**Declaration:** `packages/element/src/types.ts:87`, documented at `:77-86`:

> "Whether this element is **floating**: not owned by its page's coordinate space. A floating element is excluded from 'scale content', may sit outside the page rect, and widens the camera clamp domain to the union of the page rect and the floating elements' bounding box. The flag is opt-in and is never set automatically."

**Every real read site:**

| file:line | what it does | panel relevance |
| --- | --- | --- |
| `packages/element/src/types.ts:87` | declaration | a panel sets `floating: true` |
| `packages/excalidraw/scene/pages.ts:500` | `pageId === pageId && !element.floating` → page-owned | panel excluded from page content |
| `packages/excalidraw/scene/pages.ts:631-634` | `if (element.floating) return element` | panel stays put when the page is re-laid out |
| `packages/excalidraw/scene/pages.ts:705` | page content set |  |
| `packages/excalidraw/scene/pages.ts:831` | "the elements a page owns" |  |
| `packages/excalidraw/scene/pages.ts:946-947` | content reflow does not move it |  |
| `packages/excalidraw/scene/pages.ts:999-1005` | the floating bounding box |  |
| `packages/excalidraw/scene/insertDocument.ts:189` | "the same set the page model calls page-owned" |  |
| `packages/excalidraw/components/App.tsx:4877-4880` | **widens the camera clamp** | a floating panel outside the page must be reachable |
| `packages/excalidraw/data/restore.ts:345-349` | `floating` excluded from the `Required<>` base; preserved by the `...element` spread at `:423` | a panel's `floating: true` survives save→load |

**Conclusion:** the `floating` flag already implements exactly the semantics a panel needs. A panel is created with `floating: true`, and every one of the rows above becomes correct for free.

**Tests that pin the behaviour:** `packages/excalidraw/tests/pages.test.tsx:463-473, 487-507, 624-667, 836-885`.

---

## 5. The type guards (`packages/element/src/typeChecks.ts`, 33 of them)

| file:line | guard | decision | why |
| --- | --- | --- | --- |
| `:244-272` | `isExcalidrawElement` | **HANDLE** — add `case "panel": return true;` | **TS-protected** (`assertNever` at `:268`). Without it the panel is not recognised as an element at all |
| `:196-210` | `isRectanguloidElement` | **HANDLE** — add `"panel"` | not TS-protected; this union drives the distance/segment maths |
| `:214-228` | `isRectangularElement` | **HANDLE** — add `"panel"` | not TS-protected |
| `:396-414` | `isEligibleFrameChildType` | **REJECT** — `false` | `default: return false` at `:410-412`; panels are floating and must not become frame children. **Record it** — it is not TS-protected |
| `:177-194` | `isBindableElement` | **REJECT** | not TS-protected; a panel is not an arrow target |
| `:230-242` | `isTextBindableContainer` | **REJECT** |  |
| `:308-312` | `isUsingAdaptiveRadius` | **REJECT** (`false`) | a panel has no rough border |
| `:314-315` | `isUsingProportionalRadius` | **REJECT** (`false`) |  |
| `:34-38` | `isInitializedImageElement` | **REJECT** | a poster panel is **not** an image element — see §6 |
| `:40-44` | `isImageElement` | **REJECT** | same |
| `:46-50` | `isEmbeddableElement` | **REJECT** |  |
| `:52-56` | `isIframeElement` | **REJECT** |  |
| `:58-64` | `isIframeLikeElement` | **REJECT** | gates embed activation |
| `:66-70` | `isTextElement` | **REJECT** |  |
| `:72-82` | `isFrameElement`, `isMagicFrameElement` | **REJECT** |  |
| `:84-91` | `isFrameLikeElement` | **REJECT** | 77 call sites; adding a panel here would make it frame-like everywhere |
| `:93-103` | `isFreeDrawElement`, `isFreeDrawElementType` | **REJECT** |  |
| `:105-121` | `isLinearElement`, `isLineElement`, `isArrowElement` | **REJECT** |  |
| `:123-150` | `isElbowArrow`, `isSimpleArrow`, `isSharpArrow`, `isCurvedArrow` | **REJECT** |  |
| `:152-158` | `isLinearElementType` | **REJECT** |  |
| `:160-175` | `isBindingElement`, `isBindingElementType` | **REJECT** |  |
| `:274-282` | `isFlowchartNodeElement` | **REJECT** |  |
| `:284-291` | `hasBoundTextElement` | **REJECT** |  |
| `:293-302` | `isBoundToContainer` | **REJECT** | 30 call sites, all about text containers |
| `:304-306` | `isArrowBoundToElement` | **REJECT** |  |
| `:358-371` | `getLinearElementSubType` | **REJECT** |  |
| `:317-338` | `canApplyRoundnessTypeToElement` | depends on the adaptive-radius decision above |  |
| `:340-356` | `getDefaultRoundnessTypeForElement` | same |  |

---

## 6. The poster panel — the twelve image-gated sites

The panel design §5.2 says a poster panel is painted _"exactly as it paints an ordinary image element"_. But a poster panel is **not** an `ExcalidrawImageElement`: it has no `fileId`, no `scale`, no `crop` — it has `posterFileId`. So every site gated on `isImageElement` / `isInitializedImageElement` **will not match a poster panel**:

| file:line | what it does | consequence | decision |
| --- | --- | --- | --- |
| `packages/element/src/renderElement.ts:438-…` | `case "image":` draws the cached image | a poster panel never enters this branch | **HANDLE** — add `case "panel":` drawing `posterFileId` at the panel's bounds |
| `packages/element/src/renderElement.ts:1012-1015` | applies `element.scale` | a panel has no `scale` | **REJECT** |
| `packages/element/src/renderElement.ts:1061-1065` | the uncropped ghost while cropping | does not apply — a poster's crop goes through the **crop modal** | **REJECT**, stated |
| `packages/element/src/renderElement.ts:622-630` | the GIF bail-out | a poster panel must **not** bail out | **REJECT** |
| `packages/element/src/dragElements.ts:333` | `isImageElement` → image drag | a poster panel does not get it | **DECIDE** — does a poster panel drag like an image? |
| `packages/element/src/resizeElements.ts:1420` | `isImageElement` → preserve aspect ratio | a poster panel will not preserve it | **HANDLE** — this is the natural home for the poster rule |
| `packages/element/src/bounds.ts:421-434` | `_isRectanguloidElement` | a poster panel is rectangular | **HANDLE** — add `"panel"` |
| `packages/excalidraw/actions/actionCropEditor.tsx:40` | `isImageElement` → **enable the crop editor** | the crop action is **disabled** for a poster panel | **HANDLE** — the crop entry point must accept a poster panel |
| `packages/excalidraw/components/Stats/Dimension.tsx:36` | `element.type === "image"` → show W×H | a poster panel shows no dimensions | **HANDLE** — show the poster's natural size |
| `packages/excalidraw/renderer/staticSvgScene.ts:437` | `case "image":` embeds the image data | a poster panel **exports as nothing** | **HANDLE** — must embed `posterFileId` |
| `packages/excalidraw/data/restore.ts:513-519` | `case "image":` restores `status`, `fileId`, `scale`, `crop` | a poster panel needs its own restore case | **HANDLE** |
| `packages/excalidraw/scene/animatedImages.ts:71-80` | `getAnimatedImageElements` | a poster panel is not collected → not in the DOM overlay | **REJECT** — correct: the overlay skips it |

**The two ways out, and the trade-off:**

- **(a) Keep `type: "panel"` in both modes** (what the design specifies). Then the twelve branches above are each a chance to forget one. The dispatch-coverage test is the only thing keeping them honest.
- **(b) Make locking produce a real `ExcalidrawImageElement`** and keep the panel as the source of truth elsewhere. Then the twelve sites work unchanged — but the panel stops being a panel after locking, the lock toggle has to re-create it, and the design's _"cropping a poster gives you a copy without destroying the panel"_ becomes awkward.

**(a) is what the design specifies, and (a) is where the gate's value is.**

---

## 7. The geometry, rendering and hit-testing sites

| file:line | what it does | decision | TS? |
| --- | --- | --- | --- |
| `packages/element/src/distance.ts:34-52` | `distanceToElement` | **HANDLE** — add `case "panel":` to the rectanguloid group | ✅ loud |
| `packages/element/src/collision.ts:450-490` | `intersectElementWithLineSegment` | **HANDLE** — same group | ✅ loud |
| `packages/element/src/collision.ts:82-102` | `shouldTestInside` — can the element be grabbed by its interior | **HANDLE** — `true` for a panel, like an image (`:101`) | ❌ silent |
| `packages/element/src/shape.ts:1080-1123` | `getElementShape` — the hit-test shape | **HANDLE** — `case "panel":` in the polygon group | ✅ loud. **Without it the panel is un-selectable** |
| `packages/element/src/shape.ts:774-1004` | `ShapeCache.generateElementShape` | **HANDLE** — return `null` like `frame`/`text`/`image` (`:988-996`) | ✅ loud |
| `packages/element/src/shape.ts:228-264` | `generateRoughOptions` | **HANDLE** — give the panel a case, or `default: throw` fires | ❌ silent (runtime throw) |
| `packages/element/src/renderElement.ts:93-105` | `getCanvasPadding` | **HANDLE** — `default: return 20` is acceptable | ❌ but safe |
| `packages/element/src/renderElement.ts:393-599` | `drawElementOnCanvas` | **HANDLE** — a live panel draws nothing; a poster panel draws its poster | ❌ (`default:` throws at `:597`) |
| `packages/element/src/renderElement.ts:903-921` | **the group that skips animated images** | **HANDLE** — a **live panel must `break` here**, exactly like an animated image | ❌ silent |
| `packages/element/src/renderElement.ts:612-630` | `isAnimatedImageElement` | **HANDLE** — a panel needs its own predicate (live ⇒ skip) | ❌ silent |
| `packages/element/src/transformHandles.ts:290` | linear handles | **REJECT** — a panel gets the default four corners | ❌ silent |
| `packages/element/src/transform.ts:308-330` | arrow start-binding target | **REJECT** — a panel is not bindable | ❌ **soft** assert at `:323` |
| `packages/element/src/transform.ts:384-406` | arrow end-binding target | **REJECT** | ❌ **soft** assert at `:399` |
| `packages/element/src/comparisons.ts:3-10` | `hasBackground` | **REJECT** (`false`) | ❌ silent |
| `packages/element/src/newElement.ts:165-170` | the `newElement` factory | **REJECT** — a panel needs its own `newPanelElement()` | ✅ |
| `packages/element/src/mutateElement.ts` | element mutation | **NO DISPATCH** — type-agnostic | — |
| `packages/element/src/selection.ts:54` | `element.locked \|\| isBoundToContainer` | a panel's base `locked` stays `false` (**D-33**), so it stays selectable | ✅ |
| `packages/element/src/duplicate.ts:264,285,309` | frame-aware duplication | **REJECT** |  |
| `packages/element/src/frame.ts` (11 sites) | frame membership | **REJECT** — panels are floating, never frame children |  |
| `packages/element/src/groups.ts:417` | `!isBoundToContainer` | **REJECT** |  |
| `packages/element/src/sortElements.ts:81,91` | bound-text ordering | **REJECT** |  |
| `packages/element/src/zindex.ts:110,170,262,333,510,518` | z-index rules | **REJECT** |  |
| `packages/element/src/textElement.ts:282,360-510` | container text metrics | **REJECT** |  |
| `packages/element/src/binding.ts:1662,2523,2669,2764` | ellipse/diamond binding offsets | **REJECT** |  |
| `packages/element/src/heading.ts:240` | diamond headings | **REJECT** |  |
| `packages/element/src/flowchart.ts:716` | `el.type === "arrow"` | **REJECT** |  |
| `packages/element/src/sizeHelpers.ts` | `isInvisiblySmallElement` | **HANDLE** — a zero-size panel must not be auto-deleted | ❌ silent |
| `packages/element/src/eraser/index.ts`, `lasso/index.ts` | erase/lasso | **HANDLE** — a panel must be erasable like an image | ❌ silent |
| `packages/element/src/dragElements.ts:269,308` | aspect-ratio maintenance, text drag | **REJECT** |  |
| `packages/element/src/resizeElements.ts:148-1492` | per-type resize branches | **HANDLE** — the generic rect path applies | ❌ silent |
| `packages/element/src/bounds.ts:180,206,364,392` | diamond/ellipse branches | **REJECT** — the panel takes the generic rotated-rect branch | ❌ silent |
| `packages/utils/src/shape.ts:128`, `withinBounds.ts:42` | diamond branches | **REJECT** |  |
| `packages/utils/src/bbox.ts` | bbox helpers | **HANDLE** — a panel is a plain rect |  |
| `packages/excalidraw/renderer/staticSvgScene.ts:142-620` | the SVG export switch | **HANDLE** — see §6 | ❌ silent unless it has a `default` |
| `packages/excalidraw/renderer/interactiveScene.ts:599-653` | the selection outline shape | **HANDLE** — the rect outline | ❌ silent |
| `packages/excalidraw/renderer/interactiveScene.ts:258-312,447,823` | binding indicators | **REJECT** |  |
| `packages/excalidraw/renderer/renderNewElementScene.ts:44` | the in-progress element | **REJECT** |  |
| `packages/excalidraw/scene/animatedImages.ts:71-80` | the overlay's element list | **HANDLE** — a parallel `getPanelElements` |  |
| `packages/excalidraw/scene/animatedImageOverlay.ts:92-118` | the transform chain | **HANDLE** — see §8 |  |
| `packages/excalidraw/scene/animatedImageOverlay.ts:127-140` | the rotated on-screen box | **HANDLE** — reuse |  |
| `packages/excalidraw/scene/animatedImageOverlay.ts:155-188` | the frame clip | **HANDLE** — reuse |  |
| `packages/excalidraw/clipboard.ts:151,341` | frame-like filter, paste-as-text | **REJECT** |  |
| `packages/excalidraw/snapping.ts:188,238` | arrow snap, curve-centre snap | **REJECT** at `:188`; a panel snaps to its rectangle corners at `:238` |  |
| `packages/excalidraw/components/App.tsx:2453-2473` | **the overlay mount** | **HANDLE** — mount a `PanelOverlay` here |  |
| `packages/excalidraw/components/App.tsx:3361-3379` | the `getAnimatedImageElements` memo | **HANDLE** — the panel overlay needs the same stable-reference memo |  |
| `packages/excalidraw/components/App.tsx:675-700` | the `animatedImageElementsCache` field | **HANDLE** — mirror it |  |
| `packages/excalidraw/components/App.tsx:4871-4881` | the camera clamp widened by floating elements | **HANDLE** — a floating panel must be reachable |  |
| `packages/excalidraw/components/App.tsx:1362-1460` | the embed hover/activate path | **REJECT** — a panel must not trigger embed activation, but it must still be hit-tested |  |
| `packages/excalidraw/components/AnimatedImageOverlay.tsx:35-43` | `HOST_STYLE` with `pointerEvents: "none"` | **HANDLE** — the panel host needs `pointer-events: auto` on the panel box, `none` on the host |  |
| `packages/excalidraw/components/AnimatedImageOverlay.tsx:73-85,189-192,236-253` | the memo, the empty guard, the comparator | **HANDLE** — mirror all three |  |
| `packages/excalidraw/components/Stats/Dimension.tsx:36` | natural dimensions | **HANDLE** | ❌ silent |
| `packages/excalidraw/components/ConvertElementTypePopup.tsx:852-900` | the conversion target switch | **REJECT** — panels are not convertible | ✅ loud |
| `packages/excalidraw/actions/actionCropEditor.tsx:40` | enable the crop editor | **HANDLE** |  |
| `packages/excalidraw/actions/actionProperties.tsx` (5 sites) | the per-type property panel | **HANDLE** — the panel's chrome needs a home |  |
| `packages/excalidraw/actions/actionAddToLibrary.ts:21` | may a panel be added to the library | **DECIDE** — a live surface probably should not; a poster might |  |
| `packages/excalidraw/actions/actionAlign.tsx:51`, `actionDistribute.tsx:44` | align/distribute | **REJECT** (no change needed) — a panel is a normal positionable element |  |
| `packages/excalidraw/actions/actionReformatSelection.ts:41` | `element.type === "text"` | **REJECT** |  |
| `packages/excalidraw/actions/actionClipboard.tsx:281` | copy-as-text | **REJECT** |  |
| `packages/excalidraw/tests/helpers/api.ts:300-390` | builds a test element of a given type | **HANDLE** — add a `"panel"` case, or no panel can be created in any test | ✅ loud |
| `excalidraw-app/sidebar/table.ts:304`, `reformat.ts:33` | text-only checks | **REJECT** |  |
| `excalidraw-app/presenter/PresenterView.tsx:277-290`, `usePresenterBroadcaster.ts:202-225` | presenter message switches | **REJECT** — but the presenter must gain the panel overlay |  |

---

## 8. The overlay the panel must mirror

| file:line | what it does | what the panel needs |
| --- | --- | --- |
| `packages/element/src/renderElement.ts:903-921` | the canvas **skips** animated images | a **live panel must `break` here.** The comment at `:917-919` says it has to bail out _before_ the if/else, because that if/else bakes in a single frame |
| `packages/excalidraw/scene/animatedImageOverlay.ts:85-118` | `animatedImageTransform` — the CSS transform chain | **do not copy it** — see **D-34**. The panel computes its position with `sceneCoordsToViewportCoords` (`packages/common/src/utils.ts:468-487`) and subtracts the container offset, the way `ElementCanvasButtons.tsx:27-28` does |
| `packages/excalidraw/scene/animatedImageOverlay.ts:127-140` | `animatedImageViewportRect` — rotation-aware | **reuse** — a clip built from the unrotated box cuts a rotated panel's corners off |
| `packages/excalidraw/scene/animatedImageOverlay.ts:155-188` | the frame clip, `OUTSIDE_FRAME` | **reuse** |
| `packages/excalidraw/components/AnimatedImageOverlay.tsx:35-43` | `HOST_STYLE` | **reuse, except `pointerEvents`** — the GIF host is `none`; a live panel is interactive |
| `packages/excalidraw/components/AnimatedImageOverlay.tsx:194-200` | the host style is **inline**, not from a stylesheet | **copy that** — the comment says an overlay that took clicks would break selecting, dragging and the eraser |
| `packages/excalidraw/components/AnimatedImageOverlay.tsx:73-85` | the `useMemo` on the camera | **mirror** — the camera is rebuilt on every state change; only its fields matter |
| `packages/excalidraw/components/AnimatedImageOverlay.tsx:236-253` | the value-comparing comparator | **mirror** — keyed on the panel set, not on every scene change |
| `packages/excalidraw/components/App.tsx:2449-2450` | `animatedImageFileIds` → the "needs live repaint" signal | **HANDLE** — a panel needs the same signal or it will never repaint |
| `packages/excalidraw/css/styles.scss:8,134,150` | `--zIndex-animatedImages: 2` | a panel needs its own z-index, **above** the animated-image layer |

**The two GIF limitations a panel inherits or escapes** (the animated-image overlay's own comments, `:169-177`):

1. _Everything on the canvas is a single raster, so a GIF drawn here always sits above the elements painted after it, whatever their z-order._ A panel has the same problem and is **worse off**: its content is interactive, so a z-order mistake is visible, not cosmetic.
2. _The overlay is viewport-space: it tracks the camera; it is not placed at a scene coordinate._ The panel escapes this by using the oracle (**D-34**).

**The oracle rule**, from `packages/excalidraw/tests/animatedImageOverlay.test.ts:1-13`:

> "Every positional assertion here goes through `sceneCoordsToViewportCoords` … and through the transform string the implementation actually produces, parsed and applied with plain matrix maths. That combination is deliberate: it is the only way to catch the class of bug this whole feature exists to fix, which is a transform that is internally self-consistent but disagrees with the renderer about which way is 'right'."

The panel's test must do the same.

---

## 9. The open questions, and how they were answered

1. **`locked` collides with the base element's `locked`.** → **D-33**: the panel's discriminator is **`posterMode`**, and the base `locked` stays `false` in both modes.
2. **The overlay's positioning convention.** → **D-34**: `sceneCoordsToViewportCoords` minus the container offset, never a hand-derived transform.
3. **Is a live panel exported?** → **the panel design's answer stands**: export produces the poster, and a live panel has no poster until it is locked. The code has no path for an on-the-fly capture — `renderElement.ts` skips the element entirely. A live panel therefore exports as **nothing**, and that must be documented in the panel's own UI.
4. **Is there a `"panel"` tool?** → **decide in the wave**: if panels are placed from a sidebar action only, `ToolType` needs no change. If there is a drag-to-place tool, `ToolType` needs `"panel"` and `Actions.tsx`, `MobileToolBar.tsx`, `HintViewer.tsx` and `cursor.ts` all need a case.
5. **Can an arrow bind to a panel?** → **no** (the `isBindableElement` decision above). A panel that is not bindable is simply never reached by the binding code.
6. **Can a panel be a frame child?** → **no** (`isEligibleFrameChildType` returns `false`).
7. **Can a panel be added to the library?** → **decide in the wave**: a live surface in a shared library is not meaningful; a poster might be.
8. **The `panel` payload must survive save→load.** → `data/restore.ts:450` must gain a `case "panel":` — see §2. **This is the highest-value single fix, and it is needed before any panel code exists**, or the round-trip test fails at the very first save.
9. **`packages/element/src/restore.ts` does not exist.** → the design must reference `packages/excalidraw/data/restore.ts` instead.
10. **The presenter's panel surface** → the presenter is a **second Excalidraw instance** (`excalidraw-app/presenter/PresenterView.tsx`), so it needs its own `getPanelElements` and its own overlay. It lives in `excalidraw-app/`, which the §8 gate does not obviously cover — **so the presenter's panel surface is explicitly in scope for the foundation wave.**

---

## 10. The dispatch-coverage test

The gate's value is a test that keeps the decisions honest. Two things it must do:

1. **Every "HANDLE" row in §2–§7 is actually implemented.** The cheapest honest form: a test that walks the element-type switches the checklist names and asserts each one has a `"panel"` case (or is on the record as a deliberate reject).
2. **`restoreElements` round-trips a panel.** Save → load → the panel is still there, with its `panelKind`, `panel` payload, `posterMode` and `posterFileId` intact. **This is the test that would have caught §2's silent drop.**

And the standing rule for the whole wave: **assert through the library's own functions.** The `floating` sites go through `getCommonBounds`; the geometry goes through `sceneCoordsToViewportCoords`; the page sites go through `getPageRect`. A self-consistent-but-wrong implementation must not be able to pass.
