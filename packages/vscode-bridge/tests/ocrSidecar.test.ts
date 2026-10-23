import { EventEmitter } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createOcrSidecar,
  type OcrSidecarProcess,
  type OcrSidecarReport,
  type OcrSidecarSpawn,
} from "../extension/src/ocrSidecar";

import type { ChildProcess } from "node:child_process";

/** The package root, found by walking up from the working directory. */
const findPackageRoot = (): string => {
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");
    if (existsSync(join(candidate, "extension", "media", "ocr_sidecar.py"))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("the vscode-bridge package was not found");
};

const sidecarScript = join(
  findPackageRoot(),
  "extension",
  "media",
  "ocr_sidecar.py",
);

/**
 * The Python the sidecar runs in.
 *
 * It is the interpreter on the machine, or the one the environment names. The
 * sidecar's REPORT needs nothing but the standard library, so any Python will
 * do.
 */
const findPython = (): string => {
  const candidates = [process.env.OCR_PYTHON, "python", "python3"].filter(
    Boolean,
  ) as string[];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe" });
      return candidate;
    } catch {
      // the next one
    }
  }

  throw new Error(
    "no Python was found: the OCR sidecar is a Python program, and this machine has none on its PATH",
  );
};

/** A sidecar process that answers what the test tells it to answer. */
class FakeProcess extends EventEmitter {
  written: string[] = [];
  killed = false;
  stdin = {
    write: (chunk: string) => {
      this.written.push(chunk);
      return true;
    },
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill() {
    this.killed = true;
    return true;
  }
}

/**
 * A package that says it was imported.
 *
 * The sidecar has to be able to say "indra is there" WITHOUT importing it, and
 * this is how the test knows: the marker file appears the moment the package
 * is executed.
 */
const fakeEnginePackage = (marker: string, name: string) => {
  const root = mkdtempSync(join(tmpdir(), "excalidraw-ocr-engine-"));
  const folder = join(root, name);

  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "__init__.py"),
    `open(${JSON.stringify(
      marker,
    )}, "w", encoding="utf-8").write("imported")\n`,
    "utf8",
  );

  return { root, marker };
};

/**
 * The fake **paddleocr** package.
 *
 * It stands in for PaddleOCR on a machine where PaddlePaddle cannot be
 * installed. The model writes down how it was built, and it crashes the way
 * PaddlePaddle 3.x crashes on Windows when oneDNN is on (D-106).
 *
 * The `numpy` and `cv2` beside it are there for the same reason: the sidecar
 * decodes the image before it reads it, and the test must not need a real
 * image library - only a real Python.
 */
const fakePaddleEngine = () => {
  const root = mkdtempSync(join(tmpdir(), "excalidraw-ocr-paddle-"));
  const log = join(root, "built.jsonl");

  const write_ = (folder: string, source: string) => {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, "__init__.py"), source, "utf8");
  };

  write_("paddle", "");

  write_(
    "numpy",
    [
      "uint8 = 'uint8'",
      "",
      "",
      "def frombuffer(buffer, dtype=None):",
      "    return buffer",
      "",
    ].join("\n"),
  );

  write_(
    "cv2",
    [
      "IMREAD_COLOR = 1",
      "IMREAD_GRAYSCALE = 0",
      "COLOR_BGR2RGB = 4",
      "",
      "",
      "def imdecode(buffer, flags=0):",
      "    return buffer",
      "",
      "",
      "def cvtColor(image, code):",
      "    return image",
      "",
    ].join("\n"),
  );

  write_(
    "paddleocr",
    [
      "import json",
      "import os",
      "",
      "LOG = os.environ['OCR_FAKE_ENGINE_LOG']",
      "CRASH = os.environ.get('OCR_FAKE_ENGINE_CRASH') == '1'",
      "",
      "ONE_DNN_ERROR = (",
      "    '(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support '",
      "    '[pir::ArrayAttribute<pir::DoubleAttribute>]'",
      ")",
      "",
      "",
      "class PaddleOCR:",
      "    def __init__(self, **kwargs):",
      "        with open(LOG, 'a', encoding='utf-8') as handle:",
      "            handle.write(json.dumps(kwargs) + '\\n')",
      "        self.kwargs = kwargs",
      "",
      "    def predict(self, image):",
      "        if CRASH and self.kwargs.get('enable_mkldnn', True):",
      "            raise NotImplementedError(ONE_DNN_ERROR)",
      "        return [{'rec_texts': ['hello from paddle'], 'rec_scores': [0.97]}]",
      "",
    ].join("\n"),
  );

  return { root, log };
};

