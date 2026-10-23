/**
 * The OCR benchmark - **every engine** (D-90).
 *
 * The OCR budget is a **gate**, not a hope:
 *
 * - a full 1080p frame has to be read in under **1.5 s**;
 * - a subtitle-band crop has to be read in under **250 ms**.
 *
 * The budget is a gate for **every** engine, not for one: the engine is a
 * choice (`excalidraw-bridge.ocrEngine`), and a choice the teacher cannot
 * measure is a choice the teacher cannot make. So the record names each
 * engine, gives the **median** and the **p95** for both cases, and - for an
 * engine that cannot run here - says **why** (D-126).
 *
 * ## Where each engine's numbers come from (D-109)
 *
 * A record that says "paddle is unavailable" reads as a fact about paddle,
 * and it is not one: it is a fact about the machine the record was written
 * on. So every engine carries a **`measured`** block that says **where** the
 * numbers were taken and **what** they were taken with, and an engine that
 * was measured **elsewhere** carries its numbers, its Python and its date.
 *
 * A measurement taken on another machine is still a number, so this script
 * does not lose one: a measurement that was taken elsewhere is carried into
 * the new record, with its provenance.
 *
 * The levers, in order: the **ROI crop** (free, and the biggest one), then the
 * SIMD core, then the fast language data. This script measures the first one
 * and keeps the other two in reach:
 *
 * - the worker is created **once** and reused for every read - a worker per
 *   read would pay for the start-up every time;
 * - the language data is **not** uncached (no `cachePath: ""`), so a read does
 *   not pay for the download again;
 * - the core is **not** pinned to a single `.js` file (no `corePath`), so the
 *   loader can pick the SIMD core when the machine has one.
 *
 * ## The engines
 *
 * - `tesseract` runs **here**, in this process. It is the declared dependency
 *   that ships inside the `.vsix` (D-89), and `--engine` points at the tree it
 *   is in.
 * - `indra` and `paddle` are **Python**, so they run in the **sidecar** the
 *   extension spawns: one process, spawned once, spoken to over stdio, one
 *   JSON object per line (D-90). The sidecar reports which engines it can
 *   reach **without importing them**, and the reason for the ones it cannot -
 *   which is what the record carries for an engine that could not be measured.
 *
 * ## Running it
 *
 *     node excalidraw-app/ocr/benchmark.mjs \
 *       --engine <engine-dir> \
 *       --python <python.exe> \
 *       --frame <frame-1080p.png> \
 *       --region 0,900,1920,180 \
 *       --runs 10 \
 *       --out excalidraw-app/ocr/benchmark-result.json
 *
 * The image is a 1080p screencast frame; `make-frames.py` (next to this file)
 * makes it, so the numbers in the record can be reproduced on another machine.
 *
 * The **crop** is measured through the region's rectangle, on the very same
 * frame: that is the ROI lever, and it is measured the way the service uses
 * it - the engine reads only that part of the picture.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

const parseArgs = (argv) => {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
};

/** the nearest-rank percentile: the smallest value at or above the rank */
const percentile = (values, p) => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);

  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
};

const median = (values) => percentile(values, 50);

const args = parseArgs(process.argv.slice(2));

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const engineDir = args.engine;
const framePath = args.frame;
const outPath = args.out ?? "excalidraw-app/ocr/benchmark-result.json";
const runs = Number(args.runs ?? 10);
const pythonPath = args.python ?? "python";
const sidecarPath =
  args.sidecar ??
  join(
    repoRoot,
    "packages",
    "vscode-bridge",
    "extension",
    "media",
    "ocr_sidecar.py",
  );

if (!engineDir || !framePath) {
  console.error(
    "usage: node benchmark.mjs --engine <dir> --frame <png> [--python <exe>] [--region x,y,w,h] [--runs n] [--out <json>]",
  );
  process.exit(2);
}

const region = args.region
  ? (() => {
      const [x, y, width, height] = args.region.split(",").map(Number);

      return { x, y, width, height };
    })()
  : null;

const require = createRequire(join(engineDir, "package.json"));
const { createWorker } = require("tesseract.js");
const engineVersion = require("tesseract.js/package.json").version;

