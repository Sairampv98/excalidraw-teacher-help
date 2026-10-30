/**
 * AC-318 - the PDF viewer draws the pages itself, with their text on top.
 *
 * pdf.js is a stand-in here: what is checked is what the viewer does with what
 * pdf.js gives it - the pages, the text, the zoom, a failure - and that
 * nothing is fetched until a PDF is opened.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, waitFor, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { vi } from "vitest";

import { Provider, appJotaiStore, ocrEngineChoiceAtom } from "../app-jotai";
import { layoutOcrLines } from "../ocr/ocrLayout";
import { mergeRuns, runsStyledText } from "../sidebar/pdfSelection";
import { PDF_MAX_PAGES, PdfViewer, placeRegionBar } from "../sidebar/PdfViewer";

import type { ReactNode } from "react";

import type { PdfJs, PdfPageProxy, PdfRegion } from "../sidebar/PdfViewer";

type FakeHooks = {
  /** the size of a page in PDF points */
  size?: [width: number, height: number];
  /** every drawing: what it was asked for, and what the stand-in gives back */
  onRender?: (call: {
    scale: number;
    transform?: number[];
    width: number;
    height: number;
  }) => { promise: Promise<void>; cancel?: () => void } | undefined;
  /** a page cannot be fetched while this says so */
  broken?: () => boolean;
  /** the text of the page with its fonts, as pdf.js gives it (D-321) */
  fonts?: {
    items: Array<{ str: string; fontName: string }>;
    objs: Record<string, { name?: string; bold?: boolean; italic?: boolean }>;
    /** the elements of the text layer do not line up with the text */
    misaligned?: boolean;
  };
};

