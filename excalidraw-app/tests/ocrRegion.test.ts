/**
 * The OCR request's **region**, and the OCR **benchmark**.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createOcrClient } from "../ocrClient";

import type { OcrRegion } from "../ocrClient";

const here = dirname(fileURLToPath(import.meta.url));

/** the recorded benchmark: the numbers this machine measured */
const benchmark = () =>
  JSON.parse(
    readFileSync(join(here, "../ocr/benchmark-result.json"), "utf8"),
  ) as {
    engine: {
      name: string;
      version: string;
      language: string;
      workerCreatedOnce: boolean;
      languageDataUncached: boolean;
      corePathPinnedToSingleFile: boolean;
    };
    budget: { fullFrameMs: number; subtitleCropMs: number };
    cases: {
      fullFrame: { medianMs: number; p95Ms: number; runs: number };
      subtitleCrop: {
        medianMs: number;
        p95Ms: number;
        runs: number;
        region: OcrRegion | null;
      };
    };
    verdict: { fullFrameMet: boolean; subtitleCropMet: boolean };
  };

describe("the OCR request carries the region", () => {
  it("AC-69 the OCR request carries the ROI region", async () => {
    const region: OcrRegion = { x: 0, y: 900, width: 1920, height: 180 };

    let body: Record<string, unknown> = {};

    const client = createOcrClient({
      endpoint: "http://127.0.0.1:47511/ocr",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}"));

        return new Response(JSON.stringify({ text: "a caption", blocks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    await client.recognize({
      dataURL: "data:image/png;base64,AAAA",
      mimeType: "image/png",
      language: "en",
      region,
    });

    // the region travels in the image's own pixels, so the service can crop
    // before it reads — the one lever that costs nothing and buys the most
    expect(body.region).toEqual(region);
  });

  it("AC-69 a request without a region reads the whole image", async () => {
    let body: Record<string, unknown> = {};

    const client = createOcrClient({
      endpoint: "http://127.0.0.1:47511/ocr",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}"));

        return new Response(JSON.stringify({ text: "", blocks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    await client.recognize({
      dataURL: "data:image/png;base64,AAAA",
      mimeType: "image/png",
    });

    expect(body.region).toBeNull();
  });

  it("AC-69 the OCR benchmark is recorded: median and p95, full frame and subtitle crop", () => {
    const record = benchmark();

    // both cases are measured, and each carries a median and a p95
    for (const name of ["fullFrame", "subtitleCrop"] as const) {
      const measured = record.cases[name];

      expect(measured.runs).toBeGreaterThan(0);
      expect(typeof measured.medianMs).toBe("number");
      expect(typeof measured.p95Ms).toBe("number");
      expect(measured.medianMs).toBeGreaterThan(0);
      expect(measured.p95Ms).toBeGreaterThan(0);
    }

    // the crop is a region of the frame, in the frame's own pixels
    expect(record.cases.subtitleCrop.region).toMatchObject({
      width: 1920,
      height: 180,
    });

    // the levers the design names are the ones the numbers were taken with
    expect(record.engine.workerCreatedOnce).toBe(true);
    expect(record.engine.languageDataUncached).toBe(false);
    expect(record.engine.corePathPinnedToSingleFile).toBe(false);

    // and the verdict against the budget is stated, either way
    expect(typeof record.verdict.fullFrameMet).toBe("boolean");
    expect(typeof record.verdict.subtitleCropMet).toBe("boolean");
  });

  it("AC-69 the measured numbers meet the budget", () => {
    const record = benchmark();

    // a full 1080p frame under 1.5 s, a subtitle-band crop under 250 ms
    expect(record.budget.fullFrameMs).toBe(1500);
    expect(record.budget.subtitleCropMs).toBe(250);

    expect(record.cases.fullFrame.p95Ms).toBeLessThan(
      record.budget.fullFrameMs,
    );
    expect(record.cases.subtitleCrop.p95Ms).toBeLessThan(
      record.budget.subtitleCropMs,
    );
  });
});
