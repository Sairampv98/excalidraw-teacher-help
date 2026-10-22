# Wave 5o — PaddleOCR actually runs on this machine

## Why this wave exists

The owner installed PaddleOCR to have a faster OCR engine (2026-10-22). The benchmark recorded in wave 5j could not measure it: **PaddleOCR crashes on this machine** before it reads anything.

Measured on 2026-10-23, through the extension's own sidecar, with the owner's Python:

```
$ node bench-paddle.mjs C:\Users\user\.pyenv\pyenv-win\versions\3.12.10\python.exe stream-frame.jpg
[sidecar] {"type":"ready","python":"3.12.10","engines":{"indra":{"available":false,...},"paddle":{"available":true}}}
run 1: 22851 ms  lines=0  conf=- ERROR=NotImplementedError: (Unimplemented)
  ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]
  (at ..\paddle\fluid\framework\new_executor\instruction\onednn\onednn_instruction.cc:118)
```

The engine is reported **available** (the sidecar probes the module with `find_spec`) and then **fails on the first real read**. That is the worst shape: a state that says yes and then cannot do the work.

### The cause

PaddlePaddle 3.3.1 on Windows, with the PIR API, hits an unimplemented conversion in the **oneDNN** instruction of the new executor. Every way of switching oneDNN off from the outside was tried and **none** of them worked:

| Attempt | Result |
|---|---|
| `FLAGS_use_mkldnn=0` (env) | fails, same error |
| `paddle.set_flags({"FLAGS_use_mkldnn": False})` | fails, same error |
| `paddle.set_flags({"FLAGS_enable_pir_api": False})` | fails, same error |
| `FLAGS_enable_pir_api=0` (env) | fails, same error |
| `FLAGS_enable_new_executor=0` (env) | fails, same error |
| `paddle.set_flags({"FLAGS_enable_new_executor": False})` | `ValueError: Flag ... cannot set its value through this function.` |
| **`PaddleOCR(enable_mkldnn=False, device="cpu")`** | **works** |

`enable_mkldnn=False` is a **constructor argument** of `PaddleOCR` (it reaches PaddleX through the `kwargs` catch-all), and it is the only thing that works.

### What it costs

Measured on the same full VS Code frame (962x506), the same machine, CPU only:

| Engine | Median read | Note |
|---|---|---|
| `indra` | **147 ms** full / 74 ms crop | best on this box |
| `tesseract` | **278 ms** full / 120 ms crop | in-process, in the `.vsix` |
| `paddle` (PP-OCRv6_medium, the default) | **27,822 ms** | median of 5, min 26,944, max 29,053 |
| `paddle` (PP-OCRv5_mobile) | **19,276 ms** | slightly faster, slightly worse text |

So PaddleOCR on this box is **correct but not fast**: it is about 65x slower than tesseract and 190x slower than indra, because the oneDNN path that would make it fast is exactly the path that is broken here. That is a fact to **report**, not to hide (D-91), and the engine stays a **choice** (D-90) — a teacher with a GPU or a fixed paddle build gets a fast Paddle.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-106 | an engine that **crashes on its first real read** falls back to a configuration that works, and the fall-back is **recorded** | locked | The sidecar's contract is a **line per request** and an answer that is either a result or an error. A crash on the first read therefore has to become **a working answer**, not a dead engine. The rule is narrow and mechanical: the sidecar builds the PaddleOCR model, and if the **first** read raises the oneDNN/PIR error, it rebuilds the model with **`enable_mkldnn=False`** and reads again - **once**, and the model that works is kept for every later read (D-90). The fall-back is **not** unconditional: oneDNN is faster when it works, so the sidecar tries the fast path first and only drops to the slow one when the fast one has actually failed. The fall-back is **reported** in the answer - the engine's name and whether it ran with oneDNN - so the teacher can see why a Paddle read took 28 seconds instead of 300 milliseconds, and the extension's benchmark records the same fact (AC-126). A **second** failure is an error, not a third try: the sidecar does not loop. |
| D-107 | the sidecar's **fall-back** is a property of the engine's model, not of the request | locked | The model is loaded **once** and kept (D-90), so the decision "does this engine need the slow path" belongs to the model, not to the request that happens to arrive first. The sidecar therefore remembers, per engine, **how the model was built**, and every later request reuses that model. A request never rebuilds a model behind the teacher's back, and the model load - which is the expensive part - is paid **once**. The state lives in the sidecar's own module state, next to the models, and it is **reported** in the `ready` line, so the extension can tell the app which engines are ready and how (D-90, D-91). |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-143 | an engine that **crashes on its first read** is retried with the slow path and then **works** | `packages/vscode-bridge/tests/ocrSidecar.test.ts` | The sidecar must survive the crash the owner actually hit (D-106). Tests: `AC-143 a paddle read that raises the oneDNN error is retried with mkldnn disabled and then succeeds`, `AC-143 the answer says that the engine ran without oneDNN`. |
| AC-144 | the model is built **once**, and the fall-back is remembered for the later reads | `packages/vscode-bridge/tests/ocrSidecar.test.ts` | The model load is paid once (D-107). Tests: `AC-144 the model is built once and every later read reuses it`, `AC-144 the ready line says how the paddle model was built`. |

---

## The file map (read before writing)

- `packages/vscode-bridge/extension/media/ocr_sidecar.py` — `load_model`, `read_paddle`, `engine_report`, the `ready` line, and the request loop. The fall-back belongs in `load_model` and `read_paddle`.
- `packages/vscode-bridge/extension/src/ocrEngine.ts` — the extension's side: how the ready line and the answer are read.
- `packages/vscode-bridge/tests/ocrSidecar.test.ts` — the sidecar's own tests (the place the two acceptance rows go).
- `packages/vscode-bridge/tests/ocrBenchmark.test.ts` — the benchmark (AC-126), which must record the fall-back.
- `packages/vscode-bridge/scripts/build-vsix.mjs` — the `.vsix` build; the sidecar ships inside it, so the fix has to be in the built extension.
- `packages/vscode-bridge/extension/package.json` — the manifest, if a setting is added.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency** anywhere, and **no change to the owner's Python installation**: the fix is in the sidecar, not in a `pip install`.
- The sidecar is **Python 3.8+** compatible in the same way it is today - it must still start on a machine that has no paddle at all, and it must still report `paddle` as unavailable with the reason.
- **Text in the extension's own messages**, and the fall-back must be visible to the teacher.
- LF endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-143 ...`), or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, remove the fall-back (AC-143 must fail) and build the model per request (AC-144 must fail).
- The scope is `packages/vscode-bridge` and `SPEC.md`. Nothing else may be touched.

## The gates

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0. The kit's own SPEC lint must pass.

**The real proof, beyond the tests**: rebuild the `.vsix` (`node packages/vscode-bridge/scripts/build-vsix.mjs`), install it into the owner's two editors, and run the sidecar **for real** with the owner's Python 3.12.10 against a real frame. Report the numbers in the close note: the read time with the fall-back, and the fact that the engine answers at all.