const fakePdfjs = (
  pageCount: number,
  withText = true,
  hooks: FakeHooks = {},
): PdfJs =>
  ({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageCount,
        destroy: () => {},
        getPage: async (index: number): Promise<PdfPageProxy> => {
          if (hooks.broken?.()) {
            throw new Error("the page is gone");
          }

          const [width, height] = hooks.size ?? [100, 140];

          return {
            getViewport: ({ scale }) => ({
              width: width * scale,
              height: height * scale,
              scale,
            }),
            render: ({ viewport, transform, canvasContext }) =>
              hooks.onRender?.({
                scale: (viewport as { scale: number }).scale,
                transform,
                width: canvasContext.canvas.width,
                height: canvasContext.canvas.height,
              }) ?? { promise: Promise.resolve() },
            streamTextContent: () => index,
            ...(hooks.fonts
              ? {
                  getTextContent: async () => ({ items: hooks.fonts!.items }),
                  commonObjs: {
                    has: (id: string) => id in hooks.fonts!.objs,
                    get: (id: string) => hooks.fonts!.objs[id],
                  },
                }
              : {}),
          };
        },
      }),
    }),
    TextLayer: class {
      textDivs: HTMLElement[] = [];

      textContentItemsStr: string[] = [];

      constructor(
        private options: { textContentSource: unknown; container: HTMLElement },
      ) {}

      async render() {
        // a scanned page has a picture and no text
        if (!withText) {
          return;
        }

        // the text given as it is, with its pieces: each piece that is not
        // empty has an element of its own
        const given = this.options.textContentSource as {
          items?: Array<{ str?: string }>;
        };

        if (given && typeof given === "object" && given.items) {
          for (const item of given.items) {
            if (!item.str) {
              continue;
            }

            const span = document.createElement("span");

            span.textContent = item.str;
            this.options.container.append(span);
            this.textDivs.push(span);
            this.textContentItemsStr.push(
              hooks.fonts?.misaligned ? "other" : item.str,
            );
          }

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
    hooks?: FakeHooks;
    /** the file, when a test has to open the same one again */
    pdf?: File;
    toolbarHost?: HTMLElement | null;
    onRegion?: (region: PdfRegion) => void;
    renderRegionBar?: (region: PdfRegion, close: () => void) => ReactNode;
  } = {},
) => {
  const ref = createRef<HTMLDivElement>();
  const loader =
    options.loader ??
    (async () =>
      fakePdfjs(options.pages ?? 3, options.withText ?? true, options.hooks));
  const utils = render(
    <PdfViewer
      file={options.pdf ?? file()}
      zoom={options.zoom ?? 1}
      onZoomChange={options.onZoomChange}
      containerRef={ref}
      loader={loader}
      onReadPage={options.onReadPage}
      toolbarHost={options.toolbarHost}
      onRegion={options.onRegion}
      renderRegionBar={options.renderRegionBar}
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

    // every page has its room at once, and is drawn as it is near the view
    await waitFor(() =>
      expect(ref.current!.querySelectorAll(".app-doc-pdf-page")).toHaveLength(
        3,
      ),
    );
    await waitFor(() =>
      expect(
        ref.current!.querySelectorAll(".app-doc-pdf-text span"),
      ).toHaveLength(3),
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

  it("AC-401 Read this page works with the pages scrolled, because a press on the toolbar is not a press on a page", async () => {
    const onReadPage = vi.fn();
    const host = document.createElement("div");

    document.body.appendChild(host);

    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";

    const capture = vi.fn();
    const original = HTMLElement.prototype.setPointerCapture;

    HTMLElement.prototype.setPointerCapture = capture;

    try {
      // the toolbar is in a row of its own, outside the viewer, as in the app
      const { ref, getByTestId } = mount({
        pages: 3,
        onReadPage,
        toolbarHost: host,
      });

      await waitFor(() =>
        expect(ref.current!.querySelectorAll("canvas")).toHaveLength(3),
      );

      // the viewer is scrolled: the first page reaches up under the toolbar
      const viewer = getByTestId("pdf-viewer");

      viewer.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 300,
          top: 100,
          bottom: 500,
          width: 300,
          height: 400,
        } as DOMRect);

      const sheets =
        ref.current!.querySelectorAll<HTMLElement>(".app-doc-pdf-page");

      sheets[0].getBoundingClientRect = () =>
        ({
          left: 0,
          right: 300,
          top: -200,
          bottom: 160,
          width: 300,
          height: 360,
        } as DOMRect);
      sheets[1].getBoundingClientRect = () =>
        ({
          left: 0,
          right: 300,
          top: 170,
          bottom: 530,
          width: 300,
          height: 360,
        } as DOMRect);

      // the press is at the toolbar's height, above the viewer, where only the
      // first page's scrolled-up part is
      const button = host.querySelector(
        '[data-testid="pdf-read-page"]',
      ) as HTMLElement;

      // (jsdom has no pointer events: a mouse event of that type carries the same)
      act(() => {
        button.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 20,
            clientY: 60,
          }),
        );
      });

      // nothing was begun on a page, and the pointer was not taken from the button
      expect(capture).not.toHaveBeenCalled();

      fireEvent.click(button);

      expect(onReadPage).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.setPointerCapture = original;
      host.remove();
    }
  });

  it("AC-318 a page can be read with OCR, and a book is not drawn all at once", async () => {
    const onReadPage = vi.fn();

    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";

    const { ref, getByTestId } = mount({ pages: 2, onReadPage });

    await waitFor(() =>
      expect(ref.current!.querySelectorAll("canvas")).toHaveLength(2),
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

describe("AC-334 the text of a PDF page is not selected by the browser", () => {
  it("AC-334 a plain drag on the page is not the browser's selection, and the middle button drags the page", async () => {
    const { getByTestId, ref } = mount({ pages: 1 });
    const viewer = getByTestId("pdf-viewer");

    await waitFor(() =>
      expect(
        ref.current!.querySelectorAll(".app-doc-pdf-text span").length,
      ).toBe(1),
    );

    // a plain drag draws a box (D-314); it does not drag the page
    viewer.scrollTop = 100;
    viewer.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 200,
        clientY: 200,
      }),
    );
    viewer.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    );
    expect(viewer.scrollTop).toBe(100);

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

  it("AC-334 the style keeps the browser from selecting the page's text", () => {
    // a box is the selection of a PDF (D-314): left selectable, the text under
    // the box would be highlighted run by run, which is what the box replaces
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
      /user-select:\s*none/,
    );

    // the end-of-content marker is not selectable either
    expect(blockOf(".app-doc-pdf-text .endOfContent")).toMatch(
      /user-select:\s*none/,
    );
  });
});