/**
 * The sidecar, running as if it were on a Python that HAS a PaddlePaddle wheel.
 *
 * PaddlePaddle has no cp314 wheel, so on a Python 3.14 the sidecar says
 * "paddle is unavailable" - the truth here, and the wrong thing to test
 * against. The version is patched so the Paddle path can be exercised on any
 * machine (D-91).
 */
const spawnPaddleSidecar = (python: string, root: string, log: string) =>
  spawn(
    python,
    [
      "-c",
      "import sys, runpy; sys.version_info = (3, 12, 10, 'final', 0); runpy.run_path(sys.argv[1], run_name='__main__')",
      sidecarScript,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONPATH: root,
        OCR_FAKE_ENGINE_LOG: log,
        OCR_FAKE_ENGINE_CRASH: "1",
      },
    },
  );

/**
 * The lines the sidecar wrote, in order.
 *
 * The sidecar answers on stdout, one JSON object per line, so the lines are
 * taken as they come and the test waits for the one it needs.
 */
const sidecarLines = (child: ChildProcess) => {
  const lines: Record<string, unknown>[] = [];
  const waiting: {
    match: (line: Record<string, unknown>) => boolean;
    resolve: (line: Record<string, unknown>) => void;
  }[] = [];
  let buffer = "";

  const deliver = (line: Record<string, unknown>) => {
    lines.push(line);

    for (let index = 0; index < waiting.length; index++) {
      if (waiting[index].match(line)) {
        waiting.splice(index, 1)[0].resolve(line);
        return;
      }
    }
  };

  child.stdout?.on("data", (chunk) => {
    buffer += String(chunk);
    let newline = buffer.indexOf("\n");

    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (!line) {
        continue;
      }

      deliver(JSON.parse(line) as Record<string, unknown>);
    }
  });

  return {
    lines,
    /** the next line that matches - the ones that do not are kept */
    waitFor: (match: (line: Record<string, unknown>) => boolean) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const found = lines.find(match);
        if (found) {
          resolve(found);
          return;
        }
        waiting.push({ match, resolve });
      }),
  };
};

/** Every model the fake engine was asked to build, and how it was built. */
const readBuilds = (log: string): Record<string, unknown>[] => {
  if (!existsSync(log)) {
    return [];
  }

  return readFileSync(log, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

/** The report the sidecar writes when it starts. */
const readReport = (
  python: string,
  extraPath = "",
): Promise<OcrSidecarReport> =>
  new Promise((resolveReport, rejectReport) => {
    const child = spawn(python, [sidecarScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(extraPath ? { PYTHONPATH: extraPath } : {}),
      },
    });

    let buffer = "";

    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const newline = buffer.indexOf("\n");

      if (newline === -1) {
        return;
      }

      child.kill();

      try {
        resolveReport(JSON.parse(buffer.slice(0, newline)) as OcrSidecarReport);
      } catch (error) {
        rejectReport(error as Error);
      }
    });

    child.on("error", rejectReport);
  });

/** The sidecar's own reasons, for a Python of a given version. */
const readReasons = (
  python: string,
  version: string,
): { indra: string; paddle: string } => {
  const probe = join(
    mkdtempSync(join(tmpdir(), "excalidraw-ocr-probe-")),
    "probe.py",
  );

  writeFileSync(
    probe,
    [
      "import json, runpy, sys",
      "parts = [int(part) for part in sys.argv[2].split('.')]",
      "sys.version_info = (parts[0], parts[1], parts[2], 'final', 0)",
      "module = runpy.run_path(sys.argv[1], run_name='not_main')",
      "print(json.dumps({",
      "    'indra': module['engine_reason']('indra'),",
      "    'paddle': module['engine_reason']('paddle'),",
      "}))",
    ].join("\n"),
    "utf8",
  );

  const output = execFileSync(python, [probe, sidecarScript, version], {
    stdio: "pipe",
    encoding: "utf8",
  });

  return JSON.parse(output) as { indra: string; paddle: string };
};

