/**
 * AC-318 - the PDF viewer draws the pages itself, with their text on top.
 *
 * pdf.js is a stand-in here: what is checked is what the viewer does with what
 * pdf.js gives it - the pages, the text, the zoom, a failure - and that
 * nothing is fetched until a PDF is opened.
 */

import { render, waitFor, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { vi } from "vitest";

import { PDF_MAX_PAGES, PdfViewer } from "../sidebar/PdfViewer";

import type { PdfJs, PdfPageProxy } from "../sidebar/PdfViewer";

const fakePdfjs = (pageCount: number, withText = true): PdfJs =>
  ({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageCount,
        destroy: () => {},
        getPage: async (index: number): Promise<PdfPageProxy> => ({
          getViewport: ({ scale }) => ({
            width: 100 * scale,
            height: 140 * scale,
            scale,
          }),
          render: () => ({ promise: Promise.resolve() }),
          streamTextContent: () => index,
        }),
      }),
    }),
    TextLayer: class {
      constructor(
        private options: { textContentSource: unknown; container: HTMLElement },
      ) {}

      async render() {
        // a scanned page has a picture and no text
        if (!withText) {
          return;
        }

        const span = document.createElement("span");

        span.textContent = `text of page ${this.options.textContentSource}`;
        this.options.container.append(span);
      }
    },
  } as unknown as PdfJs);

/** jsdom's File has no arrayBuffer(), which opening a PDF needs */
const file = () => {
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], "lesson.pdf");

  Object.defineProperty(pdf, "arrayBuffer", {
    configurable: true,
    value: () => Promise.resolve(new Uint8Array([37, 80, 68, 70]).buffer),
  });

  return pdf;
};

const mount = (
  options: {
    pages?: number;
    zoom?: number;
    loader?: () => Promise<PdfJs>;
    onReadPage?: (picture: unknown) => void;
    onZoomChange?: (zoom: number) => void;
    withText?: boolean;
  } = {},
) => {
  const ref = createRef<HTMLDivElement>();
  const loader =
    options.loader ??
    (async () => fakePdfjs(options.pages ?? 3, options.withText ?? true));
  const utils = render(
    <PdfViewer
      file={file()}
      zoom={options.zoom ?? 1}
      onZoomChange={options.onZoomChange}
      containerRef={ref}
      loader={loader}
      onReadPage={options.onReadPage}
    />,
  );

  return { ref, loader, ...utils };
};

describe("AC-318 the PDF viewer", () => {
  it("AC-318 pdf.js is fetched once, and only when a PDF is opened", async () => {
    const loader = vi.fn(async () => fakePdfjs(1));

    // nothing is loaded by the module being imported
    expect(loader).not.toHaveBeenCalled();

    mount({ loader });

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });

  it("AC-318 every page is drawn, with its text on top that can be selected", async () => {
    const { ref } = mount({ pages: 3 });

    await waitFor(() =>
      expect(ref.current!.querySelectorAll(".app-doc-pdf-page")).toHaveLength(
        3,
      ),
    );

    const texts = [...ref.current!.querySelectorAll(".app-doc-pdf-text span")];

    expect(texts.map((span) => span.textContent)).toEqual([
      "text of page 1",
      "text of page 2",
      "text of page 3",
    ]);
  });

  it("AC-318 a PDF that cannot be opened says why", async () => {
    const { getByTestId } = mount({
      loader: async () => {
        throw new Error("Failed to fetch");
      },
    });

    await waitFor(() => expect(getByTestId("pdf-failed")).toBeTruthy());

    expect(getByTestId("pdf-failed").textContent).toContain("Failed to fetch");
  });

  it("AC-318 the zoom draws the pages bigger", async () => {
    const first = mount({ pages: 1, zoom: 1 });

    await waitFor(() =>
      expect(
        first.ref.current!.querySelector(".app-doc-pdf-page"),
      ).not.toBeNull(),
    );

    const small = parseFloat(
      (first.ref.current!.querySelector(".app-doc-pdf-page") as HTMLElement)
        .style.width,
    );

    first.unmount();

    const second = mount({ pages: 1, zoom: 2 });

    await waitFor(() =>
      expect(
        second.ref.current!.querySelector(".app-doc-pdf-page"),
      ).not.toBeNull(),
    );

    const big = parseFloat(
      (second.ref.current!.querySelector(".app-doc-pdf-page") as HTMLElement)
        .style.width,
    );

    expect(big).toBeCloseTo(small * 2, 5);
  });

  it("AC-318 a page can be read with OCR, and a book is not drawn all at once", async () => {
    const onReadPage = vi.fn();

    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";

    const { ref, getByTestId } = mount({ pages: 2, onReadPage });

    await waitFor(() =>
      expect(ref.current!.querySelectorAll(".app-doc-pdf-read")).toHaveLength(
        2,
      ),
    );

    fireEvent.click(ref.current!.querySelector(".app-doc-pdf-read")!);

    expect(onReadPage).toHaveBeenCalledWith(
      expect.objectContaining({ dataURL: "data:image/png;base64,AAAA" }),
    );

    // a document with more pages than the limit says so
    const big = mount({ pages: PDF_MAX_PAGES + 5 });

    await waitFor(() =>
      expect(big.getAllByTestId("pdf-capped").length).toBe(1),
    );
    expect(big.getByTestId("pdf-capped").textContent).toContain(
      `${PDF_MAX_PAGES} of ${PDF_MAX_PAGES + 5}`,
    );

    void getByTestId;
  });
});