describe("AC-353 the PDF's tools are in the row of the zoom", () => {
  it("AC-353 the toolbar is in the place it is given, outside the part that scrolls", () => {
    const host = document.createElement("div");

    document.body.append(host);

    const { getByTestId } = mount({
      pages: 1,
      onReadPage: vi.fn(),
      toolbarHost: host,
    });

    const viewer = getByTestId("pdf-viewer");

    for (const id of ["pdf-fit-width", "pdf-fit-page", "pdf-read-page"]) {
      expect(host.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
      // not in the part that scrolls: it would scroll away with the pages
      expect(viewer.querySelector(`[data-testid="${id}"]`)).toBeNull();
    }

    host.remove();
  });

  it("AC-353 with no place given the toolbar is at the top of the viewer", () => {
    const { getByTestId } = mount({ pages: 1, onReadPage: vi.fn() });

    expect(
      getByTestId("pdf-viewer").querySelector('[data-testid="pdf-fit-width"]'),
    ).not.toBeNull();
  });

  it("AC-353 until the place is there the toolbar is not drawn", () => {
    const { queryByTestId } = mount({
      pages: 1,
      onReadPage: vi.fn(),
      toolbarHost: null,
    });

    expect(queryByTestId("pdf-tools")).toBeNull();
    expect(queryByTestId("pdf-fit-width")).toBeNull();
  });
});

describe("AC-354 a PDF is selected with a box", () => {
  type Rect = [left: number, top: number, width: number, height: number];

  /** a rect as the browser gives it */
  const domRect = ([left, top, width, height]: Rect) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    } as DOMRect);

  /** one page, 300 x 400, at the corner of the stage; its runs are given */
  const openPage = async (
    runs: Array<[text: string, ...rect: Rect]> = [],
    options: Parameters<typeof mount>[0] = {},
    /** where things are on the screen: a page, the column of pages, the view */
    layout: { sheet?: Rect; stage?: Rect; viewer?: Rect } = {},
  ) => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const sheet = layout.sheet ?? [0, 0, 300, 400];
    const stage = layout.stage ?? [0, 0, 300, 800];

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.rect) {
          return domRect(this.dataset.rect.split(",").map(Number) as Rect);
        }

        if (this.classList.contains("app-doc-pdf-page")) {
          return domRect(sheet);
        }

        if (this.classList.contains("app-doc-pdf-stage")) {
          return domRect(stage);
        }

        if (layout.viewer && this.dataset.testid === "pdf-viewer") {
          return domRect(layout.viewer);
        }

        return original.call(this);
      },
    );

    const view = mount({ pages: 1, onReadPage: vi.fn(), ...options });

    // the view is as big as it is on the screen: what is shown depends on it
    if (layout.viewer) {
      const viewer = view.getByTestId("pdf-viewer");

      Object.defineProperty(viewer, "clientWidth", {
        configurable: true,
        value: layout.viewer[2],
      });
      Object.defineProperty(viewer, "clientHeight", {
        configurable: true,
        value: layout.viewer[3],
      });
    }

    // the page is drawn once it is near the view: its text is what is waited for
    await waitFor(() =>
      expect(
        view.ref.current!.querySelector(".app-doc-pdf-text span"),
      ).not.toBeNull(),
    );

    // the runs of text of the page, where they were laid out
    const layer = view.ref.current!.querySelector(".app-doc-pdf-text")!;

    layer.replaceChildren();

    for (const [text, ...rect] of runs) {
      const span = document.createElement("span");

      span.textContent = text;
      span.dataset.rect = rect.join(",");
      layer.append(span);
    }

    return view;
  };

  const pointer = (
    viewer: HTMLElement,
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) =>
    act(() => {
      viewer.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    });

  /** a drag from one corner to the other */
  const drag = async (
    viewer: HTMLElement,
    from: [number, number],
    to: [number, number],
  ) => {
    await pointer(viewer, "pointerdown", ...from);
    await pointer(viewer, "pointermove", ...to);
    await pointer(viewer, "pointerup", ...to);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-354 a drag draws a box that stays inside its page", async () => {
    const { getByTestId, queryByTestId } = await openPage();
    const viewer = getByTestId("pdf-viewer");

    await pointer(viewer, "pointerdown", 50, 60);
    await pointer(viewer, "pointermove", 500, 900);

    // dragged far past the page: the box stops at its edges
    const box = getByTestId("pdf-box");

    expect(box.style.left).toBe("50px");
    expect(box.style.top).toBe("60px");
    expect(box.style.width).toBe("250px");
    expect(box.style.height).toBe("340px");

    await pointer(viewer, "pointerup", 500, 900);

    // and it stays once the drag is over
    expect(getByTestId("pdf-box").style.width).toBe("250px");

    // a press that is not on a page draws no box
    await pointer(viewer, "pointerdown", 350, 200);
    await pointer(viewer, "pointermove", 360, 250);
    expect(queryByTestId("pdf-box")).toBeNull();
  });

  it("AC-354 the box gives the text, the lines and the picture of what it covers", async () => {
    const onRegion = vi.fn();
    const { getByTestId } = await openPage(
      [
        ["Name", 10, 20, 60, 14],
        ["Marks", 200, 20, 60, 14],
        ["Ann", 10, 40, 40, 14],
        ["9", 200, 40, 10, 14],
      ],
      { onRegion },
    );

    await drag(getByTestId("pdf-viewer"), [0, 0], [300, 100]);

    expect(onRegion).toHaveBeenCalledTimes(1);

    const region: PdfRegion = onRegion.mock.calls[0][0];

    // a row to a line, and a tab between pieces that are far apart: the cells
    // of a table
    expect(region.text).toBe("Name\tMarks\nAnn\t9");

    // each piece keeps the place it had on the page
    expect(region.lines.map((line) => [line.text, line.x, line.y])).toEqual([
      ["Name", 10, 20],
      ["Marks", 200, 20],
      ["Ann", 10, 40],
      ["9", 200, 40],
    ]);

    // the picture is drawn again from the page (D-316): the box is 100 x 33
    // points, which is 600 x 200 pixels at six times - not the 140 x 49 pixels
    // that the viewer drew of it
    const picture = (await region.picture())!;

    expect(picture.dataURL.startsWith("data:image/png")).toBe(true);
    expect(picture.width).toBe(600);
    expect(picture.height).toBe(200);
  });

  it("AC-354 a run that is half inside is taken, and one that is less is left out", async () => {
    const onRegion = vi.fn();
    const { getByTestId } = await openPage(
      [
        // all of it is in the box
        ["inside", 10, 20, 60, 14],
        // 22 of 40 is in the box: taken whole
        ["half", 78, 20, 40, 14],
        // 5 of 40 is in the box: left out
        ["edge", 95, 60, 40, 14],
        // not touched
        ["far", 200, 20, 40, 14],
      ],
      { onRegion },
    );

    await drag(getByTestId("pdf-viewer"), [0, 0], [100, 100]);

    expect(onRegion.mock.calls[0][0].text).toBe("inside half");
  });

  it("AC-354 a box with nothing in it has no text and still has its picture", async () => {
    const onRegion = vi.fn();
    const { getByTestId } = await openPage([], { onRegion });

    await drag(getByTestId("pdf-viewer"), [10, 10], [120, 90]);

    const region: PdfRegion = onRegion.mock.calls[0][0];

    expect(region.text).toBe("");
    expect(region.lines).toEqual([]);
    expect(await region.picture()).not.toBeNull();
  });

  it("AC-354 a click, a new box and the zoom put the box away", async () => {
    const renderRegionBar = vi.fn<
      (region: PdfRegion, close: () => void) => ReactNode
    >(() => <span data-testid="bar">bar</span>);
    const pdf = file();
    const { getByTestId, queryByTestId, rerender, ref, loader } =
      await openPage([], { renderRegionBar, pdf });
    const viewer = getByTestId("pdf-viewer");

    // a box, and a click on the page that is not a drag
    await drag(viewer, [10, 10], [120, 90]);
    expect(queryByTestId("pdf-box")).not.toBeNull();
    expect(queryByTestId("bar")).not.toBeNull();

    await pointer(viewer, "pointerdown", 200, 200);
    await pointer(viewer, "pointerup", 200, 200);
    expect(queryByTestId("pdf-box")).toBeNull();
    expect(queryByTestId("bar")).toBeNull();

    // a new box puts the old one away: only one is there
    await drag(viewer, [10, 10], [120, 90]);
    await pointer(viewer, "pointerdown", 150, 150);
    await pointer(viewer, "pointermove", 250, 300);

    const boxes = document.querySelectorAll('[data-testid="pdf-box"]');

    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLElement).style.left).toBe("150px");
    await pointer(viewer, "pointerup", 250, 300);

    // the bar closes the box
    const close = renderRegionBar.mock.calls.at(-1)![1];

    act(() => close());
    expect(queryByTestId("pdf-box")).toBeNull();

    // the zoom draws the pages again, and the box has nothing under it
    await drag(viewer, [10, 10], [120, 90]);
    expect(queryByTestId("pdf-box")).not.toBeNull();

    rerender(
      <PdfViewer
        file={pdf}
        zoom={2}
        containerRef={ref}
        loader={loader}
        onReadPage={vi.fn()}
        renderRegionBar={renderRegionBar}
      />,
    );

    await waitFor(() => expect(queryByTestId("pdf-box")).toBeNull());
  });

  it("AC-354 the choices are drawn under the box", async () => {
    const { getByTestId } = await openPage(
      [],
      { renderRegionBar: () => <span data-testid="bar">bar</span> },
      { viewer: [0, 0, 300, 420] },
    );
    const viewer = getByTestId("pdf-viewer");

    await drag(viewer, [20, 50], [120, 150]);

    // under the box, a little way off it
    const bar = getByTestId("pdf-region-bar");

    expect(bar.style.left).toBe("20px");
    expect(bar.style.top).toBe("156px");
    expect(bar.contains(getByTestId("bar"))).toBe(true);
  });

  it("AC-358 a box far to the right on a page wider than the view has its choices in view", async () => {
    // a page 900 pixels wide in a view 300 wide, scrolled 500 to the right: the
    // column of pages starts 500 pixels to the left of the view
    const { getByTestId } = await openPage(
      [],
      { renderRegionBar: () => <span data-testid="bar">bar</span> },
      {
        sheet: [-500, 0, 900, 400],
        stage: [-500, 0, 900, 800],
        viewer: [0, 0, 300, 420],
      },
    );

    await drag(getByTestId("pdf-viewer"), [100, 50], [200, 150]);

    // from the corner of the column, the part that is shown is 500 to 800, and
    // the choices are in it - not under the box's own place far to the left
    const left = parseFloat(getByTestId("pdf-region-bar").style.left);

    expect(left).toBeGreaterThanOrEqual(500);
    expect(left).toBeLessThanOrEqual(800 - 220);
  });

  it("AC-364 a box over bold and italic runs gives a text with the parts in it", async () => {
    const onRegion = vi.fn();
    const { getByTestId, ref } = await openPage(
      [
        ["Name", 10, 20, 60, 14],
        ["Marks", 200, 20, 60, 14],
        ["Ann", 10, 40, 40, 14],
      ],
      { onRegion },
    );

    // the page was drawn, and its pieces marked, as a PDF with a bold head is
    const spans = ref.current!.querySelectorAll<HTMLElement>(
      ".app-doc-pdf-text span",
    );

    spans[0].dataset.bold = "true";
    spans[1].dataset.bold = "true";
    spans[2].dataset.italic = "true";

    await drag(getByTestId("pdf-viewer"), [0, 0], [300, 100]);

    const region: PdfRegion = onRegion.mock.calls[0][0];

    expect(region.text).toBe("Name\tMarks\nAnn");
    expect(region.styleRuns).toEqual([
      { start: 0, end: 4, bold: true },
      { start: 5, end: 10, bold: true },
      { start: 11, end: 14, italic: true },
    ]);
    // and each line it makes knows its own
    expect(region.lines.map((line) => line.styleRuns)).toEqual([
      [{ start: 0, end: 4, bold: true }],
      [{ start: 0, end: 5, bold: true }],
      [{ start: 0, end: 3, italic: true }],
    ]);
  });
});