describe("the OCR sidecar", () => {
  it("AC-123 the sidecar is spawned once and reused for every read", async () => {
    const processes: FakeProcess[] = [];
    const spawnProcess: OcrSidecarSpawn = () => {
      const process = new FakeProcess();
      processes.push(process);
      return process as unknown as OcrSidecarProcess;
    };

    const sidecar = createOcrSidecar({
      pythonPath: "python",
      scriptPath: "ocr_sidecar.py",
      spawnProcess,
    });

    const started = sidecar.start();

    // the report is the first line the sidecar writes
    processes[0].stdout.emit(
      "data",
      `${JSON.stringify({
        type: "ready",
        python: "3.14.7",
        engines: { indra: { available: true } },
      })}\n`,
    );

    await expect(started).resolves.toMatchObject({ python: "3.14.7" });

    // asking again does not spawn a second process
    const again = sidecar.start();

    expect(processes.length).toBe(1);

    await again;

    // and a read goes over the SAME process: a process per read would pay for
    // the interpreter's start-up, and for the model's load, every time (D-90)
    const first = sidecar.recognize({ engine: "indra", imageBase64: "QUJD" });
    const firstRequest = JSON.parse(processes[0].written[0]);

    processes[0].stdout.emit(
      "data",
      `${JSON.stringify({
        id: firstRequest.id,
        text: "hello",
        lines: [],
        durationMs: 12,
      })}\n`,
    );

    await expect(first).resolves.toMatchObject({
      text: "hello",
      durationMs: 12,
    });

    const second = sidecar.recognize({ engine: "indra", imageBase64: "REVG" });
    const secondRequest = JSON.parse(processes[0].written[1]);

    processes[0].stdout.emit(
      "data",
      `${JSON.stringify({ id: secondRequest.id, text: "again", lines: [] })}\n`,
    );

    await expect(second).resolves.toMatchObject({ text: "again" });

    // ONE process for two reads
    expect(processes.length).toBe(1);
    expect(processes[0].written.length).toBe(2);

    sidecar.stop();
    expect(processes[0].killed).toBe(true);
  });

  it("AC-123 the sidecar reports the engines it can reach without importing them", async () => {
    const python = findPython();
    const { root, marker } = fakeEnginePackage(
      join(tmpdir(), `excalidraw-ocr-marker-${process.pid}.txt`),
      "indra_ocr",
    );

    const report = await readReport(python, root);

    // the sidecar SEES the engine
    expect(report.engines.indra).toEqual({ available: true });
    expect(report.python).toMatch(/^\d+\.\d+/);

    // but it did not IMPORT it: `find_spec` does not execute the package, and
    // importing paddleocr would cost ten seconds of the teacher's machine for
    // an answer the file system already has (D-90)
    expect(existsSync(marker)).toBe(false);
  });

  it("AC-123 the engine is imported lazily, on the first request", async () => {
    const python = findPython();
    const marker = join(
      mkdtempSync(join(tmpdir(), "excalidraw-ocr-lazy-")),
      "imported.txt",
    );
    const { root } = fakeEnginePackage(marker, "indra_ocr");

    const answer = await new Promise<Record<string, unknown>>(
      (resolveAnswer, rejectAnswer) => {
        const child = spawn(python, [sidecarScript], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONPATH: root },
        });

        let buffer = "";
        let seen = 0;

        child.stdout.on("data", (chunk) => {
          buffer += String(chunk);
          let newline = buffer.indexOf("\n");

          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");

            if (!line) {
              continue;
            }

            seen += 1;

            // the first line is the report: the engine is NOT imported yet
            if (seen === 1) {
              expect(existsSync(marker)).toBe(false);
              child.stdin.write(
                `${JSON.stringify({
                  id: "1",
                  engine: "indra",
                  imageBase64: "QUJD",
                })}\n`,
              );
              continue;
            }

            child.kill();
            resolveAnswer(JSON.parse(line) as Record<string, unknown>);
          }
        });

        child.on("error", rejectAnswer);
      },
    );

    // the read failed - the fake engine is not an engine - but it was
    // IMPORTED, and only when it was asked for
    expect(answer.id).toBe("1");
    expect(existsSync(marker)).toBe(true);
  });

  it("AC-124 an engine that is not installed is reported with the command that installs it", () => {
    const python = findPython();
    const reasons = readReasons(python, "3.14.7");

    // the reason names the package AND the command that installs it: a
    // teacher who cannot read the reason cannot fix it (D-91)
    expect(reasons.indra).toContain("indra-ocr");
    expect(reasons.indra).toContain("pip install indra-ocr");

    expect(reasons.paddle).toContain("paddleocr");
    expect(reasons.paddle).toContain("pip install paddleocr paddlepaddle");
  });

  it("AC-124 the paddle reason says that PaddlePaddle has no build for Python 3.14", () => {
    const python = findPython();

    // on Python 3.14 there is no cp314 wheel of PaddlePaddle, and the reason
    // says so - the sidecar knows its own sys.version_info (D-91)
    const on314 = readReasons(python, "3.14.7");

    expect(on314.paddle).toContain("PaddlePaddle has no build for Python 3.14");
    expect(on314.paddle).toContain("3.12 or 3.13");

    // and on a Python that has a wheel, the reason does not claim otherwise
    const on312 = readReasons(python, "3.12.1");

    expect(on312.paddle).not.toContain("no build");
    expect(on312.paddle).toContain("pip install paddleocr paddlepaddle");
  });

  it("AC-143 a paddle read that raises the oneDNN error is retried with mkldnn disabled and then succeeds", async () => {
    const python = findPython();
    const { root, log } = fakePaddleEngine();
    const child = spawnPaddleSidecar(python, root, log);
    const output = sidecarLines(child);

    const report = await output.waitFor((line) => line.type === "ready");

    // the FAST path is what the sidecar tries first: oneDNN is faster when it
    // works, so the fall-back is not unconditional (D-106)
    expect(report.engines).toMatchObject({
      paddle: { available: true, model: { mkldnn: true } },
    });

    child.stdin?.write(
      `${JSON.stringify({
        id: "1",
        engine: "paddle",
        imageBase64: "QUJD",
      })}\n`,
    );

    const answer = await output.waitFor((line) => line.id === "1");

    // the crash became a WORKING answer, not a dead engine
    expect(answer.error).toBeUndefined();
    expect(answer.text).toBe("hello from paddle");

    // and the model was rebuilt with oneDNN OFF - the only switch that works
    // around the crash (D-106)
    const built = readBuilds(log);
    expect(built).toHaveLength(2);
    expect(built[1].enable_mkldnn).toBe(false);

    child.kill();
  });

  it("AC-143 the answer says that the engine ran without oneDNN", async () => {
    const python = findPython();
    const { root, log } = fakePaddleEngine();
    const child = spawnPaddleSidecar(python, root, log);
    const output = sidecarLines(child);

    await output.waitFor((line) => line.type === "ready");

    child.stdin?.write(
      `${JSON.stringify({
        id: "1",
        engine: "paddle",
        imageBase64: "QUJD",
      })}\n`,
    );

    const answer = await output.waitFor((line) => line.id === "1");

    // the answer says WHICH engine read the text, and HOW its model was built:
    // the teacher has to be able to see why the read took 28 seconds instead
    // of 300 milliseconds (D-106, D-91)
    expect(answer.engine).toBe("paddle");
    expect(answer.model).toEqual({ mkldnn: false });

    child.kill();
  });

  it("AC-144 the model is built once and every later read reuses it", async () => {
    const python = findPython();
    const { root, log } = fakePaddleEngine();
    const child = spawnPaddleSidecar(python, root, log);
    const output = sidecarLines(child);

    await output.waitFor((line) => line.type === "ready");

    child.stdin?.write(
      `${JSON.stringify({
        id: "1",
        engine: "paddle",
        imageBase64: "QUJD",
      })}\n`,
    );

    const first = await output.waitFor((line) => line.id === "1");

    expect(first.error).toBeUndefined();

    // the fast model, and the model that works: two builds, and no more
    expect(readBuilds(log)).toHaveLength(2);

    child.stdin?.write(
      `${JSON.stringify({
        id: "2",
        engine: "paddle",
        imageBase64: "REVG",
      })}\n`,
    );

    const second = await output.waitFor((line) => line.id === "2");

    // the later read reuses the model that works: nothing is built again, and
    // the fall-back is remembered (D-107)
    expect(second.error).toBeUndefined();
    expect(second.text).toBe("hello from paddle");
    expect(readBuilds(log)).toHaveLength(2);

    child.kill();
  });

  it("AC-144 the ready line says how the paddle model was built", async () => {
    const python = findPython();
    const { root, log } = fakePaddleEngine();
    const child = spawnPaddleSidecar(python, root, log);
    const output = sidecarLines(child);

    const first = await output.waitFor((line) => line.type === "ready");

    // how the model WILL be built: the fast path, until it has failed
    expect(first.engines).toMatchObject({
      paddle: { model: { mkldnn: true } },
    });

    child.stdin?.write(
      `${JSON.stringify({
        id: "1",
        engine: "paddle",
        imageBase64: "QUJD",
      })}\n`,
    );

    await output.waitFor((line) => line.id === "1");

    // the fall-back changed how the model was built, so the report is written
    // AGAIN - and now it says how the model WAS built (D-107)
    const updated = await output.waitFor(
      (line) => line.type === "ready" && line !== first,
    );

    expect(updated.engines).toMatchObject({
      paddle: { model: { mkldnn: false } },
    });

    child.kill();
  });
});
