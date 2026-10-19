import { describe, expect, it } from "vitest";

import { buildPdf } from "../pages/pdf";

import type { PdfPageImage } from "../pages/pdf";

/**
 * A PDF is a byte-level format: object offsets have to point at real positions
 * or a reader refuses to open the file. jsdom cannot render one, so these build
 * PDFs from byte images and then check the structure that actually decides
 * whether the file opens — the header, the cross-reference table, and whether
 * every recorded offset lands on its object's own header.
 */
const image = (width: number, height: number): PdfPageImage => ({
  width,
  height,
  data: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
  filter: "DCTDecode",
});

const asText = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("buildPdf", () => {
  it("writes a PDF header and trailer", () => {
    const pdf = buildPdf({ pages: [image(1920, 1080)] });
    const text = asText(pdf);

    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toContain("%%EOF");
    expect(text).toContain("trailer");
  });

  it("declares every page in the page tree", () => {
    const pdf = buildPdf({ pages: [image(1920, 1080), image(1920, 1080)] });
    const text = asText(pdf);

    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Count 2");
    // one page object and one image per page
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(2);
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
  });

  it("sizes the page in points at 96dpi", () => {
    // 1920x1080 px is 1440x810 pt, so the PDF page is a sane physical size
    // rather than a 26-inch sheet
    const pdf = buildPdf({ pages: [image(1920, 1080)] });

    expect(asText(pdf)).toContain("/MediaBox [0 0 1440 810]");
  });

  it("records the filter the image data actually uses", () => {
    const pdf = buildPdf({ pages: [image(1920, 1080)] });

    expect(asText(pdf)).toContain("/Filter /DCTDecode");
  });

  it("records the image byte length it was given", () => {
    const pdf = buildPdf({ pages: [image(1920, 1080)] });

    expect(asText(pdf)).toContain("/Length 4");
  });

  it("keeps stream lengths equal to the bytes written", () => {
    // a /Length that disagrees with the stream is the classic way a hand-built
    // PDF gets rejected, so it is checked against what was actually written
    const data = new Uint8Array(37).fill(9);
    const pdf = buildPdf({
      pages: [{ width: 8, height: 8, data, filter: "FlateDecode" }],
    });
    const text = asText(pdf);

    expect(text).toContain(`/Filter /FlateDecode`);
    expect(text).toContain(`/Length ${data.length}`);
  });

  it("points every cross-reference entry at its own object", () => {
    const pdf = buildPdf({ pages: [image(1920, 1080), image(1920, 1080)] });
    const text = asText(pdf);

    const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1] ?? "-1");

    expect(startxref).toBeGreaterThan(0);
    expect(text.startsWith("xref", startxref)).toBe(true);

    // entries are 20 bytes each, the first being the free head of the list
    const xrefBody = text.slice(startxref + "xref\n".length);
    const entries = xrefBody
      .split("\n")
      .filter((line) => /^\d{10} \d{5} [nf] $/.test(line))
      .map((line) => Number(line.slice(0, 10)));

    // 8 real objects for two pages, plus the free head of the list
    expect(entries.length).toBe(9);

    // each offset must land exactly on "<n> 0 obj"
    for (const [index, offset] of entries.entries()) {
      if (index === 0) {
        // the free entry is always zeroes and never points anywhere
        expect(offset).toBe(0);
        continue;
      }

      expect(text.startsWith(`${index} 0 obj`, offset)).toBe(true);
    }
  });

  it("scales the page count in the trailer", () => {
    const pdf = buildPdf({ pages: [image(8, 8), image(8, 8), image(8, 8)] });

    // 1 catalog + 1 page tree + 3 objects per page
    expect(asText(pdf)).toContain("/Size 12");
  });

  it("refuses to build a PDF with no pages", () => {
    // better a clear error than a structurally invalid file
    expect(() => buildPdf({ pages: [] })).toThrow(/at least one page/i);
  });
});
