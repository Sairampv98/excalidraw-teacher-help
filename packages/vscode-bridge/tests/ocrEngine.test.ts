import { resolveOcrEngine } from "../extension/src/ocrEngine";
import {
  engineForRequest,
  resolveEngineState,
} from "../extension/src/ocrEngines";
import { parseBridgeMessage } from "../bridge/src/protocol";

import type { OcrSidecar, OcrSidecarReport } from "../extension/src/ocrSidecar";

/**
 * A sidecar that says what the test says it says.
 *
 * The real one spawns a Python process; the shape of the report is what
 * matters here.
 */
const fakeSidecar = (report: OcrSidecarReport): OcrSidecar => ({
  start: async () => report,
  isRunning: () => true,
  report: () => report,
  recognize: async () => ({ text: "", lines: [] }),
  stop: () => {},
});

describe("the OCR engine", () => {
  it("AC-122 the engine is chosen by a setting, and an unknown value falls back to tesseract", () => {
    // the three engines, by name (D-90)
    expect(resolveOcrEngine("tesseract")).toBe("tesseract");
    expect(resolveOcrEngine("indra")).toBe("indra");
    expect(resolveOcrEngine("paddle")).toBe("paddle");

    // and nothing else is an engine: a value that is not one of them falls
    // back to the default rather than to a broken engine
    expect(resolveOcrEngine("nonsense")).toBe("tesseract");
    expect(resolveOcrEngine("")).toBe("tesseract");
    expect(resolveOcrEngine(undefined)).toBe("tesseract");

    // the setting's value is trimmed and folded, the way a settings UI sends it
    expect(resolveOcrEngine("  INDRA ")).toBe("indra");

    // the request may name an engine too, and the setting is the fallback
    expect(engineForRequest("paddle", "indra")).toBe("paddle");
    expect(engineForRequest(undefined, "indra")).toBe("indra");
    expect(engineForRequest("nonsense", "indra")).toBe("indra");
  });

  it("AC-122 the panel is told which engine is in use", async () => {
    // tesseract: the DECLARED copy is there, so the engine is ready (D-89)
    const tesseract = await resolveEngineState({ engine: "tesseract" });

    expect(tesseract).toEqual({ state: "ready", engine: "tesseract" });

    // indra: the sidecar says it can reach it
    const indra = await resolveEngineState({
      engine: "indra",
      sidecar: fakeSidecar({
        python: "3.14.7",
        engines: { indra: { available: true } },
      }),
    });

    expect(indra).toEqual({ state: "ready", engine: "indra" });

    // and the state is what travels to the panel: it is a message the
    // protocol understands (D-90)
    const parsed = parseBridgeMessage(
      JSON.stringify({
        v: 1,
        type: "ocr:state",
        state: indra.state,
        engine: indra.engine,
      }),
    );

    expect(parsed).toEqual({
      v: 1,
      type: "ocr:state",
      state: "ready",
      engine: "indra",
    });
  });
});
