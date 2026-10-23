/**
 * The OCR benchmark **record**: where each engine's numbers come from.
 *
 * A record that says "paddle is unavailable" reads as a fact about paddle,
 * and it is not one - it is a fact about the machine the record was written
 * on (D-109). So the record says, for every engine, WHERE it was measured
 * and WHAT it was measured with, and an engine measured elsewhere carries its
 * numbers, its Python and its date.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** what a measurement says about itself */
type Measurement = {
  /** where the measurement was taken */
  where: string;
  /** what was measured with */
  with: string;
  /** when it was taken, or null when there was nothing to measure */
  at: string | null;
  [key: string]: unknown;
};

/** one engine in the record */
type Engine = {
  name: string;
  /** whether the engine ran ON THE MACHINE THAT TOOK THE RECORD */
  available: boolean;
  /** why it could not be measured here */
  reason?: string;
  /** where its numbers come from */
  measured?: Measurement;
  fullFrame?: { runs: number; medianMs: number | null; p95Ms: number | null };
  subtitleCrop?: {
    runs: number;
    medianMs: number | null;
    p95Ms: number | null;
  };
};

/** the recorded benchmark */
const record = () =>
  JSON.parse(
    readFileSync(join(here, "../ocr/benchmark-result.json"), "utf8"),
  ) as { engines: Record<string, Engine> };

describe("the OCR benchmark record", () => {
  it("AC-146 the benchmark record names paddle as measured elsewhere, with its numbers and its Python", () => {
    const paddle = record().engines.paddle;

    // the measurement IS in the record, and it is marked as taken elsewhere:
    // the owner's Python 3.12.10, not this benchmark's Python 3.14 (which
    // has no paddle wheel at all)
    expect(paddle.measured).toBeTruthy();
    expect(paddle.measured!.where).not.toBe("this machine");
    expect(paddle.measured!.where).toContain("Python 3.12.10");

    // with the Python it was measured with
    expect(paddle.measured!.python).toBe("3.12.10");
    expect(paddle.measured!.with).toContain("paddleocr 3.7.0");
    expect(paddle.measured!.with).toContain("paddlepaddle 3.3.1");

    // and its numbers: the first read (the fast path crashed and the model
    // was rebuilt), the second read (the model that works was reused) and
    // the shipped sidecar inside the built .vsix
    expect(paddle.measured!.firstReadMs).toBe(36086);
    expect(paddle.measured!.secondReadMs).toBe(30601);
    expect(paddle.measured!.shippedSidecarMs).toBe(34668);
    expect(paddle.measured!.lines).toBe(54);
    expect(paddle.measured!.chars).toBe(658);
    expect(paddle.measured!.mkldnn).toBe(false);

    // and the date it was measured on
    expect(paddle.measured!.at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("AC-146 the benchmark test passes whether or not an engine is installed here", () => {
    // The rule is about the RECORD, and it names no engine: every engine
    // either carries measured numbers with its provenance, or says plainly
    // that it could not be measured HERE and why (D-109).
    const check = (engine: Engine) => {
      expect(engine.measured).toBeTruthy();
      expect(engine.measured!.where).toBeTruthy();
      expect(engine.measured!.with).toBeTruthy();

      if (engine.available) {
        // it ran here: the numbers are in the record, and they are dated
        expect(engine.measured!.at).toBeTruthy();
        expect(engine.fullFrame).toBeTruthy();
        expect(engine.fullFrame!.runs).toBeGreaterThan(0);
        expect(engine.fullFrame!.medianMs).not.toBeNull();
        expect(engine.subtitleCrop).toBeTruthy();
        expect(engine.subtitleCrop!.runs).toBeGreaterThan(0);
        expect(engine.subtitleCrop!.medianMs).not.toBeNull();
        return;
      }

      // it could not run here: the record says why
      expect(engine.reason).toBeTruthy();
    };

    for (const engine of Object.values(record().engines)) {
      check(engine);
    }

    // and the same check accepts an engine that ran here and an engine that
    // could not - so it never depends on a particular engine being absent
    check({
      name: "an engine that ran here",
      available: true,
      measured: {
        where: "this machine",
        with: "an engine and a version",
        at: "2026-10-23",
      },
      fullFrame: { runs: 1, medianMs: 1, p95Ms: 1 },
      subtitleCrop: { runs: 1, medianMs: 1, p95Ms: 1 },
    });

    check({
      name: "an engine that could not be measured here",
      available: false,
      reason: "it is not installed on this machine",
      measured: {
        where: "not measured here",
        with: "nothing to measure with",
        at: null,
      },
    });
  });
});
