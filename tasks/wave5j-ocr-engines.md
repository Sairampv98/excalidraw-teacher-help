---
id: wave5j-ocr-engines
paths: packages/vscode-bridge,packages/excalidraw,excalidraw-app,package.json,yarn.lock,SPEC.md
read: SPEC.md,packages/vscode-bridge/extension/src/ocrEngine.ts,packages/vscode-bridge/extension/src/config.ts,packages/vscode-bridge/scripts/build-vsix.mjs,packages/vscode-bridge/bridge/src/protocol.ts,packages/vscode-bridge/bridge/src/ocr.ts,excalidraw-app/bridge/useOcr.ts,excalidraw-app/ocr/benchmark.mjs
base: main
status: merged
---

Wave 5j: the OCR engine is pluggable. tesseract.js becomes a DECLARED dependency, and PaddleOCR and IndraOCR join as options.

WHY THIS WAVE EXISTS
The owner decided two things:

1. "tesseract.js as a declared extension" - the OCR engine stops being a run-time install the teacher has to arrange, and becomes a REAL dependency of the extension, shipped inside the .vsix. This amends AC-64, which said the extension's manifest has no dependencies.
2. "try to provide paddle-ocr and indra ocr from datalab.io as options because they are better performance wise so use that" - the engine becomes a CHOICE, and the two faster engines are on the menu.

THE FACTS, MEASURED ON THE OWNER'S MACHINE (already true - do not re-derive)

1. TESSERACT.JS IS ON NPM: version **7.0.0**. Its runtime dependencies are `bmp-js`, `is-url`, `zlibjs`, `idb-keyval`, `node-fetch`, `tesseract.js-core`, `regenerator-runtime`, `wasm-feature-detect`, `opencollective-postinstall`.
2. THE WASM CORE MUST BE A FILE ON DISK. `tesseract.js-core` ships the `.wasm` (and the SIMD/LSTM variants) as files, and tesseract.js loads the worker and the core from paths at run time. So the .vsix must SHIP the dependency TREE as files - bundling the extension's TypeScript with esbuild is not enough.
3. THE LANGUAGE DATA IS NOT BUNDLED. tesseract.js downloads `eng.traineddata` (about 15 MB) from a CDN on the first run and caches it. The existing code deliberately does NOT pass `cachePath: ""` so a read never pays for the download again. Keep that behaviour exactly.
4. INDRAOCR IS ON PYPI as **`indra-ocr`**, version **1.1.2** (the GitHub project is `datalab-to/indra`; the old name was `datalab-to/IndraOCR` and it no longer resolves). `pip install indra-ocr`. It needs Python >= 3.10 and depends on `numpy`, `opencv-python-headless`, **`onnxruntime`**, `pypdfium2`, `huggingface_hub`. **It does NOT need PyTorch** - it runs on ONNX Runtime, which is why it is light and fast.
   - The models are about **76 MB** (12 files) and download from Hugging Face on the first run, then are cached. `INDRA_OCR_MODEL_DIR` points at a local copy, and `models.model_dir(None)` resolves it.
   - The CLI: `indra-ocr scan.png --format json` gives lines, boxes, layout blocks and confidences.
   - The Python API: `import indra_ocr`, then the page's `page.lines` is a list of `Line(box, text, conf)` in reading order, and `box` is `x0, y0, x1, y1` in the image's own pixels. `page.timings` is `{"orient_ms":..,"det_ms":..,"rec_ms":..,"order_ms":..,"total_ms":..}`.
   - **THE RECIPE THAT WORKS, and the three ways it does not:**
     ```python
     from indra_ocr import models, OrtOCR, Converter
     md   = models.model_dir(None)      # -> Path; INDRA_OCR_MODEL_DIR, else download (cached)
     ocr  = OrtOCR(md, threads=4)        # the engine, ~860 ms
     conv = Converter(ocr, mode="ocr")
     for index, page in conv.convert(path):    # YIELDS (index, Page) TUPLES
         page.lines      # [Line(box=[x0,y0,x1,y1], text, conf)]
         page.timings
     ```
     - `indra_ocr.load(path)` is **NOT** the entry point for an image: `load` treats its argument as the **model folder** (it calls `model_dir(path)`), so passing an image path raises `ModelError: the model folder ... lacks det.onnx, rec.onnx, meta.json`.
     - `indra_ocr.load_pages(path)` yields `(index, grayscale ndarray)` - the RAW PAGES, not the OCR result.
     - `Converter.convert(path)` is a **GENERATOR**: `pages = conv.convert(path)` then `pages[0]` raises `TypeError: 'generator' object is not subscriptable`. Use `for index, page in ...` or `list(...)`.
     - `convert` takes a **PATH**, not bytes: the sidecar writes the base64 image to a temporary file and passes that path.
   - ITS OWN BENCHMARKS (the project's, not ours): 66.7 on OmniParseBench against PaddleOCR's 58.4 and Tesseract's 19.3; about 44 pages/s on 32 cores (15x Tesseract, 10x PaddleOCR's text models); about 210 ms per page on 4 cores.
