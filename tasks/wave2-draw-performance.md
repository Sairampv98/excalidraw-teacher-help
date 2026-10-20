---
id: wave2-draw-performance
paths: packages/common,packages/element,packages/excalidraw,SPEC.md
read: SPEC.md,docs/superpowers/specs/2026-10-20-draw-performance-design.md,AGENTS.md,HANDOVER.md
base: main
status: merged
---

Fix item 3: the pen tool produces broken, segmented curves instead of smooth strokes.

SYMPTOM, reported by the user on 2026-10-20:
After drawing a few elements with the pen, smooth curves start coming out as
multiple small disconnected line segments instead of one smooth stroke. The
user noticed it after adding some text, but text is NOT the cause - see
CAUSE 3 below.

ROOT CAUSE (established by an earlier investigation - verify each claim against
the code in this worktree before relying on it; line numbers may have moved):

CAUSE 1 - the pointer samples are thrown away. This is the real cause.
  packages/common/src/utils.ts, the throttleRAF function (around line 155):
  it overwrites its pending arguments on every call and schedules one rAF, so
  when the frame fires it runs the handler ONCE with the LATEST arguments.
  Every intermediate pointer position is discarded. At most one point is
  recorded per animation frame.
  The free-draw branch in packages/excalidraw/components/App.tsx (around
  line 10667) appends one point per handler invocation, so the number of
  points in a stroke equals the number of FRAMES, not the number of samples
  the device produced. When the frame rate drops, the stroke is recorded
  with fewer, farther-apart points - a polyline with visible corners. The
  streamline pass in packages/element/src/shape.ts (around line 1191)
  smooths the points it is given but cannot invent the missing ones.

  The fix is to recover the discarded samples. The browser already keeps
  them: a PointerEvent exposes getCoalescedEvents(), which returns every
  sample the device produced for that dispatch. The pointermove handler is
  registered as a native window listener (App.tsx around line 8433), so it
  receives a real native PointerEvent.

CAUSE 2 - an O(n squared) bounding box per frame.
  packages/element/src/mutateElement.ts, getSizeFromPoints (around line 73),
  and packages/common/src/points.ts: it computes the bounds with
  Math.max(...xs) and Math.min(...ys) style spreads over the whole points
  array, on every frame, while the array grows. That is O(n) per frame and
  O(n squared) over a stroke. It also allocates two arrays per call, and a
  spread over a very long array can blow the argument limit.
  packages/element/src/bounds.ts getBoundsFromPoints (around line 683)
  already does it correctly in a single pass - use that as the model.

CAUSE 3 - per-frame scans of the whole scene (contributes to the frame drops).
  - updateEmbeddables, App.tsx around lines 1543-1576, filters ALL elements
    on every componentDidUpdate.
  - syncAnimatedImageFileIds, App.tsx around lines 3252-3267, loops over the
    visible elements and builds a new Set on every render.
  - getAnimatedImageElements, App.tsx around lines 2390-2394, allocates a NEW
    array on every render, so the AnimatedImageOverlay gets a new prop and
    re-renders every frame. The overlay is not wrapped in React.memo.
  These are the reason the frame rate collapses as a document grows, which is
  what makes CAUSE 1 visible in the first place.

  NOTE on text: the user believes text elements made it worse. That is not
  the cause and must not be fixed. During a stroke the static canvas is NOT
  re-rendered: the mutation uses informMutation:false, so Scene.triggerUpdate
  is skipped (packages/element/src/Scene.ts around lines 434-442), canvasNonce
  stays stable, and the memoised scene is a cache hit. Text's real cost is
  memory (one offscreen canvas per text element,
  packages/element/src/renderElement.ts around lines 204-226) and one
  drawImage per text element per repaint. Say so plainly in your report
  rather than changing text handling.

READ FIRST:
1. SPEC.md - the locked decisions. Do not change D-7, D-12, or the Wave 1
   and Wave 2a rows.
2. docs/superpowers/specs/2026-10-20-draw-performance-design.md - the full
   design, including the options that were rejected and why.
