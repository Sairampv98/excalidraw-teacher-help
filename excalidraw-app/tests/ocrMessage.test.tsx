/**
 * AC-340 - the sentence that says how a read went is one sentence: no reason
 * is followed by a second full stop, and a long one wraps inside the panel's
 * properties instead of running out of them.
 */

import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { render } from "@excalidraw/excalidraw/tests/test-utils";

import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { ocrLadderMessage } from "../bridge/useOcr";
import { BRIDGE_NEEDED_REASON } from "../ocr/engines";

describe("AC-340 the sentence of a read", () => {
  it("AC-340 a reason that ends with a full stop is not followed by another", () => {
    const message = ocrLadderMessage({
      lines: 2,
      engine: "tesseract",
      durationMs: 137,
      skipped: [{ engine: "indra", reason: BRIDGE_NEEDED_REASON }],
    });

    expect(message).not.toContain("..");
    expect(message).toContain(
      "indra was not used: the bridge is not connected: start the Excalidraw Bridge extension in VS Code.",
    );
  });

  it("AC-340 a reason without a full stop gets exactly one", () => {
    const message = ocrLadderMessage({
      skipped: [{ engine: "tesseract", reason: "no web workers" }],
    });

    expect(message).toContain("tesseract was not used: no web workers.");
    expect(message).not.toContain("..");
  });

  it("AC-340 a long sentence wraps inside the panel's properties", async () => {
    const element = API.createElement({
      type: "panel",
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      panelKind: "image",
      panel: {
        source: { type: "inline", payload: null },
        options: { naturalWidth: 400, naturalHeight: 300, captions: null },
      },
      posterMode: false,
      posterFileId: null,
    }) as unknown as ExcalidrawPanelElement;

    await render(
      <Excalidraw
        initialData={{ elements: [element] as unknown as ExcalidrawElement[] }}
        panelOcr={{
          message: `Read 2 lines with tesseract in 137 ms. ${"indra was not used because the bridge is not connected. ".repeat(
            3,
          )}`,
          onOcr: () => undefined,
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setSelectedElements([
      element as unknown as NonDeletedExcalidrawElement,
    ]);

    const sentence = document.querySelector(
      '[data-testid="panel-ocr-message"]',
    ) as HTMLElement;

    expect(sentence).not.toBeNull();

    // the style is what lets the words break at the edge of the panel
    const style = sentence.getAttribute("style") ?? "";

    expect(style).toContain("display: block");
    expect(style).toContain("overflow-wrap: anywhere");
    expect(style).toContain("max-width: 100%");
  });
});