5. PADDLEOCR IS ON PYPI as `paddleocr`, version **3.7.0** (pure Python), and it needs **`paddlepaddle`**, version **3.3.1** - which ships `win_amd64` wheels for **cp310, cp311, cp312 and cp313 ONLY**. There is **no cp314 wheel** for PaddlePaddle, on any version.
6. **THE OWNER'S PYTHON IS 3.14.7.** So PaddleOCR CANNOT BE INSTALLED on the machine's default Python. It needs a Python 3.12 or 3.13 (the owner has `pyenv` in mind for exactly this). `onnxruntime` 1.31.0 DOES have a `cp314` `win_amd64` wheel, so **IndraOCR runs on Python 3.14** - and it is ALREADY INSTALLED for this wave, in a dedicated virtual environment:
   - the interpreter: `C:\Users\user\projects\ocr-venv\Scripts\python.exe` (Python 3.14.7),
   - the packages: `indra-ocr 1.1.2`, `onnxruntime 1.31.0`, `opencv-python-headless 5.0.0.93`, `numpy 2.5.4`, `huggingface-hub 2.2.0`, `pillow`.
   - the models are already downloaded and cached at `C:\Users\user\.cache\huggingface\hub\models--datalab-to--indra-ocr` (12 files: det.onnx, rec.onnx, order.onnx, orient.onnx, script.onnx, rec_cjk.onnx, rec_rtl.onnx, rec_world.onnx, lm.npz, lm_cjk.npz, lm_world.npz, meta.json).
   - **THE MEASURED NUMBERS FOR INDRAOCR ON THIS MACHINE**, on a 962x506 capture of the real VS Code window: the model download took 10.2 s ONCE (then it is cached), the engine is ready in 863 ms, the first read was 281.2 ms, and the **steady-state reads were 219, 223, 229, 233 and 237 ms - a median of 228.6 ms and a p95 of 237.4 ms**. It read **71 lines** with real text and real boxes ("File Edit Selection View Go", "Explorer", "package.json - my-todo-app - Visual Studio Code - Untracked"). Its own timings for that read: orient 30.9 ms, det 56.5 ms, rec 159.1 ms, order 13.3 ms, total 228.9 ms.
   - For comparison, wave 5d measured tesseract at **261 ms median / 272 ms p95** for the full frame and **97 / 102 ms** for the subtitle crop.
   - A dedicated virtual environment is the right shape for this: the extension's `pythonPath` setting points at it, and the teacher's own Python is not disturbed.
7. PADDLEOCR'S API DIFFERS BY VERSION. 3.x: `PaddleOCR(...)` then `ocr.predict(path)` (or a numpy/bytes image), whose result carries `rec_texts`, `rec_scores` and `rec_polys`. 2.x: `ocr.ocr(path, cls=True)`, whose result is a list of `[box, (text, score)]` pairs. **The sidecar must accept both shapes** - the teacher's Python may be either.

THE DESIGN