describe("AC-325 the PDF reader can be zoomed, panned and fitted", () => {
  /** jsdom has no layout: the viewer is 500 by 300 */
  beforeEach(() => {
    for (const [name, value] of [
      ["clientWidth", 500],
      ["clientHeight", 300],
    ] as const) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get: () => value,
      });
    }
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  });

  it("AC-325 the document opens fitted to the panel, once", async () => {
    const onZoomChange = vi.fn();

    mount({ pages: 1, onZoomChange });

    // a page is 100 wide at scale 1 and drawn at 1.4: the width of the panel
    // less the margin, over 140
    await waitFor(() => expect(onZoomChange).toHaveBeenCalledTimes(1));
    expect(onZoomChange.mock.calls[0][0]).toBeCloseTo((500 - 12) / 140, 4);
  });

  it("AC-325 the fit buttons fit the width, or a whole page", async () => {
    const onZoomChange = vi.fn();
    const { getByTestId } = mount({ pages: 1, onZoomChange });

    await waitFor(() => expect(onZoomChange).toHaveBeenCalledTimes(1));
    onZoomChange.mockClear();

    fireEvent.click(getByTestId("pdf-fit-width"));
    expect(onZoomChange.mock.calls[0][0]).toBeCloseTo((500 - 12) / 140, 4);

    // a page is 196 tall at 1.4: the height of the panel decides
    fireEvent.click(getByTestId("pdf-fit-page"));
    expect(onZoomChange.mock.calls[1][0]).toBeCloseTo((300 - 12) / 196, 4);
  });

  it("AC-325 ctrl and the wheel zoom, and the wheel alone scrolls", async () => {
    const onZoomChange = vi.fn();
    const { getByTestId } = mount({ pages: 1, zoom: 1, onZoomChange });

    await waitFor(() => expect(onZoomChange).toHaveBeenCalledTimes(1));
    onZoomChange.mockClear();

    const viewer = getByTestId("pdf-viewer");

    // the wheel alone is left to the browser: it scrolls
    const plain = new WheelEvent("wheel", { deltaY: -100, cancelable: true });

    viewer.dispatchEvent(plain);
    expect(onZoomChange).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);

    // ctrl and the wheel zoom in, and the page does not zoom as well
    const zoomIn = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
    });

    viewer.dispatchEvent(zoomIn);
    expect(onZoomChange).toHaveBeenLastCalledWith(1.12);
    expect(zoomIn.defaultPrevented).toBe(true);

    const zoomOut = new WheelEvent("wheel", {
      deltaY: 100,
      ctrlKey: true,
      cancelable: true,
    });

    viewer.dispatchEvent(zoomOut);
    expect(onZoomChange.mock.calls.at(-1)![0]).toBeCloseTo(1 / 1.12, 5);
  });

  it("AC-325 the hand tool drags the page about", async () => {
    const { getByTestId } = mount({ pages: 1 });
    const viewer = getByTestId("pdf-viewer");

    viewer.scrollLeft = 100;
    viewer.scrollTop = 100;

    // without the hand a drag is a selection: nothing scrolls
    viewer.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 200,
        clientY: 200,
      }),
    );
    viewer.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 150,
        clientY: 150,
      }),
    );
    expect(viewer.scrollLeft).toBe(100);

    fireEvent.click(getByTestId("pdf-hand"));

    viewer.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 200,
        clientY: 200,
      }),
    );
    viewer.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 150,
        clientY: 170,
      }),
    );
    viewer.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));

    // the page follows the hand
    expect(viewer.scrollLeft).toBe(150);
    expect(viewer.scrollTop).toBe(130);
  });

  it("AC-325 a page with no text says so and offers to read it", async () => {
    const onReadPage = vi.fn();
    const { ref } = mount({ pages: 2, withText: false, onReadPage });

    await waitFor(() =>
      expect(
        ref.current!.querySelectorAll(".app-doc-pdf-page--scan"),
      ).toHaveLength(2),
    );

    expect(ref.current!.textContent).toContain(
      "No text to select on this page",
    );
    expect(ref.current!.querySelectorAll(".app-doc-pdf-read")).toHaveLength(2);
  });
});
