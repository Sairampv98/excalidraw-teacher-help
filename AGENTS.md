# AGENTS.md

**Read [HANDOVER.md](./HANDOVER.md) first.** It has the full picture: project layout, the verification gate, the Windows→WSL migration checklist, the map of this fork's custom features, and the traps that have already cost time here.

This file is the short version, for harnesses that only read `AGENTS.md` (opencode and most other CLI agents). `CLAUDE.md` covers the same ground for Claude Code.

---

## What this project is

A heavily modified fork of Excalidraw (Yarn 1 monorepo, `packages/*` + `excalidraw-app`). It is **not** upstream Excalidraw. Custom features that will look alien unless you know about them:

- a **pages system** with a per-page camera (`packages/excalidraw/scene/pages.ts`)
- a **document sidebar** that pastes markdown/PDF code onto the canvas (`excalidraw-app/sidebar/`)
- **code cards** as real syntax-highlighted text elements (`excalidraw-app/sidebar/codeCard.ts`)
- **multi-page PDF export** (`excalidraw-app/pages/pdf.ts`)
- a **GIF overlay** that draws animated images as DOM `<img>`s _instead of_ painting them onto the canvas (`packages/excalidraw/components/AnimatedImageOverlay.tsx`)
- **handwriting recognition** with two engines — Chromium's native API, and a local ONNX model that is **off by default** because `onnxruntime-web` is not installed (`packages/excalidraw/handwriting/`)

Details and file paths for all of these are in `HANDOVER.md` §2.

---

## Non-negotiables

**1. Verify before you claim done.** All four gates must pass:

```bash
yarn test:typecheck   # tsc                        → 0 errors
yarn test:code        # eslint --max-warnings=0    → 0 warnings
yarn test:other       # prettier --list-different  → lists nothing
yarn test:app         # vitest                     → 0 failures
```

`yarn test:all` runs all four. Current baseline: **1606 passed, 0 failed**, 120 files. `yarn test:update` rewrites snapshots — only when a snapshot change is the point.

Note `yarn test:other` only covers non-`.ts`/`.tsx` files; TS formatting is enforced by ESLint via `eslint-plugin-prettier`, so `yarn test:code` covers it.

**2. This repo's tests encode fork-specific behaviour.** They are the specification. Do not "fix" a failing test to match upstream Excalidraw.

**3. New tests must have teeth.** Write the assertion, then break the code it guards and confirm the test _fails_. A test that cannot fail protects nothing. Prefer oracle-based assertions — assert through the library's own conversion (`sceneCoordsToViewportCoords`), not a re-derivation of the formula in the test, or an implementation that is self-consistently wrong will pass.

**4. LF line endings, no BOM.** All 886 source files are LF. Keep it that way. If you must write files from a shell, note that PowerShell 5.1's `Set-Content -Encoding UTF8` **writes a BOM** — use `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.

**5. Use `yarn`, not npm or pnpm.** Yarn 1.22.22, pinned in `packageManager`. `yarn.lock` is authoritative; `package-lock.json` is gitignored.

**6. Do not add dependencies** without a strong reason and an explicit explanation.

---

## Traps that have already bitten

- **`getElementAbsoluteCoords` returns the _unrotated_ box.** The renderer applies rotation on top of it. For rotated geometry, the correct oracle is `getElementBounds`.
- **To skip a branch you must skip _both_ branches.** The renderer's `if/else` offers a live draw and a raster cache; inverting one condition still executes the `else`. Use an early `break`.
- **Chromium only advances a GIF's frame clock while the image is genuinely visible.** No hidden host, small size, or low opacity will make a GIF animate — the full measured matrix is in `packages/element/src/image.ts` and `HANDOVER.md` §4.3. Do not re-derive this; do not resurrect a repaint ticker.
- **PowerShell 5.1 has no `&&` / `||`.** Use separate statements and check `$LASTEXITCODE`.

---

## Environment

Node ≥ 18 (local: v22.23.2, Dockerfile: node:24), Yarn 1.22.22.

```bash
yarn install
cd excalidraw-app && yarn vite --no-open --port 3000
```

Use `--no-open`: `yarn start` runs `vite` without it, which tries to open a browser and misbehaves under WSL.

Known pre-existing flakes under parallel load (pass in isolation — do not chase): `MermaidToExcalidraw.test.tsx` (a _different_ test in that file fails each run), and `packages/excalidraw/tests/scene/export.test.ts`. There is also one obsolete snapshot, `exportToSvg > with a CJK font 2`.