A. TESSERACT.JS IS DECLARED, AND THE .vsix SHIPS IT
- `packages/vscode-bridge/extension/package.json` gains `"dependencies": { "tesseract.js": "^7.0.0" }`. This is the FIRST dependency the extension has ever declared - AC-64 is amended, not deleted.
- **WHERE THE PACKAGE COMES FROM AT BUILD TIME.** The extension is NOT one of the root yarn workspaces (the root's `workspaces` are `excalidraw-app`, `packages/*`, `examples/*`, and `packages/*` does not reach `packages/vscode-bridge/extension`). So the build cannot resolve the declared dependency by itself. Two acceptable ways to get it, both of which change the ROOT `package.json` and the ROOT `yarn.lock`:
  - add `tesseract.js` to the root `package.json`'s `devDependencies` (the build then resolves it from the root `node_modules`), or
  - make the extension a yarn workspace (`packages/vscode-bridge/extension` added to the root `workspaces`), so `yarn install` installs its declared dependency.
  Whichever you choose, the ROOT `package.json` and the ROOT `yarn.lock` are in this wave's scope - they are in the task's `paths:` list, and the changes are the mechanical consequence of the owner's decision to have a declared dependency.
- The .vsix build must SHIP the dependency tree: copy the installed `tesseract.js` and everything it needs at run time (the `tesseract.js-core` package with its `.wasm` files, and the other runtime dependencies) into the staged `extension/node_modules/`. The build must FAIL LOUDLY if a file it needs is missing - a .vsix that installs but cannot OCR is worse than one that does not install.
- The extension loads the **declared copy first** - the one inside its own installed folder - and the run-time install (a teacher who put tesseract.js in the project they teach from) stays as the FALLBACK. The existing `engineSearchPaths` puts the workspace first; the order changes so the declared copy wins, and the fallback is still tried.
- The worker is still created ONCE and reused for every read, and the language data is still cached (no `cachePath: ""`, no pinned `corePath`).

B. THE ENGINE IS CHOSEN BY A SETTING
- A new setting `excalidraw-bridge.ocrEngine`, one of `"tesseract"`, `"indra"`, `"paddle"`. The default stays `"tesseract"`.
- A new setting `excalidraw-bridge.pythonPath`, the Python executable the Python engines use. The default is `"python"`.
- The engine is resolved ONCE, at activation, and the panel is told which engine is in use - so the teacher can see it.

C. THE PYTHON ENGINES RUN AS A SIDECAR
- A Python helper ships with the extension: `packages/vscode-bridge/extension/media/ocr_sidecar.py`.
- The extension spawns it ONCE (the same pattern as the capture helper) and talks to it over stdio with one JSON object per line: a request `{"id":"...","imageBase64":"...","region":{...},"language":"eng"}` and a response `{"id":"...","lines":[{"text":"...","x":0,"y":0,"width":0,"height":0}],"confidence":0.9}` or `{"id":"...","error":"..."}`.
- The sidecar uses **`importlib.util.find_spec`** to report which engines it CAN reach WITHOUT importing them - `find_spec` does not execute the package, so asking "is paddleocr there?" does not pay for paddleocr's ten-second import. It reports the available engines and, for each missing one, WHY.
- The sidecar imports the chosen engine LAZILY, on the first request, and keeps the model loaded for every later request (the model load is the expensive part).
- **IndraOCR**: `import indra_ocr`, read the page's `lines` (each `Line(box, text, conf)`), and map `box` (x0,y0,x1,y1) to the engine's own line shape.
- **PaddleOCR**: `from paddleocr import PaddleOCR`, then read the result in BOTH the 3.x shape (`rec_texts` + `rec_polys`) and the 2.x shape (a list of `[box, (text, score)]`).
- The sidecar's lines are in the IMAGE's own pixels, exactly like tesseract's, so the app's placement code does not change.

D. AN ENGINE THAT IS NOT THERE IS AN EXPLICIT STATE
- The extension's OCR state is `ready` (with the engine's name) or `unavailable` (with a reason that says WHAT to install).
- The reason names the exact command: `pip install indra-ocr` or `pip install paddleocr paddlepaddle`.
- For PaddleOCR the reason must ALSO say the truth about this machine: PaddlePaddle has no build for Python 3.14 - it needs Python 3.12 or 3.13. The sidecar knows its own `sys.version_info`, so it can say it.
- The app shows the reason. A missing engine is never a silent failure and never a blank result (D-75).

E. THE PROTOCOL CARRIES THE ENGINE
- `ocr:request` gains an OPTIONAL `engine` - the app may ask for a specific engine; the extension falls back to its setting when the field is absent.
- `ocr:result` gains an OPTIONAL `engine` (which engine actually ran) and an OPTIONAL `durationMs` (how long the read took). The runtime guard accepts both as optional.
- The app shows the engine and the time.

