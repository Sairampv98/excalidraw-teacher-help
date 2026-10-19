# Handover — excalidraw fork → WSL CLI-agent harness

Prepared 2026-10-19, on Windows (`C:\Users\user\Desktop\NITTE - C\excalidraw`), for handover to a WSL-based CLI agent harness (opencode, Claude Code, etc.).

Everything below was **measured on this working tree**, not assumed. Where a claim is an inference rather than a measurement, it says so.

---

## 0. Read this first: there is no git repository

This is the single most important fact about the handover.

```
$ git rev-parse --is-inside-work-tree
fatal: not a git repository (or any of the parent directories): .git   # exit 128
```

Checked and confirmed absent at every level:

| path             | `.git` present |
| ---------------- | -------------- |
| `excalidraw/`    | no             |
| `NITTE - C/`     | no             |
| `Desktop/`       | no             |
| `C:\Users\user\` | no             |

Git itself **is** installed (`git version 2.54.0.windows.1`), and a `.gitignore` is present (30 lines, upstream Excalidraw's). But there is no repository.

### What that means

Every change made so far was applied **directly to the working tree**. There are no commits, no branches, no tags, no reflog, no stash, and no diff to read. Concretely, the incoming agent inherits:

- **No baseline.** There is no "before" to compare against. It cannot see what this fork changed relative to upstream Excalidraw, and it cannot see what changed between two of its own edits.
- **No rollback.** A bad edit cannot be undone with `git checkout`. There is no safety net at all.
- **No review surface.** `git diff` — the single most-used tool for reviewing an agent's work — does not work here.
- **No provenance.** The only record of intent is the code, the test suite, and the chat transcripts.

### Do this before anything else

```bash
cd /path/to/excalidraw
git init
git add -A
git commit -m "chore: baseline — pre-handover snapshot of the working tree"
```

That single commit is the rollback point the whole rest of this document assumes exists. Without it, the new agent is editing blind.

Then, and only then, read the rest of this file. A few extra notes:

- `git init` creates branch `master` by default. `git branch -m main` if you want the conventional name.
- The baseline commit will be **large** — it is the whole tree, not a diff. That is expected and fine; it is a snapshot, not a change.
- After `git init`, re-run `yarn install` so husky wires up the hooks (see §3.5). `yarn install` is safe _before_ `git init` too — husky v7 detects the missing repo and exits 0 — so the order is a convenience, not a requirement.

### One thing to exclude from the baseline: `htr-sandbox/`

The repo root contains an `htr-sandbox/` directory that has **nothing to do with the Excalidraw fork** — it is a handwriting-recognition experiment (ONNX models, its own `package.json`, its own `node_modules`).

**Measured: 554 files, ~285 MB**, of which most is `model.onnx` (17 MB), `model-small.onnx` (8 MB) and a nested `onnxruntime` install with `.dll` / `.so` / `.dylib` binaries for every platform.

It was **not** in `.gitignore`, so `git add -A` would have committed 285 MB of model binaries — a slow, ugly first commit that is painful to clone from WSL. It has now been added to `.gitignore`:

```
htr-sandbox/
```

The directory is **still on disk** — nothing was deleted. If you want it tracked after all, drop that line from `.gitignore`. If it is genuinely dead, delete it separately; that is a judgement call for you, not something to settle silently.

Note also that `htr-sandbox/README.md` and `htr-sandbox/test.html` fail `yarn test:other` (prettier) — pre-existing, and now out of scope for the gate.

---

## 1. Project shape

Monorepo, **Yarn 1 classic** (not Berry), workspaces.

```
excalidraw/                     repo root
├── packages/
│   ├── common/                 @excalidraw/common
│   ├── element/                @excalidraw/element
│   ├── excalidraw/             @excalidraw/excalidraw   ← the library
│   ├── math/                   @excalidraw/math
│   ├── utils/                  @excalidraw/utils
│   └── fractionation-indexing/
├── excalidraw-app/             the web app (excalidraw.com)
├── examples/                   integration examples
├── vitest.config.mts           path aliases for the workspace
├── package.json                root workspace + all scripts
├── CLAUDE.md                   agent instructions (read by Claude Code)
├── AGENTS.md                   short agent instructions (read by opencode etc.)
└── HANDOVER.md                 this file
```

### Toolchain (measured)

| tool | version | note |
| --- | --- | --- |
| node | **v22.23.2** | `engines` requires `>=18`; the Dockerfile uses `node:24` |
| yarn | **1.22.22** | pinned via `packageManager: "yarn@1.22.22"` — use `yarn`, not `npm`/`pnpm` |
| npm | 10.9.8 | present, but do not use it to install |
| git | 2.54.0.windows.1 | installed, but **no repo** — see §0 |

`package-lock.json` is gitignored on purpose. `yarn.lock` is committed and authoritative. Use `yarn install --frozen-lockfile` in CI-like contexts.

### Commands

```bash
# from the repo root
yarn install
yarn start                       # = yarn --cwd ./excalidraw-app start  → "yarn && vite"

