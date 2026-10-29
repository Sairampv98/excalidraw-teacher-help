/**
 * AC-329 - the teacher chooses what part of a page is read, before it is read.
 *
 * The whole page is shown first; the area they drag out (or the whole page, when
 * they say so) is what the reader gets, in the picture's own pixels.
 */

import { vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";
import { appJotaiStore, pdfPageReadRequestAtom } from "../app-jotai";
import { OcrAreaDialog } from "../components/OcrAreaDialog";
import { browserOcr } from "../ocr/browserOcr";

/** a page picture of 1000 x 2000 pixels */
const PICTURE = {
  dataURL: "data:image/png;base64,SU1BR0U=",
  width: 1000,
  height: 2000,
};

/** the picture is drawn on the screen at half its own size: 500 x 1000 */
const mockLayout = () => {
  const original = HTMLElement.prototype.getBoundingClientRect;

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.testid === "ocr-area-picture") {
        return {
          left: 0,
          top: 0,
          right: 500,
          bottom: 1000,
          width: 500,
          height: 1000,
          x: 0,
          y: 0,
          toJSON() {},
        } as DOMRect;
      }

      return original.call(this);
    },
  );
};

const pointer = (target: Element, type: string, x: number, y: number) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }),
  );

/** drags over the picture from one screen point to another */
const drag = (from: [number, number], to: [number, number]) => {
  const picture = document.querySelector('[data-testid="ocr-area-picture"]')!;

  act(() => {
    pointer(picture, "pointerdown", ...from);
    pointer(picture, "pointermove", ...to);
    pointer(picture, "pointerup", ...to);
  });
};

const button = (label: string) =>
  [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  )!;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AC-329 the area to read is chosen before the page is read", () => {
  const openDialog = async () => {
    const onRead = vi.fn();
    const onClose = vi.fn();

    mockLayout();

    await render(
      <Excalidraw>
        <OcrAreaDialog picture={PICTURE} onRead={onRead} onClose={onClose} />
      </Excalidraw>,
    );

    return { onRead, onClose };
  };

  it("AC-329 dragging over the picture marks an area, which is read in the picture's own pixels", async () => {
    const { onRead } = await openDialog();

    // no area yet: only the whole page can be read
    expect(button("Read this area").disabled).toBe(true);

    drag([50, 100], [250, 300]);

    // the area is drawn over the picture
    const marked = document.querySelector(
      '[data-testid="ocr-area-box"]',
    ) as HTMLElement;

    expect(parseFloat(marked.style.left)).toBeCloseTo(10, 5);
    expect(parseFloat(marked.style.top)).toBeCloseTo(10, 5);
    expect(parseFloat(marked.style.width)).toBeCloseTo(40, 5);
    expect(parseFloat(marked.style.height)).toBeCloseTo(20, 5);

    fireEvent.click(button("Read this area"));

    // the screen is half the picture, so the pixels are twice the screen's
    expect(onRead).toHaveBeenCalledWith({
      x: 100,
      y: 200,
      width: 400,
      height: 400,
    });
  });

  it("AC-329 the area follows a drag in any direction and stays on the picture", async () => {
    const { onRead } = await openDialog();

    // from the bottom right, past the edge, up and to the left
    drag([450, 900], [800, 1500]);
    fireEvent.click(button("Read this area"));

    expect(onRead).toHaveBeenLastCalledWith({
      x: 900,
      y: 1800,
      width: 100,
      height: 200,
    });

    drag([300, 600], [100, 200]);
    fireEvent.click(button("Read this area"));

    expect(onRead).toHaveBeenLastCalledWith({
      x: 200,
      y: 400,
      width: 400,
      height: 800,
    });
  });

  it("AC-329 a click without a drag is no area, and an area can be cleared", async () => {
    await openDialog();

    drag([100, 100], [100, 100]);

    expect(document.querySelector('[data-testid="ocr-area-box"]')).toBeNull();
    expect(button("Read this area").disabled).toBe(true);

    drag([50, 100], [250, 300]);
    expect(button("Read this area").disabled).toBe(false);

    fireEvent.click(button("Clear the area"));

    expect(document.querySelector('[data-testid="ocr-area-box"]')).toBeNull();
    expect(button("Read this area").disabled).toBe(true);
  });

  it("AC-329 reading the whole page hands over no area, and cancel reads nothing", async () => {
    const { onRead, onClose } = await openDialog();

    fireEvent.click(button("Read the whole page"));

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith(null);

    fireEvent.click(button("Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it("AC-329 a PDF page is shown first, and only the area the teacher chose is read", async () => {
    // the browser's own reader: stands in for tesseract in the page
    vi.stubGlobal("Worker", class {});

    const read = vi.spyOn(browserOcr, "read").mockResolvedValue({
      id: "ocr-1",
      text: "hello",
      lines: [{ text: "hello", x: 120, y: 220, width: 100, height: 30 }],
      engine: "tesseract",
      durationMs: 12,
    });

    mockLayout();

    await render(<ExcalidrawApp />);

    act(() => {
      appJotaiStore.set(pdfPageReadRequestAtom, PICTURE);
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="ocr-area-picture"]'),
      ).not.toBeNull(),
    );

    // the page is shown, and nothing has been read: the teacher has not chosen
    expect(read).not.toHaveBeenCalled();

    drag([50, 100], [250, 300]);
    fireEvent.click(button("Read this area"));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    // the reader got the page, and the area as the region to read
    expect(read.mock.calls[0][0]).toBe(PICTURE.dataURL);
    expect(read.mock.calls[0][1]).toMatchObject({
      region: { x: 100, y: 200, width: 400, height: 400 },
    });

    // the text that was read is shown, and the question is gone
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="ocr-preview"]'),
      ).not.toBeNull(),
    );
    expect(document.querySelector('[data-testid="ocr-area"]')).toBeNull();
  });

  it("AC-329 reading the whole page of a PDF sends no region", async () => {
    vi.stubGlobal("Worker", class {});

    const read = vi.spyOn(browserOcr, "read").mockResolvedValue({
      id: "ocr-1",
      text: "hello",
      lines: [{ text: "hello", x: 120, y: 220, width: 100, height: 30 }],
      engine: "tesseract",
      durationMs: 12,
    });

    await render(<ExcalidrawApp />);

    act(() => {
      appJotaiStore.set(pdfPageReadRequestAtom, PICTURE);
    });

    await waitFor(() =>
      expect(document.querySelector('[data-testid="ocr-area"]')).not.toBeNull(),
    );

    fireEvent.click(button("Read the whole page"));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    expect(read.mock.calls[0][1]).not.toHaveProperty("region");
  });
});