/**
 * Reads one image, `runs` times, with the worker that already exists.
 *
 * The first read of a fresh worker is a **warm-up**: it pays for the page
 * setup and for whatever the engine loads lazily. It is not part of the
 * measurement, because the service that answers the app keeps its worker
 * alive - that is the lever the design names first.
 *
 * `rectangle` is the **ROI crop**: the engine reads only that part of the
 * image, which is exactly what the service does when a request carries a
 * region. The boxes it reports are still in the whole image's pixels.
 */
const measure = async (worker, path, count, rectangle = null) => {
  const samples = [];

  await worker.recognize(path, rectangle ? { rectangle } : {});

  for (let i = 0; i < count; i += 1) {
    const started = performance.now();

    await worker.recognize(path, rectangle ? { rectangle } : {});

    samples.push(Math.round(performance.now() - started));
  }

  return samples;
};

const summarise = (samples) => ({
  runs: samples.length,
  medianMs: median(samples),
  p95Ms: percentile(samples, 95),
  minMs: Math.min(...samples),
  maxMs: Math.max(...samples),
  samplesMs: samples,
});

/**
 * The record this run is about to replace, if there is one.
 *
 * A measurement taken on ANOTHER machine is still a number (D-109), so the
 * previous record's elsewhere-measurements are carried into the new one: a
 * re-run on a machine that cannot reach an engine must not throw away the
 * measurement that another machine took.
 */
const readPreviousRecord = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The measurement of an engine that was taken somewhere ELSE, if there is
 * one (D-109). A measurement taken on this machine is not carried: this run
 * takes its own.
 */
const carriedMeasurement = (previous, engine) => {
  const measured = previous?.engines?.[engine]?.measured;

  if (!measured || measured.where === "this machine") {
    return null;
  }

  return measured;
};

/**
 * The sidecar, spoken to over stdio.
 *
 * It is the same protocol the extension uses - one JSON object per line - and
 * the sidecar is spawned **once** and reused for every read, exactly as the
 * extension does it (D-90).
 */
const openSidecar = () =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonPath, [sidecarPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    let nextId = 0;
    let report = null;
    const pending = new Map();

    const onReport = { resolve: null, reject: null };
    const reportPromise = new Promise((resolveReport, rejectReport) => {
      onReport.resolve = resolveReport;
      onReport.reject = rejectReport;
    });

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

        let message;

        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.type === "ready") {
          report = message;
          onReport.resolve?.(message);
          onReport.resolve = null;
          continue;
        }

        const entry = pending.get(message.id);

        if (!entry) {
          continue;
        }

        pending.delete(message.id);

        if (message.error) {
          entry.reject(new Error(message.error));
        } else {
          entry.resolve(message);
        }
      }
    });

    child.stderr.on("data", () => {
      // the sidecar's own output is not the protocol
    });

    child.on("error", (error) => {
      onReport.reject?.(error);
      onReport.reject = null;
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
    });

    child.on("exit", (code) => {
      const error = new Error(
        `the OCR sidecar stopped (exit code ${String(code)})`,
      );
      onReport.reject?.(error);
      onReport.reject = null;
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
    });

    resolvePromise({
      report: () => report,
      reportPromise,
      recognize: (request) => {
        const id = `${++nextId}`;

        return new Promise((resolveAnswer, rejectAnswer) => {
          pending.set(id, { resolve: resolveAnswer, reject: rejectAnswer });
          child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
        });
      },
      close: () => {
        child.kill();
      },
    });
  });

/** The tesseract engine: one worker, reused for every read. */
const measureTesseract = async () => {
  const worker = await createWorker("eng");

  try {
    const frameSamples = await measure(worker, framePath, runs);
    const cropSamples = await measure(
      worker,
      framePath,
      runs,
      region
        ? {
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
          }
        : null,
    );

    return cases(frameSamples, cropSamples);
  } finally {
    await worker.terminate();
  }
};

/** The two cases of an engine, with the region the crop was taken from. */
const cases = (frameSamples, cropSamples) => ({
  fullFrame: {
    image: basename(framePath),
    region: null,
    ...summarise(frameSamples),
  },
  subtitleCrop: {
    image: basename(framePath),
    region,
    ...summarise(cropSamples),
  },
});

