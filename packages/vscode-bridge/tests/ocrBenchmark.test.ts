/**
 * The OCR **benchmark**: the numbers the engine really did on this machine.
 *
 * AC-75: the OCR benchmark is recorded — median and p95, full frame and
 *        subtitle crop.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, join } from "node:path";

/** The repository root, found by walking up from the working directory. */
const findRepoRoot = (): string => {
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "excalidraw-app", "App.tsx");
    if (existsSync(candidate)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("the repository root was not found");
};

const repoRoot = findRepoRoot();

const record = JSON.parse(
  readFileSync(
    join(repoRoot, "excalidraw-app", "ocr", "benchmark-result.json"),
    "utf8",
  ),
);

type Case = {
  runs: number;
  medianMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  samplesMs: number[];
  region: { x: number; y: number; width: number; height: number } | null;
};

describe("the OCR benchmark", () => {
  it("AC-75 the benchmark is recorded — median and p95, full frame and subtitle crop", () => {
    const fullFrame = record.cases.fullFrame as Case;
    const subtitleCrop = record.cases.subtitleCrop as Case;

    // both cases are measured, with the numbers the run really produced
    expect(fullFrame.runs).toBeGreaterThan(0);
    expect(subtitleCrop.runs).toBeGreaterThan(0);

    expect(fullFrame.medianMs).not.toBeNull();
    expect(fullFrame.p95Ms).not.toBeNull();
    expect(subtitleCrop.medianMs).not.toBeNull();
    expect(subtitleCrop.p95Ms).not.toBeNull();

    // the samples are the run, not a summary of a summary
    expect(fullFrame.samplesMs).toHaveLength(fullFrame.runs);
    expect(subtitleCrop.samplesMs).toHaveLength(subtitleCrop.runs);

    // the crop is a subtitle band: a small fraction of the frame
    expect(subtitleCrop.region).not.toBeNull();
    expect(subtitleCrop.region!.height).toBeLessThan(
      fullFrame.region?.height ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("AC-75 the budget is met — a full frame under 1.5 s, a subtitle crop under 250 ms", () => {
    const fullFrame = record.cases.fullFrame as Case;
    const subtitleCrop = record.cases.subtitleCrop as Case;

    expect(record.budget.fullFrameMs).toBe(1500);
    expect(record.budget.subtitleCropMs).toBe(250);

    // the crop budget is the one that matters, and it is measured on its own
    // numbers — the full frame's number never stands in for it
    expect(subtitleCrop.p95Ms!).toBeLessThan(record.budget.subtitleCropMs);
    expect(fullFrame.p95Ms!).toBeLessThan(record.budget.fullFrameMs);

    expect(record.verdict.fullFrameMet).toBe(true);
    expect(record.verdict.subtitleCropMet).toBe(true);
  });

  it("AC-75 the numbers were taken on this machine, with the engine's levers in place", () => {
    // the machine the numbers were taken on is this one
    expect(record.machine.platform).toBe(platform());
    expect(record.machine.arch).toBe(arch());
    expect(record.machine.cpus).toBe(cpus().length);
    expect(Math.round(record.machine.totalMemoryMb)).toBe(
      Math.round(totalmem() / (1024 * 1024)),
    );

    // and the levers the design names are the ones that were used: one worker,
    // the language data cached, and the core NOT pinned to a single file (so
    // the loader can pick the SIMD core)
    expect(record.engine.name).toBe("tesseract.js");
    expect(record.engine.workerCreatedOnce).toBe(true);
    expect(record.engine.languageDataUncached).toBe(false);
    expect(record.engine.corePathPinnedToSingleFile).toBe(false);
  });

  it("AC-126 the benchmark reports every engine, with its median and p95 for both cases", () => {
    const engines = record.engines as Record<
      string,
      {
        name: string;
        available: boolean;
        reason?: string;
        fullFrame?: Case;
        subtitleCrop?: Case;
      }
    >;

    // EVERY engine is in the record: the engine is a choice, and a choice the
    // teacher cannot measure is a choice the teacher cannot make (D-90)
    expect(Object.keys(engines).sort()).toEqual([
      "indra",
      "paddle",
      "tesseract",
    ]);

    for (const [name, engine] of Object.entries(engines)) {
      expect(engine.name).toBe(name);

      if (!engine.available) {
        // the engine could not run here: it says WHY (D-126)
        expect(engine.reason).toBeTruthy();
        expect(engine.fullFrame).toBeUndefined();
        continue;
      }

      // and an engine that ran has the numbers for BOTH cases
      const fullFrame = engine.fullFrame as Case;
      const subtitleCrop = engine.subtitleCrop as Case;

      expect(fullFrame.runs).toBeGreaterThan(0);
      expect(subtitleCrop.runs).toBeGreaterThan(0);
      expect(fullFrame.medianMs).not.toBeNull();
      expect(fullFrame.p95Ms).not.toBeNull();
      expect(subtitleCrop.medianMs).not.toBeNull();
      expect(subtitleCrop.p95Ms).not.toBeNull();

      // the samples are the run, not a summary of a summary
      expect(fullFrame.samplesMs).toHaveLength(fullFrame.runs);
      expect(subtitleCrop.samplesMs).toHaveLength(subtitleCrop.runs);

      // and the crop really is a crop
      expect(subtitleCrop.region).not.toBeNull();
    }
  });

  it("AC-126 an engine that could not be measured says why", () => {
    const engines = record.engines as Record<
      string,
      { available: boolean; reason?: string }
    >;

    // PaddleOCR cannot be installed on this machine's Python 3.14, because
    // PaddlePaddle ships no cp314 wheel. That is a fact to REPORT, not a
    // failure to hide (D-91, D-126).
    const paddle = engines.paddle;

    expect(paddle.available).toBe(false);
    expect(paddle.reason).toBeTruthy();
    expect(paddle.reason).toContain("pip install paddleocr paddlepaddle");
    expect(paddle.reason).toContain(
      "PaddlePaddle has no build for Python 3.14",
    );
    expect(paddle.reason).toContain("3.12 or 3.13");
  });
});