# run the app without opening a browser (recommended under WSL)
cd excalidraw-app && yarn vite --no-open --port 3000
```

`yarn start` runs `yarn && vite` — it re-installs and then **opens a browser**. Under WSL that open usually fails noisily or silently does nothing; use `--no-open` and browse to `http://localhost:3000` from Windows.

### The verification gate

Run all four before considering any change done. This is the project's rule (`CLAUDE.md`) and it is the only signal the incoming agent will have.

```bash
yarn test:typecheck   # tsc                              → must be 0 errors
yarn test:code        # eslint --max-warnings=0 --ext ... → must be 0 warnings
yarn test:other       # prettier --list-different        → must list nothing
yarn test:app         # vitest                           → must be 0 failures
```

Or all at once: `yarn test:all`.

**Current state (measured 2026-10-19): `1606 passed, 48 skipped, 1 todo, 0 failed`, across 120 test files.** Take that as the baseline; a red suite on arrival means something got broken in transit, not that the suite is flaky.

Two details that are easy to get wrong:

- `yarn test:other` only covers `**/*.{css,scss,json,md,html,yml}` — the `prettier` script's own glob. **`.ts`/`.tsx` formatting is enforced by ESLint** via `eslint-plugin-prettier`, so `yarn test:code` covers it. Running only `yarn test:other` gives a false green.
- `yarn test:update` (`vitest --update --watch=false`) rewrites snapshots. It is required when a change is _meant_ to alter a snapshot, and a sign of something going wrong when it isn't.

### The gate was red on arrival — now green

Worth knowing, so the incoming agent does not assume it broke something.

`yarn test:code` (`eslint --max-warnings=0`) was **already failing before this handover**, with 20 warnings across 7 files, all from the handwriting feature and two type files:

```
 8  packages/excalidraw/handwriting/handwriting.test.ts
 4  packages/element/src/types.ts
 2  packages/excalidraw/handwriting/ctc.ts
 2  packages/excalidraw/appState.ts
 2  packages/excalidraw/handwriting/apiRecognizer.ts
 1  packages/excalidraw/handwriting/strokes.ts
 1  packages/excalidraw/handwriting/index.ts
```

All of them were prettier/import-order noise, and all have now been auto-fixed, so the gate is **0 warnings, 0 errors** repo-wide. `htr-sandbox/` was also added to `.eslintignore` (see §0) — it was contributing its own warnings from the `onnxruntime-web` sources sitting in it.

You will still see this on stderr during `yarn test:code`:

```
The prop value with an expression type of MetaProperty could not be resolved.
Please file an issue ( https://github.com/jsx-eslint/jsx-ast-utils/issues/new )
```

That is a **plugin limitation being printed, not a lint failure**. The gate still exits 0. Ignore it.

### Known pre-existing flakes

Do not chase these; they fail under parallel load and pass in isolation.

- `packages/excalidraw/tests/MermaidToExcalidraw.test.tsx` — _a different test in this file fails each run_, which is the flake signature, not a regression.
- `packages/excalidraw/tests/scene/export.test.ts`

There is also one **obsolete snapshot** left over from earlier work: `exportToSvg > with a CJK font 2`. It is debris, not a failure.

---

## 2. This is a heavily modified fork — do not treat it as upstream