F. THE BENCHMARK COVERS EVERY ENGINE
- The repository already has `packages/vscode-bridge/tests/ocrBenchmark.test.ts` and `excalidraw-app/ocr/benchmark.mjs`, and the 5d wave's numbers were: full frame 261 ms median / 272 ms p95, subtitle crop 97 / 102 ms.
- The benchmark must now report EVERY engine: the median and the p95 for the full frame and for the subtitle crop, and for an engine that cannot run it must say WHY (not installed, no build for this Python, and so on).
- The engines that CAN run here are tesseract and indra (the dedicated venv). PaddleOCR cannot run on Python 3.14 - that is a fact to report, not a failure to hide.

G. WHAT MUST NOT CHANGE
- `packages/excalidraw/package.json` and `excalidraw-app/package.json` gain **NO** dependency. The engines belong to the EXTENSION, and the app talks to the extension over the bridge. AC-112's rule (the library gains nothing) still holds. The ROOT `package.json` MAY gain `tesseract.js` as a build-time dependency - that is how the extension's DECLARED dependency is resolved at build time.
- The OCR engine is never in the browser (D-59): a WASM OCR engine is a multi-megabyte download and a classroom connection is slow.
- The app's placement code (the boxes are in the image's own pixels) does not change.

SPEC.md
Add the decision rows D-89 (the extension may declare its dependencies; tesseract.js is declared and shipped in the .vsix, and the run-time install stays as the fallback), D-90 (the OCR engine is chosen by a setting: tesseract in-process, indra and paddle as Python sidecars) and D-91 (an engine that is not installed is an explicit, actionable state, never a silent failure).
AMEND AC-64: the manifest may now declare a dependency, and tesseract.js is the one it declares.
Add the acceptance rows AC-121 to AC-127:
- AC-121 the extension's manifest DECLARES tesseract.js, and the built .vsix SHIPS it with its wasm core - the teacher installs nothing to get OCR.
- AC-122 the engine is chosen by a setting (tesseract | indra | paddle), and the panel says which engine is in use.
- AC-123 the Python engines run in a sidecar that is spawned ONCE and reused, and it reports which engines it can reach WITHOUT importing them.
- AC-124 an engine that is not installed is an EXPLICIT state: the reason names the package to install, and says that PaddlePaddle has no build for Python 3.14.
- AC-125 the read result carries the engine that ran and how long it took.
- AC-126 the benchmark reports every engine - its median and p95 for the full frame and the subtitle crop - and says why an engine could not be measured.
- AC-127 neither `packages/excalidraw/package.json` nor `excalidraw-app/package.json` gains a dependency.
AC-121..AC-127 are RESERVED for this wave. Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example `it("AC-122 the engine is chosen by a setting", ...)`. The kit SPEC lint reads the file and fails if the id is absent.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. The ONE new dependency is `tesseract.js` in the EXTENSION's manifest - the owner asked for exactly that.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your new rows must be green, and the amended AC-64 too.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: (a) the declared copy not shipped in the .vsix, (b) the setting ignored and the engine always tesseract, (c) the sidecar spawned per request instead of once, (d) the not-installed state swallowed instead of reported, (e) the engine name missing from the result.
- The machine: the gate sizes vitest from the free memory, so it takes about three to four minutes. If the vitest step fails with "still loading", that is the known load flake, not your code: re-run with GATE_JOBS=2. If the OS kills the workers (non-zero exit, NO summary line), free memory and re-run. The machine is BUSY - the owner has many apps open - so keep the memory you use low and do not start anything long-running in the background.
- There may be ANOTHER gate running when you start (the kit serialises them - it will wait for the lock). That is normal; wait it out.
- WINDOWS: the harness strips literal double quotes out of a command line, which breaks JSON arguments and even the PowerShell parser. When you build a command string that needs a quote character, use $q = [char]34 and concatenate - never type a literal quote. In a ripgrep pattern, write \x22.
- PowerShell 5.1 has no [uint] type accelerator - use [uint32].

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. How the .vsix ships tesseract.js, the file list you copied, and how the build fails loudly when a file is missing.
5. The sidecar's protocol, its startup report, and how a missing engine becomes a message.
6. The benchmark table: every engine, the median and the p95 for the full frame and the subtitle crop, and the reason for any engine that could not be measured.
7. Anything you could not do and why, and anything in this brief you found to be wrong.
8. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.