describe("AC-364 a PDF's text keeps what is bold or italic in it", () => {
  const plainRun = (
    text: string,
    x: number,
    y: number,
    width: number,
    style: { bold?: boolean; italic?: boolean } = {},
  ) => ({ text, x, y, width, height: 20, ...style });

  it("AC-364 the pieces of the text that are bold or italic are marked when the page is drawn", async () => {
    const { ref } = mount({
      pages: 1,
      hooks: {
        fonts: {
          items: [
            { str: "Plain", fontName: "f1" },
            // a piece with nothing in it has no element in the layer
            { str: "", fontName: "f1" },
            { str: "Bold", fontName: "f2" },
            { str: "Slant", fontName: "f3" },
            { str: "Named", fontName: "f4" },
          ],
          objs: {
            f1: { name: "Arial" },
            f2: { name: "Arial", bold: true },
            f3: { name: "Arial", italic: true },
            // pdf.js does not say, but the name of the font does
            f4: { name: "ABCDEF+Calibri-BoldItalic" },
          },
        },
      },
    });

    await waitFor(() =>
      expect(
        ref.current!.querySelectorAll(".app-doc-pdf-text span"),
      ).toHaveLength(4),
    );

    const marks = Array.from(
      ref.current!.querySelectorAll<HTMLElement>(".app-doc-pdf-text span"),
    ).map((span) => [
      span.textContent,
      span.dataset.bold === "true",
      span.dataset.italic === "true",
    ]);

    expect(marks).toEqual([
      ["Plain", false, false],
      ["Bold", true, false],
      ["Slant", false, true],
      ["Named", true, true],
    ]);
  });

  it("AC-364 when the pieces of the layer do not line up with the text, nothing is marked", async () => {
    const { ref } = mount({
      pages: 1,
      hooks: {
        fonts: {
          items: [{ str: "Bold", fontName: "f2" }],
          objs: { f2: { bold: true } },
          misaligned: true,
        },
      },
    });

    await waitFor(() =>
      expect(
        ref.current!.querySelectorAll(".app-doc-pdf-text span"),
      ).toHaveLength(1),
    );

    expect(
      ref.current!.querySelector<HTMLElement>(".app-doc-pdf-text span")!.dataset
        .bold,
    ).toBeUndefined();
  });

  it("AC-364 the text of a row carries its bold and italic parts, and a phrase is one stretch", () => {
    const { text, styleRuns } = runsStyledText([
      plainRun("Name", 0, 0, 40, { bold: true }),
      plainRun("Marks", 200, 0, 50, { bold: true }),
      // a bold phrase of two words: the space between them is bold too
      plainRun("Very", 0, 40, 40, { bold: true }),
      plainRun("good", 45, 40, 40, { bold: true }),
      plainRun("and", 90, 40, 30),
      plainRun("slanted", 125, 40, 60, { italic: true }),
    ]);

    expect(text).toBe("Name\tMarks\nVery good and slanted");
    expect(styleRuns).toEqual([
      // the tab between the cells is not bold
      { start: 0, end: 4, bold: true },
      { start: 5, end: 10, bold: true },
      { start: 11, end: 20, bold: true },
      { start: 25, end: 32, italic: true },
    ]);

    // nothing styled: no parts
    expect(runsStyledText([plainRun("plain", 0, 0, 50)]).styleRuns).toEqual([]);
  });

  it("AC-364 a line made of runs says which parts of it are bold or italic, and a plain one says nothing", () => {
    const lines = mergeRuns([
      plainRun("Hello", 0, 0, 50, { bold: true }),
      plainRun("world", 60, 0, 50, { bold: true }),
      plainRun("plain", 0, 40, 50),
    ]);

    expect(lines).toEqual([
      {
        text: "Hello world",
        x: 0,
        y: 0,
        width: 110,
        height: 20,
        styleRuns: [{ start: 0, end: 11, bold: true }],
      },
      { text: "plain", x: 0, y: 40, width: 50, height: 20 },
    ]);
  });

  it("AC-364 the lines laid out on a page keep their parts, moved by what was trimmed", () => {
    const layout = layoutOcrLines({
      lines: [
        {
          text: "  ab cd",
          x: 0,
          y: 0,
          width: 100,
          height: 20,
          styleRuns: [{ start: 2, end: 4, bold: true }],
        },
        { text: "plain", x: 0, y: 40, width: 100, height: 20 },
      ],
      pageWidth: 1000,
      measureWidth: () => 10,
    })!;

    expect(layout.lines[0]).toMatchObject({
      text: "ab cd",
      styleRuns: [{ start: 0, end: 2, bold: true }],
    });
    expect("styleRuns" in layout.lines[1]).toBe(false);
  });
});

