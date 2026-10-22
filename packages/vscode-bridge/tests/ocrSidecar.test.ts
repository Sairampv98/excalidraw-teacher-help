import { EventEmitter } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createOcrSidecar,
  type OcrSidecarProcess,
  type OcrSidecarReport,
  type OcrSidecarSpawn,
} from "../extension/src/ocrSidecar";

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
});
