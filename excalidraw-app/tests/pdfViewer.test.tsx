/**
 * AC-318 - the PDF viewer draws the pages itself, with their text on top.
 *
 * pdf.js is a stand-in here: what is checked is what the viewer does with what
 * pdf.js gives it - the pages, the text, the zoom, a failure - and that
 * nothing is fetched until a PDF is opened.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, waitFor, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { vi } from "vitest";

import { Provider, appJotaiStore, ocrEngineChoiceAtom } from "../app-jotai";
import { PDF_MAX_PAGES, PdfViewer } from "../sidebar/PdfViewer";

import type { ReactNode } from "react";

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
      expect(ref.current!.querySelectorAll(".app-doc-pdf-page")).toHaveLength(
        2,
      ),
    );

    // the toolbar's Read this page is the one way to read a page (D-307)
    fireEvent.click(getByTestId("pdf-read-page"));

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

  it("AC-325 the middle button drags the page about", async () => {
    const { getByTestId } = mount({ pages: 1 });
    const viewer = getByTestId("pdf-viewer");

    viewer.scrollLeft = 100;
    viewer.scrollTop = 100;

    // a plain drag is a selection: nothing scrolls
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

    viewer.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 1,
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

    // the page follows the pointer
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
    // and it says where to read it from: the page has no button of its own
    expect(ref.current!.textContent).toContain("Read this page");
    expect(ref.current!.querySelectorAll(".app-doc-pdf-read")).toHaveLength(0);
  });
});

describe("AC-334 the text of a PDF page can be selected", () => {
  it("AC-334 a plain drag on the page is left to the browser, so the text under it is selected", async () => {
    const { getByTestId, ref } = mount({ pages: 1 });
    const viewer = getByTestId("pdf-viewer");

    await waitFor(() =>
      expect(
        ref.current!.querySelectorAll(".app-doc-pdf-text span").length,
      ).toBe(1),
    );

    const press = () => {
      const event = new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 200,
        clientY: 200,
      });

      viewer.dispatchEvent(event);

      return event;
    };

    // a drag that starts a selection must not be cancelled
    expect(press().defaultPrevented).toBe(false);

    // with the middle button it is the page that is dragged, and the browser's
    // own selection is cancelled
    const middle = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 1,
      clientX: 200,
      clientY: 200,
    });

    viewer.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
  });

  it("AC-334 the style lifts the sidebar's rule against selecting on the page's text", () => {
    // `.excalidraw` sets `user-select: none` and the sidebar inherits it: the
    // text layer of a page has to say that it can be selected, or the cursor
    // changes over the words and nothing can be selected
    const styles = readFileSync(
      join(__dirname, "..", "sidebar", "sidebar.scss"),
      "utf8",
    );

    const blockOf = (selector: string) => {
      const start = styles.indexOf(`${selector} {`);

      expect(start).toBeGreaterThan(-1);

      return styles.slice(start, styles.indexOf("}", start));
    };

    expect(blockOf(".app-doc-pdf-text,\n.app-doc-pdf-text span")).toMatch(
      /user-select:\s*text/,
    );

    // the end-of-content marker is what keeps a drag from jumping to the end
    // of the page, and it is not itself selectable
    expect(blockOf(".app-doc-pdf-text .endOfContent")).toMatch(
      /user-select:\s*none/,
    );
  });
});

describe("AC-346 the PDF keeps its place", () => {
  it("AC-346 a change of the host does not draw the pages again", async () => {
    const ref = createRef<HTMLDivElement>();
    const loader = async () => fakePdfjs(2);
    const pdf = file();
    const view = (zoom: number) => (
      <PdfViewer
        file={pdf}
        zoom={zoom}
        containerRef={ref}
        loader={loader}
        onReadPage={vi.fn()}
      />
    );

    const { rerender } = render(view(1));

    await waitFor(() =>
      expect(ref.current!.querySelectorAll(".app-doc-pdf-page")).toHaveLength(
        2,
      ),
    );

    const before = [...ref.current!.querySelectorAll(".app-doc-pdf-page")];

    // what the host does when text is selected: it renders again, and its
    // function for the read is a new one each time
    rerender(view(1));
    rerender(view(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const after = [...ref.current!.querySelectorAll(".app-doc-pdf-page")];

    expect(after).toHaveLength(2);
    after.forEach((page, index) => expect(page).toBe(before[index]));

    // the zoom does draw them again
    rerender(view(2));

    await waitFor(() => {
      const zoomed = [...ref.current!.querySelectorAll(".app-doc-pdf-page")];

      expect(zoomed).toHaveLength(2);
      expect(zoomed[0]).not.toBe(before[0]);
    });
  });

  it("AC-346 a page has no read button of its own", async () => {
    const { ref } = mount({ pages: 2, onReadPage: vi.fn() });

    await waitFor(() =>
      expect(ref.current!.querySelectorAll(".app-doc-pdf-page")).toHaveLength(
        2,
      ),
    );

    expect(ref.current!.querySelectorAll("button")).toHaveLength(0);
    expect(ref.current!.textContent).not.toContain("Read the text");
  });
});

describe("AC-350 the PDF toolbar is icons", () => {
  it("AC-350 the toolbar buttons are icons with names", () => {
    const { getByTestId } = mount({ pages: 1, onReadPage: vi.fn() });

    const names = {
      "pdf-fit-width": "Fit width",
      "pdf-fit-page": "Fit page",
      "pdf-read-page": "Read this page",
    };

    for (const [testId, name] of Object.entries(names)) {
      const button = getByTestId(testId);

      // an icon and no words, and the name where a tooltip and a reader find it
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-label")).toBe(name);
      expect(button.getAttribute("title")).toContain(name);
    }

    // the engine that reads is chosen beside Read this page
    expect(getByTestId("pdf-read-page").nextElementSibling).toBe(
      getByTestId("ocr-engine-picker"),
    );
  });
});

describe("AC-342 the PDF toolbar reads the page you are on", () => {
  const Provided = ({ children }: { children: ReactNode }) => (
    <Provider store={appJotaiStore}>{children}</Provider>
  );

  it("AC-342 the toolbar has Read this page, and no Hand", async () => {
    const { queryByTestId } = mount({ pages: 1, onReadPage: vi.fn() });

    expect(queryByTestId("pdf-read-page")).not.toBeNull();
    expect(queryByTestId("pdf-hand")).toBeNull();
  });

  it("AC-342 a viewer that cannot read a page offers no read button", async () => {
    const { queryByTestId } = mount({ pages: 1 });

    expect(queryByTestId("pdf-read-page")).toBeNull();
    expect(queryByTestId("ocr-engine-picker")).toBeNull();
  });

  it("AC-342 Read this page reads the page that most of the viewer shows", async () => {
    const onReadPage = vi.fn();
    const { getByTestId, ref } = mount({ pages: 3, onReadPage });

    await waitFor(() =>
      expect(ref.current!.querySelectorAll(".app-doc-pdf-page")).toHaveLength(
        3,
      ),
    );

    const rects = [
      // the first page has scrolled almost out of the viewer
      { top: -250, bottom: 50 },
      // the second fills most of it
      { top: 60, bottom: 360 },
      { top: 370, bottom: 670 },
    ];

    const original = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "pdf-viewer") {
          return { top: 0, bottom: 300 } as DOMRect;
        }

        if (this.dataset.page) {
          return rects[Number(this.dataset.page) - 1] as DOMRect;
        }

        return original.call(this);
      },
    );

    // each page's picture says which page it is
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      function (this: HTMLCanvasElement) {
        return `data:page-${(this.parentElement as HTMLElement).dataset.page}`;
      },
    );

    fireEvent.click(getByTestId("pdf-read-page"));

    expect(onReadPage).toHaveBeenCalledTimes(1);
    expect(onReadPage.mock.calls[0][0].dataURL).toBe("data:page-2");

    vi.restoreAllMocks();
  });

  it("AC-342 the engine picker sits beside it, and the choice is kept for every read", async () => {
    appJotaiStore.set(ocrEngineChoiceAtom, null);

    const { getByTestId } = render(
      <Provided>
        <PdfViewer
          file={file()}
          zoom={1}
          containerRef={createRef<HTMLDivElement>()}
          loader={async () => fakePdfjs(1)}
          onReadPage={vi.fn()}
        />
      </Provided>,
    );

    const select = getByTestId("ocr-engine-select") as HTMLSelectElement;

    // the engines that are offered, and the fastest one first
    expect([...select.options].map((option) => option.value)).toEqual([
      "indra",
      "tesseract",
    ]);
    expect(select.value).toBe("indra");

    // indra needs the bridge, and it says so when there is none
    expect(select.options[0].textContent).toContain("needs the bridge");

    fireEvent.change(select, { target: { value: "tesseract" } });

    expect(appJotaiStore.get(ocrEngineChoiceAtom)).toBe("tesseract");
  });
});