3. AGENTS.md and HANDOVER.md - the project rules.
4. packages/common/src/utils.ts throttleRAF, and
   packages/excalidraw/tests/ for the test style.

SCOPE: packages/common, packages/element, packages/excalidraw, SPEC.md.

ACCEPTANCE ROWS TO ADD:
Add rows to SPEC.md in the existing format
(| AC-n | <label> | <check-file> | <detail> |), each naming its check file
and mentioning its own id:
- AC-13, check file packages/common/src/utils.test.ts: the pointer-sample
  helper returns EVERY sample the browser coalesced, not just the last one,
  and falls back to the single event when getCoalescedEvents is absent.
- AC-14, check file packages/excalidraw/tests/pages.test.tsx: a free-draw
  stroke built from N coalesced samples keeps all N points.
- AC-15, check file packages/element/tests/element.test.ts or the closest
  existing file: getSizeFromPoints returns the same bounds as before, and
  does so in a single pass - the property must be unchanged, only the cost.
Every test must mention its row id in the test name, or the kit SPEC lint
fails the gate.

HARD CONSTRAINTS - these are test-harness facts, not opinions:
- setupTests.ts (around lines 19-26) REPLACES throttleRAF with mockThrottleRAF
  (tests/helpers/mocks.ts around lines 13-24), which calls the handler
  SYNCHRONOUSLY. So in the test environment the throttle is a no-op, and a
  test that relies on the throttle dropping samples cannot work. Test the
  SAMPLE EXTRACTION as a pure function instead - that is where the behaviour
  lives, and it is testable deterministically.
- jsdom 22.1.0 has NO window.PointerEvent. @testing-library/dom falls back
  to window.Event. So a test that exercises getCoalescedEvents must build
  the event itself and attach a getCoalescedEvents method. Feature-detect
  and test the fallback path as well.
- Do not add a dependency.

REQUIRED:
- One helper that extracts the coalesced samples from a pointer event, used
  by the free-draw path.
- The free-draw path must append EVERY sample, and the recorded pressure
  array must stay aligned with the points array.
- getSizeFromPoints must keep its current results exactly, and must not
  scale quadratically with the length of the stroke.
- The per-frame whole-scene scans should stop running on every frame. Do
  not change what they compute - only when they run.
- Multi-point and free-draw behaviour that the existing tests cover must
  not change. Note that the free-draw shape generation (shape.ts) and the
  streamline pass must keep producing the same result for the same input.

TESTING DISCIPLINE (the project rule):
- Oracle-based assertions: assert through the library's own conversion
  functions, never by re-deriving a formula inside the test.
- Teeth: for each fix, revert it and confirm the matching test FAILS, then
  restore it. Report each one. A test that cannot fail protects nothing -
  and a test that only fails under load is itself a flake, not a test.
- There are known-flaky files: MermaidToExcalidraw.test.tsx and
  scene/export.test.ts. Both were fixed on 2026-10-20, but if either
  fails, re-run it in isolation before believing it.

FEEDBACK:
  node scripts/rowcheck.mjs AC-13 AC-14 AC-15
  node scripts/rowcheck.mjs --all
  node scripts/tins-gate.mjs
Never run `yarn test:app` without `--watch=false` - it is bare vitest and
enters watch mode and never exits. Run the full suite before you report.

RULES:
- Commit your work. The harness records the session from git.
- Do NOT run `kit gate`, `kit close` or `kit merge`. The harness closes the
  session; closing it yourself ends the session before your work is in it.
- When you change behaviour, change the matching SPEC.md row too.
- If a decision in SPEC.md is wrong or unimplementable, say so in your
  report rather than working around it.

REPORT (max 300 words):
- AC-13, AC-14, AC-15: green or not, with the exact test names.
- The final `rowcheck --all` output.
- The teeth checks you performed and what happened when you reverted each fix.
- Whether the number of points in a stroke now tracks the device samples,
  and how you verified it.
- Whether the per-frame whole-scene scans were actually removed from the
  per-frame path, and how you measured that.
- Any correction to the file:line references above.
- Nothing else.