describe("AC-356 the picture of a box is as sharp as the page can give", () => {
  type Render = {
    scale: number;
    transform?: number[];
    width: number;
    height: number;
  };

  /** a page that is open, and every drawing that was asked of it */
  const openRecorded = async (
    options: {
      size?: [number, number];
      sheet: [number, number];
      zoom?: number;
    },
    broken?: () => boolean,
  ) => {
    const renders: Render[] = [];
    const original = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (
          this.classList.contains("app-doc-pdf-page") ||
          this.classList.contains("app-doc-pdf-stage")
        ) {
          return {
            left: 0,
            top: 0,
            width: options.sheet[0],
            height: options.sheet[1],
            right: options.sheet[0],
            bottom: options.sheet[1],
          } as DOMRect;
        }

        return original.call(this);
      },
    );

    const onRegion = vi.fn();
    const view = mount({
      pages: 1,
      zoom: options.zoom,
      onReadPage: vi.fn(),
      onRegion,
      hooks: {
        size: options.size,
        broken,
        onRender: (call) => {
          renders.push(call);

          return undefined;
        },
      },
    });

    await waitFor(() =>
      expect(
        view.ref.current!.querySelector(".app-doc-pdf-text span"),
      ).not.toBeNull(),
    );

    return { ...view, onRegion, renders };
  };

  const draw = async (
    viewer: HTMLElement,
    from: [number, number],
    to: [number, number],
  ) => {
    for (const [type, [x, y]] of [
      ["pointerdown", from],
      ["pointermove", to],
      ["pointerup", to],
    ] as const) {
      act(() => {
        viewer.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            button: 0,
            clientX: x,
            clientY: y,
          }),
        );
      });
    }
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-356 the picture is drawn again from the page at a scale of its own", async () => {
    // a page of 100 x 140 points that the viewer shows at 300 x 400 pixels
    const { getByTestId, onRegion, renders } = await openRecorded({
      sheet: [300, 400],
    });

    await draw(getByTestId("pdf-viewer"), [30, 60], [120, 180]);

    const before = renders.length;
    const picture = (await onRegion.mock.calls[0][0].picture())!;

    // the box is 30 x 40 points, at 10 and 20 points from the corner: drawn at
    // six times the size of the page, with the page moved under the canvas
    expect(renders).toHaveLength(before + 1);
    expect(renders.at(-1)).toMatchObject({
      scale: 6,
      transform: [1, 0, 0, 1, -60, -120],
      width: 180,
      height: 240,
    });
    expect(picture.width).toBe(180);
    expect(picture.height).toBe(240);
    expect(picture.dataURL.startsWith("data:image/png")).toBe(true);
  });

  it("AC-356 it is the same at any zoom of the viewer", async () => {
    // the same part of the page, seen at a zoom of 1 and of 2
    const small = await openRecorded({ sheet: [300, 400], zoom: 1 });

    await draw(small.getByTestId("pdf-viewer"), [30, 60], [120, 180]);

    const one = (await small.onRegion.mock.calls[0][0].picture())!;
    const drawn = small.renders.at(-1);

    small.unmount();
    vi.restoreAllMocks();

    const big = await openRecorded({ sheet: [600, 800], zoom: 2 });

    await draw(big.getByTestId("pdf-viewer"), [60, 120], [240, 360]);

    const two = (await big.onRegion.mock.calls[0][0].picture())!;

    expect(two.width).toBe(one.width);
    expect(two.height).toBe(one.height);
    expect(big.renders.at(-1)).toEqual(drawn);
  });

  it("AC-356 a big part is held to the longest edge", async () => {
    // a page of 1000 x 2000 points: six times it would be 12000 pixels tall
    const { getByTestId, onRegion, renders } = await openRecorded({
      size: [1000, 2000],
      sheet: [300, 600],
    });

    await draw(getByTestId("pdf-viewer"), [0, 0], [300, 600]);

    const picture = (await onRegion.mock.calls[0][0].picture())!;

    expect(renders.at(-1)!.scale).toBeCloseTo(4096 / 2000, 5);
    expect(picture.height).toBe(4096);
    expect(picture.width).toBe(2048);
  });

  it("AC-356 a page that cannot be drawn again gives the pixels of the viewer", async () => {
    let broken = false;
    const { getByTestId, onRegion } = await openRecorded(
      { sheet: [300, 400] },
      () => broken,
    );

    await draw(getByTestId("pdf-viewer"), [0, 0], [300, 100]);

    // the page cannot be fetched: the viewer's own canvas is cut instead, which
    // is 140 x 196 pixels
    broken = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const picture = (await onRegion.mock.calls[0][0].picture())!;

    expect(picture.width).toBe(140);
    expect(picture.height).toBe(49);
  });
});

