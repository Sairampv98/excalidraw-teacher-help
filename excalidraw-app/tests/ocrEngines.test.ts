/**
 * AC-335 - paddle is not offered: the picker and the ladder have the two
 * engines that answer in a moment.
 */

import {
  BROWSER_OCR_ENGINES,
  DEFAULT_PANEL_OCR_ENGINE,
  OCR_ENGINE_CHOICES,
  OCR_LADDER,
  ocrLadderFor,
} from "../ocr/engines";

describe("AC-335 paddle is not offered", () => {
  it("AC-335 the picker offers indra and tesseract, and no other engine", () => {
    expect(OCR_ENGINE_CHOICES.map((choice) => choice.id)).toEqual([
      "indra",
      "tesseract",
    ]);
  });

  it("AC-335 the ladder is indra and then tesseract, with the bridge and without it", () => {
    for (const bridgeConnected of [true, false]) {
      expect(
        ocrLadderFor({ bridgeConnected }).map((step) => step.engine),
      ).toEqual(["indra", "tesseract"]);
    }

    expect(OCR_LADDER.map((rung) => rung.engine)).not.toContain("paddle");
  });

  it("AC-335 the default engine is one of the two, and the browser runs tesseract", () => {
    expect(OCR_ENGINE_CHOICES.map((choice) => choice.id)).toContain(
      DEFAULT_PANEL_OCR_ENGINE,
    );
    expect(BROWSER_OCR_ENGINES).toEqual(["tesseract"]);
  });
});
