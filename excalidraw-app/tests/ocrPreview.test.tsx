/**
 * AC-316 - what an OCR read found is shown before it goes anywhere, and the
 * teacher chooses what to do with it.
 */

import { vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { OcrPreview } from "../components/OcrPreview";

const { h } = window;

const line = (text: string, x: number, y: number) => ({
  text,
  x,
  y,
  width: text.length * 10,
  height: 20,
});

const LINES = [
  line("def hello(name):", 0, 0),
  line("print(name)", 40, 25),
  line("return 1", 40, 50),
];

const liveElements = () => h.elements.filter((element) => !element.isDeleted);

/** the preview inside the editor, so it has the real API to put things on */
const openPreview = async () => {
  const onClose = vi.fn();

  const utils = await render(
    <Excalidraw pagesEnabled={true}>
      <OcrPreview
        data={{ lines: LINES, engine: "tesseract", durationMs: 796 }}
        onClose={onClose}
      />
    </Excalidraw>,
  );

  return { onClose, ...utils };
};

describe("AC-316 the OCR preview", () => {
  it("AC-316 the text is shown with its indentation, and nothing is on the page yet", async () => {
    await openPreview();

    const area = document.querySelector(
      '[data-testid="ocr-preview-text"]',
    ) as HTMLTextAreaElement;

    expect(area.value).toBe(
      ["def hello(name):", "    print(name)", "    return 1"].join("\n"),
    );

    // nothing was put on the page by showing it
    expect(liveElements()).toHaveLength(0);
  });

  it("AC-316 paste as text puts one text block on the page", async () => {
    const { onClose, getByText } = await openPreview();

    await act(async () => {
      fireEvent.click(getByText("Paste as text"));
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const texts = liveElements().filter((element) => element.type === "text");

    expect(texts).toHaveLength(1);
    expect((texts[0] as unknown as { text: string }).text).toContain(
      "    print(name)",
    );
  });

  it("AC-316 paste as code block puts a code card on the page", async () => {
    const { onClose, getByText } = await openPreview();

    await act(async () => {
      fireEvent.click(getByText("Paste as code block"));
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const elements = liveElements();

    expect(elements.some((element) => element.type === "rectangle")).toBe(true);
    expect(
      elements.filter((element) => element.type === "text").length,
    ).toBeGreaterThan(1);
  });

  it("AC-316 cancel closes the preview and puts nothing on the page", async () => {
    const { onClose, getByText } = await openPreview();

    fireEvent.click(getByText("Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(liveElements()).toHaveLength(0);
  });
});