describe("AC-358 the choices are always where they can be seen", () => {
  it("AC-358 the choices are put against the part of the pages that is shown", () => {
    const shown = { left: 0, top: 0, right: 300, bottom: 420 };
    const box = (x: number, y: number, width: number, height: number) => ({
      x,
      y,
      width,
      height,
    });

    // under the box, when there is room
    expect(placeRegionBar(box(20, 50, 100, 100), shown)).toEqual({
      left: 20,
      top: 156,
    });

    // moved in from the right edge, so that it is not cut off
    expect(placeRegionBar(box(280, 50, 19, 100), shown).left).toBe(80);

    // no room under the box: over it
    expect(placeRegionBar(box(20, 300, 100, 99), shown).top).toBe(258);

    // no room over it or under it: at the bottom of what is shown
    expect(placeRegionBar(box(0, 0, 300, 420), shown).top).toBe(378);

    // the view is scrolled to the right: the choices are in it, not under a
    // box that is out of it
    expect(
      placeRegionBar(box(100, 50, 100, 100), {
        ...shown,
        left: 500,
        right: 800,
      }).left,
    ).toBe(500);
    expect(
      placeRegionBar(box(900, 50, 100, 100), {
        ...shown,
        left: 500,
        right: 800,
      }).left,
    ).toBe(580);
  });
});