/** A Python engine, through the sidecar: one process, reused for every read. */
const measureSidecarEngine = async (engine, sidecar) => {
  const imageBase64 = readFileSync(framePath).toString("base64");

  const read = async (withRegion) => {
    const started = performance.now();

    await sidecar.recognize({
      engine,
      imageBase64,
      ...(withRegion ? { region } : {}),
    });

    return Math.round(performance.now() - started);
  };

  // the warm-up: the model is loaded on the first read, and it is kept
  await read(false);

  const frameSamples = [];

  for (let i = 0; i < runs; i += 1) {
    frameSamples.push(await read(false));
  }

  const cropSamples = [];

  for (let i = 0; i < runs; i += 1) {
    cropSamples.push(await read(Boolean(region)));
  }

  return cases(frameSamples, cropSamples);
};

const run = async () => {
  const engines = {};

  const recordedAt = new Date().toISOString();
  const previous = readPreviousRecord(outPath);

  // tesseract: the engine that ships inside the .vsix (D-89)
  const tesseract = await measureTesseract();

  engines.tesseract = {
    name: "tesseract",
    available: true,
    version: engineVersion,
    // where these numbers come from (D-109)
    measured: {
      where: "this machine",
      with: `tesseract.js ${engineVersion}, in the benchmark process`,
      at: recordedAt,
    },
    ...tesseract,
  };

  // the Python engines: they run in the sidecar (D-90)
  const pythonEngines = ["indra", "paddle"];
  let sidecar = null;

  try {
    sidecar = await openSidecar();
    const report = await sidecar.reportPromise;

    for (const engine of pythonEngines) {
      const entry = report.engines?.[engine];

      if (!entry?.available) {
        engines[engine] = {
          name: engine,
          available: false,
          // WHY it could not be measured: an engine that could not run is a
          // fact to report, not a failure to hide (D-126)
          reason:
            entry?.reason ??
            `the OCR sidecar (Python ${report.python}) cannot reach ${engine}`,
          // and the measurement that WAS taken, wherever it was taken: an
          // engine that could not run HERE is not a verdict on the engine
          // (D-109)
          measured:
            carriedMeasurement(previous, engine) ?? {
              where: "not measured here",
              with: `no ${engine} on this machine's Python ${report.python}`,
              at: null,
            },
        };
        continue;
      }

      engines[engine] = {
        name: engine,
        available: true,
        python: report.python,
        // where these numbers come from (D-109)
        measured: {
          where: "this machine",
          with: `${engine}, through the OCR sidecar on Python ${report.python}`,
          at: recordedAt,
        },
        ...(await measureSidecarEngine(engine, sidecar)),
      };
    }
  } catch (error) {
    // the sidecar itself could not be started: every Python engine is out,
    // and the reason says so
    for (const engine of pythonEngines) {
      if (engines[engine]) {
        continue;
      }
      engines[engine] = {
        name: engine,
        available: false,
        reason: `the OCR sidecar could not be started (${pythonPath}): ${error.message}`,
        // a measurement taken elsewhere is still a number (D-109)
        measured: carriedMeasurement(previous, engine) ?? {
          where: "not measured here",
          with: `the OCR sidecar could not be started (${pythonPath})`,
          at: null,
        },
      };
    }
  } finally {
    sidecar?.close();
  }

  const record = {
    recordedAt,
    engine: {
      name: "tesseract.js",
      version: engineVersion,
      language: "eng",
      // the levers, as they were set when the numbers were taken
      workerCreatedOnce: true,
      languageDataUncached: false,
      corePathPinnedToSingleFile: false,
    },
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: cpus()[0]?.model ?? "unknown",
      cpus: cpus().length,
      totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
    },
    budget: {
      fullFrameMs: 1500,
      subtitleCropMs: 250,
    },
    inputs: {
      note: "a 1080p screencast frame and the crop of its subtitle band; make-frames.py (next to this file) makes them",
    },
    // the default engine's cases, under the old name: the record has always
    // carried the tesseract numbers at the top, and the per-engine section
    // below carries them again
    cases: tesseract,
    // EVERY engine, with its median and p95 for both cases - and, for an
    // engine that could not run, the reason why (D-126). Every engine also
    // says WHERE its numbers come from (D-109).
    engines,
  };

  record.verdict = {
    fullFrameMet:
      record.cases.fullFrame.p95Ms !== null &&
      record.cases.fullFrame.p95Ms < record.budget.fullFrameMs,
    subtitleCropMet:
      record.cases.subtitleCrop.p95Ms !== null &&
      record.cases.subtitleCrop.p95Ms < record.budget.subtitleCropMs,
  };

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(record, null, 2));
};

if (!existsSync(framePath)) {
  console.error("the frame is missing");
  process.exit(2);
}

await run();