The incoming agent will read these files and they will look alien next to upstream Excalidraw. This map is the difference between "why is there a `pages.ts`?" and "ah, this fork has a pages system."

| Feature | Where | Notes |
| --- | --- | --- |
| **Pages system** | `packages/excalidraw/scene/pages.ts` | Multiple pages, per-page camera, page rects, page-relative camera. Consumed by `excalidraw-app/sidebar/useSidebarLayout.ts` and `excalidraw-app/presenter/presenterChannel.ts`. |
| **Page bar UI** | `excalidraw-app/components/PageBar.tsx` | Page switcher in the bottom toolbar. |
| **Document sidebar** | `excalidraw-app/sidebar/DocumentsTab.tsx`, `sidebarFiles.ts`, `FolderTab.tsx`, `useSidebarLayout.ts`, `sidebar.scss` | Sidebar that lists markdown/PDF docs and lets you paste code onto the canvas. |
| **Code cards** | `excalidraw-app/sidebar/codeCard.ts` (was `codeImage.ts`), `insertIntoScene.ts` | Pasted code becomes **real syntax-highlighted text elements**, not a raster. Each card gets its own `randomId()` group so they resize independently. No filename header. |
| **Multi-page PDF export** | `excalidraw-app/pages/pdf.ts`, `exportPages.ts` | Dependency-free PDF writer. Exports all pages as one multi-page PDF. |
| **Animated image (GIF) overlay** | `packages/excalidraw/components/AnimatedImageOverlay.tsx`, `packages/excalidraw/scene/animatedImages.ts`, `packages/excalidraw/scene/animatedImageOverlay.ts` | GIFs are **not painted onto the canvas**; they are real visible `<img>`s layered over it. See §4.3 — this one is counter-intuitive and worth reading before touching the renderer. |
| **Presenter integration** | `excalidraw-app/presenter/*` | Uses `getPageRelativeCamera` to mirror the camera into the presenter window. |
| **Handwriting recognition** | `packages/excalidraw/handwriting/*` | Engine-agnostic `Recognizer` interface with two engines: `apiRecognizer` (Chromium's native Handwriting Recognition API) and `htrRecognizer` (local ONNX CRNN via `onnxruntime-web`, CTC-decoded by `ctc.ts`). The HTR engine is **off by default** — `onnxruntime-web` is not installed, so `isAvailable()` resolves false and selection falls back to the browser API. Enabling it means `yarn add onnxruntime-web` and shipping a model whose URL is passed in via the `htrModelUrl` preference. `htr-sandbox/` (§0) is the scratch area where that model was produced and tuned; **no app source references it**. |

### The one bug that had a single root cause

Four separate user-reported symptoms (zoom always jumping to one spot, panning only going up/left, pastes landing off to the left on page 2+, and the GIF landing off-page) were all **one bug**: `packages/excalidraw/scene/pages.ts` treated `scrollX`/`scrollY` as plain scene coordinates, but the renderer uses `viewportX = (sceneX + scrollX) × zoom` — scroll is a **negated** offset.

It was invisible on page 1 (whose `x` is 0, so the sign cancels) and severe everywhere else. The fix was to correct the sign convention rather than special-case the symptoms. The authoritative conversion lives in `packages/common/src/utils.ts` (`sceneCoordsToViewportCoords` / `viewportCoordsToSceneCoords`) — **that one was always correct**; only `pages.ts` was wrong.

---

## 3. Windows → WSL migration checklist

### 3.1 The path contains a space — move the project

```
C:\Users\user\Desktop\NITTE - C\excalidraw
```

Under WSL this becomes:

```
/mnt/c/Users/user/Desktop/NITTE - C/excalidraw
```

A space in the path breaks a depressing number of CLI tools — shell quoting in scripts, `node -e` one-liners, `npx` argument parsing, some Vite/esbuild config loaders, and most `find`/`xargs` invocations.

**Recommendation: copy the tree into a space-free path inside WSL.**

```bash
mkdir -p ~/projects
cp -a "/mnt/c/Users/user/Desktop/NITTE - C/excalidraw" ~/projects/excalidraw
cd ~/projects/excalidraw
```

`cp -a` preserves timestamps and permissions. Do **not** copy it onto the same path with `cp -r` while `node_modules` is present — see §3.2, you are going to delete it anyway.

### 3.2 `node_modules` must be reinstalled, not copied

`node_modules/` is present and contains **Windows-native binaries**:

```
node_modules/@esbuild
node_modules/esbuild
node_modules/rollup
node_modules/@rollup
node_modules/vite
```

These are `.exe`/`.node` builds for win32-x64. Copied into WSL they will not load, and the build fails with errors like:

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu
```

The repo's own `Dockerfile` already documents this failure mode:

```dockerfile
# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
```

So: **delete `node_modules` and reinstall inside WSL.**

```bash
cd ~/projects/excalidraw
rm -rf node_modules excalidraw-app/node_modules packages/*/node_modules
yarn install
```

(Yarn 1 hoists most of it to the root; removing the nested ones too is cheap insurance. `yarn rm:node_modules` in `package.json` does exactly this with `rimraf`.)

### 3.3 Line endings: keep them LF, and pin it

**Measured: all 886 source files in this tree are LF, with no BOM.** Nothing has CRLF. That is the correct state and it should stay that way.

The risk on the Windows↔WSL hop is `core.autocrlf`. If a Windows-side git client has `core.autocrlf=true` and touches the tree, git rewrites every LF file to CRLF on checkout — and then **every single file in the repo shows as modified** in `git status`. That looks like catastrophic damage and is not; it is a line-ending setting.

Defence, in this order:

1. **Add a `.gitattributes`** (it does not exist yet — worth creating before the first commit so the baseline is already pinned):

   ```gitattributes
   * text=auto eol=lf
   *.png binary
   *.jpg binary
   *.gif binary
   *.ico binary
   *.woff binary
   *.woff2 binary
   *.pdf binary
   ```

   `* text=auto eol=lf` forces LF in the working tree regardless of platform and normalises on commit. It is the single most valuable line in this document for a Windows↔Linux handover.

2. **Set the config on both sides:**

   ```bash
   # WSL (and any Linux CI)
   git config --global core.autocrlf false
   git config --global core.eol lf

   # Windows
   git config --global core.autocrlf input
   ```

3. If a CRLF storm ever happens anyway:

   ```bash
   git config core.autocrlf false
   git add --renormalize .
   git commit -m "chore: renormalise line endings to LF"
   ```

### 3.4 Case sensitivity changes

On `/mnt/c` (DrvFs) the filesystem is **case-insensitive**, exactly like Windows. In `~/projects` on ext4 it becomes **case-sensitive**.

Today the codebase's import specifiers are all lowercase (`@excalidraw/element/types`, `packages/excalidraw/scene/pages.ts`) and the workspace aliases in `vitest.config.mts` are lowercase, so this should be inert. But it is a real class of latent bug: an import written `@excalidraw/Element/types` would work on `/mnt/c` and fail in `~/`. Once you are on ext4, run the full gate (§1) and treat any "cannot find module" as a casing problem before assuming something else.

### 3.5 husky hooks

The repo has `husky@7.0.4`, a `.husky/pre-commit`, and a root `"prepare": "husky install"` script — which runs automatically on every `yarn install`.

Two facts, both verified by reading `node_modules/husky/lib/index.js`:

- `husky install` **does not fail** when there is no git repo. It runs `git rev-parse`, and if that fails it simply `return`s with status 0. So `yarn install` is safe both before and after `git init`.
- The `.husky/pre-commit` body is **entirely commented out**:

  ```sh
  #!/bin/sh
  # yarn lint-staged
  ```

  So **no hook actually enforces anything**. The project rule "run `yarn test:update` before committing" is a convention, not a gate. The incoming agent has to hold itself to it manually.

After `git init`, run `yarn install` once so `core.hooksPath` gets pointed at `.husky`.

### 3.6 Other WSL specifics

- **File watching.** Vite's watcher over `/mnt/c` is slow and sometimes misses events (inotify does not work well on DrvFs). If HMR stops firing, this is the cause — and the fix is exactly §3.1: keep the repo on ext4.
- **Ports.** `localhost:3000` from Windows reaches a WSL2 server by default (WSL2 localhost forwarding). If it does not, get the WSL IP with `hostname -I` and browse to that instead. Do **not** run a second dev server on a port the user already has open — a previous 3000 instance was killed three times by a 1-hour background-task cap for exactly this reason.
- **Native tooling.** If a Linux-native binary is needed (`esbuild`, `sharp`, `playwright`), install it under WSL, never reuse the Windows copy.
- **Case of the `Dockerfile`**: it targets `node:24` while the local toolchain is node 22. Not a problem for dev, but the container is not the same runtime you are testing on.

---

## 4. Things the incoming agent will get wrong if it does not know them

### 4.1 The app is a fork, and the tests encode its behaviour

`packages/excalidraw/tests/pageCamera.test.ts` and `excalidraw-app/tests/sidebarLayout.test.ts` assert **this fork's** semantics. Do not "fix" them to match upstream Excalidraw — they are the specification.

The tests in this project follow a deliberate pattern worth continuing:

- **Oracle-based assertions.** Positional assertions go through the library's own `sceneCoordsToViewportCoords`, not through a re-derivation of the formula in the test. A self-consistent-but-wrong implementation would otherwise sail past a test written against its own arithmetic — and would put page 2 off the side of the screen while looking perfectly correct on paper.
- **Teeth checks.** Every fix is verified by reverting it and confirming the relevant test _fails_. If you cannot make a test fail by breaking the code it is supposed to guard, the test has no teeth and will protect nothing.

### 4.2 Two mistakes that were actually made here, so you can avoid them

- **A test oracle that was wrong, not the code.** `getElementAbsoluteCoords` returns the **unrotated** bounding box — the renderer applies rotation _on top of_ it rather than folding it in. Asserting the overlay's rotated geometry against `getElementAbsoluteCoords` failed; the correct oracle is `getElementBounds`. When an assertion disagrees with the code, check the oracle before changing the code.
- **Inverting a condition that lives in an `if/else`.** Making the renderer skip animated images by flipping `isExporting || isAnimated` to `isExporting || !isAnimated` did not skip anything: the `else` branch was the raster-cache path, so the GIF still got painted. The fix was an **early `break`** _before_ the `if/else`. The lesson: when you want to skip a branch, you must skip _both_ branches — an `if/else` will always execute one of them.

### 4.3 GIFs are not painted onto the canvas — and that is deliberate

`packages/element/src/renderElement.ts` now **skips animated images entirely** on screen, and a DOM layer draws them instead (`packages/excalidraw/components/AnimatedImageOverlay.tsx`).

The reason is a measured Chromium behaviour, not a guess: **Chromium only advances a GIF's frame clock while the `<img>` is genuinely visible on screen.** The full matrix was measured against the running app:

| host                                           | animates? |
| ---------------------------------------------- | --------- |
| 48×48, `opacity: 0.01`, `z-index: -1`, clipped | no        |
| 2×2, full opacity                              | no        |
| 200×200, `opacity: 0.02`, clipped              | no        |
| 200×200, full opacity, behind the canvas       | no        |
| 120×120, full opacity, on top, unoccluded      | **yes**   |

Neither size, nor opacity, nor being in the document is sufficient. **No hidden host can work.** An earlier implementation used a hidden 2×2 host plus a 24fps repaint ticker; both are now deleted, and the measurement is preserved as a doc comment in `packages/element/src/image.ts` so the dead end does not get re-derived.

If the incoming agent wants to change how images are drawn, read that comment first. The repaint-ticker approach is a trap.

**Known limitation of the current design:** a GIF always paints _above_ canvas elements drawn after it, whatever their z-order. The scene is a single raster, so interleaving would need one canvas layer per animated image. This is documented in `AnimatedImageOverlay.tsx`.

### 4.4 Shell gotchas if the agent still runs on Windows

- PowerShell 5.1 has **no `&&` and no `||`**. Use separate statements and check `$LASTEXITCODE`.
- `Set-Content -Encoding UTF8` **writes a BOM**. This bit the work in this session — an invisible BOM in a `.ts` file that ESLint flagged as `unicode-bom`. Use:
  ```powershell
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
  ```
- `Set-Content` also normalises to CRLF. Prefer the .NET call above, or use the `edit`/`write` tools, which preserve LF.
- A previous harness enforced recoverable deletion via a `mavis-trash` launcher and blocked plain `rm`. A plain WSL CLI agent has no such policy, so `rm -rf` is available — but keep using it carefully.

---

## 5. Open items carried into the handover

These are known and **not** fixed. None is a regression; they are decisions and limitations that were deliberately left in place.

| # | Item | State |
| --- | --- | --- |
| 1 | **PDF vs markdown code copy/paste mismatch** (originally issue #3) | Deliberately unchanged. A PDF has no code-block structure, so copying from it yields the PDF's raw text runs — headings and prose included. Markdown has real fenced blocks, so it is exact. A heuristic to narrow the PDF extraction is _possible_ but was not implemented; it was judged not worth it unless the user asks. |
| 2 | **GIF paints above later z-order elements** | Accepted trade-off, documented in the code. Fixing it properly needs one canvas layer per GIF. |
| 3 | **Page-2 paste path not live-tested** | The camera fix and the overlay geometry are both covered by tests (including one that asserts an image on page 2 lands inside the viewport under the real page-2 camera), but nobody has pasted a GIF onto page 2 in a live browser. Worth doing once. |
| 4 | **Other fixes not yet live-tested by the user** | The user said they would test the camera/zoom/pan, markdown copy, off-page paste and card-grouping fixes later. |
| 5 | **No git history** | See §0. The baseline commit is the first thing to do. |

---

## 6. First 30 minutes for the incoming agent

```bash
# 0. move off /mnt/c and off a path with spaces
mkdir -p ~/projects
cp -a "/mnt/c/Users/user/Desktop/NITTE - C/excalidraw" ~/projects/excalidraw
cd ~/projects/excalidraw

# 1. native binaries must be rebuilt for linux
rm -rf node_modules excalidraw-app/node_modules packages/*/node_modules
yarn install

# 2. pin line endings BEFORE the first commit
cat > .gitattributes <<'EOF'
* text=auto eol=lf
*.png binary
*.jpg binary
*.gif binary
*.ico binary
*.woff binary
*.woff2 binary
*.pdf binary
EOF

# 3. create the rollback point that does not currently exist
git init
git branch -m main
git add -A
git commit -m "chore: baseline — pre-handover snapshot of the working tree"

# 4. wire husky (the pre-commit body is commented out; nothing is enforced)
yarn install

# 5. prove the tree is green
yarn test:typecheck && yarn test:code && yarn test:other && yarn test:app

# 6. run the app
cd excalidraw-app && yarn vite --no-open --port 3000
```

Then read, in this order:

1. `HANDOVER.md` (this file)
2. `CLAUDE.md` — project rules, currently short
3. `AGENTS.md` — see §7

---

## 7. One gap to close: `AGENTS.md`

This repo has **`CLAUDE.md` but no `AGENTS.md`**.

| harness               | reads                                 |
| --------------------- | ------------------------------------- |
| Claude Code           | `CLAUDE.md` ✓ present                 |
| opencode              | `AGENTS.md` ✗ **missing**             |
| most other CLI agents | `AGENTS.md` (or their own convention) |

So handing this repo to opencode as-is means the agent gets **no project context at all** — it will not see the pages system, the code-card behaviour, the GIF architecture, the verification gate, or any of the traps in §4.

A minimal `AGENTS.md` that points at this file is enough to close the gap:

```markdown
# AGENTS.md

See [HANDOVER.md](./HANDOVER.md) for the full handover: project layout, the verification gate, the Windows→WSL migration checklist, and the known architecture (pages system, code cards, PDF export, GIF overlay).

## Non-negotiables

- Verify before claiming done: `yarn test:typecheck && yarn test:code && yarn test:other && yarn test:app`
- Line endings are LF, no BOM. Do not introduce CRLF.
- This repo is a modified fork. Its tests encode fork-specific behaviour — do not "fix" them to match upstream Excalidraw.
- New tests must have teeth: revert the fix and confirm the test fails.
- Use `yarn`, not npm. Do not add dependencies without a strong reason.
```

Keep `HANDOVER.md` as the single source of truth and let `AGENTS.md` point at it, rather than duplicating the content into two files that will drift.
