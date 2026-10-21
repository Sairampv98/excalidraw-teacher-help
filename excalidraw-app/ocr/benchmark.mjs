/**
 * The OCR benchmark.
 *
 * The OCR budget is a **gate**, not a hope:
 *
 * - a full 1080p frame has to be read in under **1.5 s**;
 * - a subtitle-band crop has to be read in under **250 ms**.
 *
 * The levers, in order: the **ROI crop** (free, and the biggest one), then the
 * SIMD core, then the fast language data. This script measures the first one
 * and keeps the other two in reach:
 *
 * - the worker is created **once** and reused for every read — a worker per
 *   read would pay for the start-up every time;
 * - the language data is **not** uncached (no `cachePath: ""`), so a read does
 *   not pay for the download again;
 * - the core is **not** pinned to a single `.js` file (no `corePath`), so the
 *   loader can pick the SIMD core when the machine has one.
 *
 * ## The engine is the bridge's engine
 *
 * OCR is a **service**: the engine is tesseract.js, running in the bridge's
 * Node process. The app does not depend on it — that is the point of the OCR
 * hook (`excalidraw-app/ocrClient.ts`) — so the engine is installed **outside**
 * the repository and pointed at:
 *
 *     yarn --cwd <engine-dir> add tesseract.js
 *
 * ## Running it
 *
 *     node excalidraw-app/ocr/benchmark.mjs \
 *       --engine <engine-dir> \
 *       --frame <frame-1080p.png> \
 *       --crop <subtitle-band.png> \
 *       --region 0,900,1920,180 \
 *       --runs 10 \
 *       --out excalidraw-app/ocr/benchmark-result.json
 *
 * The two images are a 1080p screencast frame and the crop of its subtitle
 * band; `make-frames.py` (next to this file) makes them, so the numbers in the
 * record can be reproduced on another machine.
 */

import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { cpus, totalmem } from "node:os";

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

const engineDir = args.engine;
const framePath = args.frame;
const cropPath = args.crop;
const outPath = args.out ?? "excalidraw-app/ocr/benchmark-result.json";
const runs = Number(args.runs ?? 10);

if (!engineDir || !framePath || !cropPath) {
  console.error(
    "usage: node benchmark.mjs --engine <dir> --frame <png> --crop <png> [--region x,y,w,h] [--runs n] [--out <json>]",
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
 * alive — that is the lever the design names first.
 */
const measure = async (worker, path, count) => {
  const samples = [];

  await worker.recognize(path);

  for (let i = 0; i < count; i += 1) {
    const started = performance.now();

    await worker.recognize(path);

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

const run = async () => {
  // ONE worker, reused for every read
  const worker = await createWorker("eng");

  try {
    const frameSamples = await measure(worker, framePath, runs);
    const cropSamples = await measure(worker, cropPath, runs);

    const record = {
      recordedAt: new Date().toISOString(),
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
      cases: {
        fullFrame: {
          image: basename(framePath),
          region: null,
          ...summarise(frameSamples),
        },
        subtitleCrop: {
          image: basename(cropPath),
          region,
          ...summarise(cropSamples),
        },
      },
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
  } finally {
    await worker.terminate();
  }
};

if (!existsSync(framePath) || !existsSync(cropPath)) {
  console.error("the frame or the crop is missing");
  process.exit(2);
}

await run();
