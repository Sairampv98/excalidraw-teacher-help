/**
 * AC-326 - OCR works in the browser with no bridge, and says how far it is.
 *
 * tesseract.js is a stand-in: what is checked is what the page does with what
 * the engine gives it - the lines, the offset of a region, the progress, the
 * one worker that is kept, a failed download - and that a read with no bridge
 * takes the browser's engine instead of failing.
 */

import { render, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { vi } from "vitest";

import { Provider, appJotaiStore, ocrProgressAtom } from "../app-jotai";
import { useOcr } from "../bridge/useOcr";
import { OcrProgressBar } from "../components/OcrProgressBar";
import { createBrowserOcr } from "../ocr/browserOcr";

import type { TesseractApi } from "../ocr/browserOcr";

// the page's own engine is the one a hook reads with: it is replaced here, and
// the engine that is built from a loader is left as it is
const { browserRead } = vi.hoisted(() => ({ browserRead: vi.fn() }));

vi.mock("../ocr/browserOcr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ocr/browserOcr")>()),
  browserOcr: { read: browserRead },
}));

const fakeTesseract = () => {
  const recognized: string[] = [];
  const terminate = vi.fn(async () => {});
  let logger: ((message: { status: string; progress: number }) => void) | null =
    null;

  const createWorker = vi.fn(
    async (
      _language: string,
      _mode?: number,
      options?: { logger?: typeof logger },
    ) => {
      logger = options?.logger ?? null;

      return {
        terminate,
        recognize: async (image: string) => {
          recognized.push(image);
          logger?.({ status: "recognizing text", progress: 0.5 });

          return {
            data: {
              text: "def f():\n    pass",
              confidence: 90,
              lines: [
                {
                  text: "def f():  ",
                  bbox: { x0: 10, y0: 20, x1: 110, y1: 40 },
                },
                { text: "   ", bbox: { x0: 0, y0: 50, x1: 5, y1: 60 } },
                { text: "    pass", bbox: { x0: 50, y0: 60, x1: 130, y1: 80 } },
              ],
            },
          };
        },
      };
    },
  );

  return {
    api: { createWorker } as unknown as TesseractApi,
    createWorker,
    terminate,
    recognized,
  };
};

describe("AC-326 OCR in the browser", () => {
  afterEach(() => {
    appJotaiStore.set(ocrProgressAtom, null);
    vi.unstubAllGlobals();
  });

  it("AC-326 the lines come back as boxes, blank ones left out", async () => {
    const fake = fakeTesseract();
    const ocr = createBrowserOcr({ load: async () => fake.api });

    const result = await ocr.read("data:image/png;base64,AAAA");

    expect(result.engine).toBe("tesseract");
    expect(result.lines).toEqual([
      { text: "def f():", x: 10, y: 20, width: 100, height: 20 },
      { text: "    pass", x: 50, y: 60, width: 80, height: 20 },
    ]);
  });

  it("AC-326 the lines of a region are where they are on the whole picture", async () => {
    const fake = fakeTesseract();
    const ocr = createBrowserOcr({
      load: async () => fake.api,
      crop: async () => "data:image/png;base64,CROPPED",
    });

    const result = await ocr.read("data:image/png;base64,AAAA", {
      region: { x: 100, y: 200, width: 300, height: 100 },
    });

    // the engine read the cut-out, and the answer is put back
    expect(fake.recognized).toEqual(["data:image/png;base64,CROPPED"]);
    expect(result.lines[0]).toMatchObject({ x: 110, y: 220 });
  });

  it("AC-326 the engine is started once and says how far it is", async () => {
    const fake = fakeTesseract();
    const ocr = createBrowserOcr({ load: async () => fake.api });
    const seen: Array<{ label: string; fraction: number | null }> = [];

    await ocr.read("a", { onProgress: (progress) => seen.push(progress) });
    await ocr.read("b");

    expect(fake.createWorker).toHaveBeenCalledTimes(1);
    expect(seen[0].label).toContain("Downloading the reader");
    expect(seen).toContainEqual({ label: "Reading the text", fraction: 0.5 });

    await ocr.stop();
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it("AC-326 a download that failed is tried again by the next read", async () => {
    const fake = fakeTesseract();
    const load = vi
      .fn<() => Promise<TesseractApi>>()
      .mockRejectedValueOnce(
        new Error("the OCR engine could not be downloaded"),
      )
      .mockResolvedValue(fake.api);
    const ocr = createBrowserOcr({ load });

    await expect(ocr.read("a")).rejects.toThrow("could not be downloaded");

    const result = await ocr.read("a");

    expect(result.lines).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("AC-326 the progress bar", () => {
  it("AC-326 the bar shows the step and how far it is, and goes when the read ends", () => {
    const onCancel = vi.fn();
    const { queryByTestId, getByTestId, getByText } = render(
      <Provider store={appJotaiStore}>
        <OcrProgressBar onCancel={onCancel} />
      </Provider>,
    );

    expect(queryByTestId("ocr-progress")).toBeNull();

    act(() => {
      appJotaiStore.set(ocrProgressAtom, {
        label: "Downloading the language",
        fraction: 0.42,
      });
    });

    expect(getByTestId("ocr-progress-label").textContent).toBe(
      "Downloading the language 42%",
    );
    expect(getByTestId("ocr-progress-bar").getAttribute("value")).toBe("42");

    // a step that cannot say how far it is shows a bar that is not filled
    act(() => {
      appJotaiStore.set(ocrProgressAtom, { label: "Starting", fraction: null });
    });
    expect(getByTestId("ocr-progress-bar").getAttribute("value")).toBeNull();

    getByText("Stop").click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    act(() => {
      appJotaiStore.set(ocrProgressAtom, null);
    });
    expect(queryByTestId("ocr-progress")).toBeNull();
  });
});

describe("AC-326 a read with no bridge uses the browser's engine", () => {
  it("AC-326 a read with no bridge is read in the browser and shows progress while it goes", async () => {
    vi.stubGlobal("Worker", class {});

    const read = browserRead.mockResolvedValue({
      id: "browser",
      text: "hi",
      lines: [{ text: "hi", x: 0, y: 0, width: 10, height: 10 }],
      engine: "tesseract" as const,
    });

    const requestOcr = vi.fn();

    const { result } = renderHook(() =>
      useOcr({ api: null, requestOcr, bridgeConnected: false }),
    );

    const seen: unknown[] = [];
    const unsubscribe = appJotaiStore.sub(ocrProgressAtom, () =>
      seen.push(appJotaiStore.get(ocrProgressAtom)),
    );

    let answer: Awaited<ReturnType<typeof result.current.read>> = null;

    await act(async () => {
      answer = await result.current.read({
        image: { dataURL: "data:image/png;base64,AAAA", width: 10, height: 10 },
        placement: { x: 0, y: 0, width: 10, height: 10 },
        pageId: "page-1",
        place: false,
      });
    });

    unsubscribe();

    // the bridge was never asked, the browser's engine read it, and the bar
    // was up while it read and gone after
    expect(requestOcr).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect((answer as { engine?: string } | null)?.engine).toBe("tesseract");
    expect(seen[0]).toEqual({ label: "Reading the text", fraction: null });
    expect(seen.at(-1)).toBeNull();
  });
});