describe("AC-359 a PDF keeps up at a high zoom", () => {
  /** what the browser's IntersectionObserver is told: the pages near the view */
  class FakeObserver {
    static all: FakeObserver[] = [];

    targets = new Set<Element>();

    constructor(
      readonly callback: (
        entries: Array<Partial<IntersectionObserverEntry>>,
      ) => void,
      readonly init: IntersectionObserverInit,
    ) {
      FakeObserver.all.push(this);
    }

    observe(target: Element) {
      this.targets.add(target);
    }

    unobserve() {}

    disconnect() {
      this.targets.clear();
    }

    /** the pages that are now near the view, or no longer near it */
    near(pages: Element[], isIntersecting: boolean) {
      act(() => {
        this.callback(pages.map((target) => ({ target, isIntersecting })));
      });
    }
  }

  beforeEach(() => {
    FakeObserver.all = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sheets = (ref: { current: HTMLElement | null }) => [
    ...ref.current!.querySelectorAll<HTMLElement>(".app-doc-pdf-page"),
  ];

  it("AC-359 every page has its room at once", async () => {
    const { ref } = mount({ pages: 5, zoom: 2 });

    await waitFor(() => expect(sheets(ref)).toHaveLength(5));

    // before anything is drawn - nothing has come near the view yet - every
    // page is there, as big as the page will be: the scroll bars are right
    expect(sheets(ref)).toHaveLength(5);

    for (const sheet of sheets(ref)) {
      expect(sheet.style.width).toBe("280px");
      expect(sheet.style.height).toBe("392px");
      expect(sheet.children).toHaveLength(0);
    }

    expect(ref.current!.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("AC-359 only the pages near the view are drawn, and far ones give their pixels back", async () => {
    const { ref, getByTestId } = mount({ pages: 5 });

    await waitFor(() => expect(sheets(ref)).toHaveLength(5));

    const pages = sheets(ref);
    const [observer] = FakeObserver.all;

    // the pages are watched against the view, a screen above it and below it
    expect(observer.init.root).toBe(getByTestId("pdf-viewer"));
    expect(observer.init.rootMargin).toBe("100% 0px");
    expect(observer.targets.size).toBe(5);

    observer.near([pages[0], pages[1]], true);

    await waitFor(() => {
      expect(pages[0].querySelector("canvas")).not.toBeNull();
      expect(pages[1].querySelector("canvas")).not.toBeNull();
      expect(pages[1].querySelector(".app-doc-pdf-text span")).not.toBeNull();
    });

    // the rest have their room and nothing else
    for (const far of pages.slice(2)) {
      expect(far.children).toHaveLength(0);
    }

    // the first goes far from the view: it gives its pixels back, and keeps
    // its room
    const canvas = pages[0].querySelector("canvas")!;

    observer.near([pages[0]], false);

    expect(pages[0].children).toHaveLength(0);
    expect(canvas.width).toBe(0);
    expect(pages[0].style.height).toBe("196px");
    expect(pages[1].querySelector("canvas")).not.toBeNull();

    // and it is drawn again when it comes back
    observer.near([pages[0]], true);

    await waitFor(() =>
      expect(pages[0].querySelector("canvas")).not.toBeNull(),
    );
  });

  it("AC-359 a canvas is never more than 16 million pixels", async () => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 8,
    });

    const { ref } = mount({ pages: 1, zoom: 4 });

    await waitFor(() => expect(sheets(ref)).toHaveLength(1));

    const [observer] = FakeObserver.all;

    observer.near(sheets(ref), true);

    // a page of 560 x 784 pixels at a ratio of 8 would be 28 million pixels
    await waitFor(() =>
      expect(ref.current!.querySelector("canvas")).not.toBeNull(),
    );

    const canvas = ref.current!.querySelector("canvas")!;
    const pixels = canvas.width * canvas.height;

    expect(pixels).toBeLessThanOrEqual(16 * 1024 * 1024);
    // and it is not smaller than it has to be
    expect(pixels).toBeGreaterThan(15 * 1024 * 1024);
    // the browser stretches it to the page's size
    expect(canvas.style.width).toBe("560px");

    Reflect.deleteProperty(window, "devicePixelRatio");
  });

  it("AC-359 a change of the zoom keeps the middle of the view", () => {
    const pdf = file();
    const ref = createRef<HTMLDivElement>();
    const loader = async () => fakePdfjs(5);
    const view = (zoom: number) => (
      <PdfViewer file={pdf} zoom={zoom} containerRef={ref} loader={loader} />
    );

    const { rerender, getByTestId } = render(view(1));

    return waitFor(() => expect(sheets(ref)).toHaveLength(5)).then(() => {
      const viewer = getByTestId("pdf-viewer");

      // the scroll area is as high as the pages are: 5 x 196 at a zoom of 1
      Object.defineProperty(viewer, "scrollHeight", {
        configurable: true,
        get: () =>
          sheets(ref).reduce(
            (height, sheet) => height + parseFloat(sheet.style.height),
            0,
          ),
      });
      Object.defineProperty(viewer, "scrollWidth", {
        configurable: true,
        value: 300,
      });
      Object.defineProperty(viewer, "clientHeight", {
        configurable: true,
        value: 200,
      });
      Object.defineProperty(viewer, "clientWidth", {
        configurable: true,
        value: 300,
      });

      // the middle of the view is half way down the document
      viewer.scrollTop = 390;

      rerender(view(2));

      // twice as high now, and the middle of the view is still half way down
      expect(viewer.scrollTop).toBe(0.5 * 1960 - 100);
    });
  });

  it("AC-359 a drawing that is still going is stopped by a change of the zoom", async () => {
    const cancel = vi.fn();
    const renders = vi.fn();
    const pdf = file();
    const ref = createRef<HTMLDivElement>();
    // the drawing never finishes by itself
    const loader = async () =>
      fakePdfjs(1, true, {
        onRender: (call) => {
          renders(call);

          return { promise: new Promise<void>(() => {}), cancel };
        },
      });
    const view = (zoom: number) => (
      <PdfViewer file={pdf} zoom={zoom} containerRef={ref} loader={loader} />
    );

    const { rerender } = render(view(1));

    await waitFor(() => expect(sheets(ref)).toHaveLength(1));
    FakeObserver.all[0].near(sheets(ref), true);

    await waitFor(() => expect(renders).toHaveBeenCalledTimes(1));
    expect(cancel).not.toHaveBeenCalled();

    rerender(view(2));

    expect(cancel).toHaveBeenCalledTimes(1);
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
      expect(ref.current!.querySelectorAll("canvas")).toHaveLength(3),
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
