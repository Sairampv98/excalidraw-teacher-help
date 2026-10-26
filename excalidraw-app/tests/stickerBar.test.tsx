/**
 * AC-193 and AC-194 - the emoji and GIF bar (D-159, D-160).
 *
 * Assertions about where a sticker lands go through the library's own
 * conversion (`sceneCoordsToViewportCoords`) rather than a re-derived formula.
 */

import { Excalidraw } from "@excalidraw/excalidraw";
import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { STICKERS } from "../emoji/catalog";
import { STICKER_DRAG_TYPE } from "../emoji/insertSticker";
import StickerBar from "../emoji/StickerBar";
import { STORAGE_KEYS } from "../app_constants";

const { h } = window;

const TWO_PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const EMOJI_COUNT = STICKERS.filter((s) => s.kind === "emoji").length;
const GIF_COUNT = STICKERS.filter((s) => s.kind === "gif").length;

const renderBar = async (currentPageId = "page-1") => {
  const result = await render(
    <Excalidraw pagesEnabled={true}>
      <StickerBar />
    </Excalidraw>,
  );

  act(() => {
    h.setState({ pages: TWO_PAGES, currentPageId });
  });

  return result;
};

const items = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(".excalidraw-sticker-bar__item"),
  );

const fetched: string[] = [];

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';

/** the stickers are our own files: serve any of them as a small blob */
const stubFetch = () => {
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      return {
        ok: true,
        blob: async () =>
          String(url).endsWith(".gif")
            ? new Blob(["GIF89a"], { type: "image/gif" })
            : new Blob([SVG], { type: "image/svg+xml" }),
      };
    }),
  );
};

/** jsdom cannot decode an image, so the size probe is stubbed */
const stubImage = () => {
  class StubImage {
    naturalWidth = 120;
    naturalHeight = 60;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      this.onload?.();
    }
  }
  vi.stubGlobal("Image", StubImage);
};

const dragData = (id: string) => ({
  types: [STICKER_DRAG_TYPE],
  getData: (type: string) => (type === STICKER_DRAG_TYPE ? id : ""),
  files: [],
  items: [],
});

/**
 * jsdom has no DragEvent, so `fireEvent.drop` would drop `clientX` and
 * `clientY` on the floor. A plain event carrying them is what the handler sees.
 */
const dropOn = (
  target: Element,
  dataTransfer: unknown,
  clientX: number,
  clientY: number,
) => {
  const event = new Event("drop", { bubbles: true, cancelable: true });

  Object.assign(event, { dataTransfer, clientX, clientY });

  return target.dispatchEvent(event);
};

const canvasOf = (container: HTMLElement) =>
  container.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.interactive",
  )!;

describe("the emoji and GIF bar (AC-193)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-193 the emoji tab is open first and the gif tab shows only gifs", async () => {
    const { container, getByRole } = await renderBar();

    expect(
      getByRole("tab", { name: "Emoji" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(items(container)).toHaveLength(EMOJI_COUNT);
    expect(
      items(container).every((i) => i.dataset.stickerKind === "emoji"),
    ).toBe(true);

    fireEvent.click(getByRole("tab", { name: "GIF" }));

    expect(items(container)).toHaveLength(GIF_COUNT);
    expect(items(container).every((i) => i.dataset.stickerKind === "gif")).toBe(
      true,
    );
  });

  it("AC-193 the search narrows the open tab", async () => {
    const { container, getByLabelText, getByRole } = await renderBar();

    fireEvent.change(getByLabelText("Search stickers"), {
      target: { value: "rocket" },
    });

    expect(items(container).map((i) => i.dataset.stickerId)).toEqual([
      "rocket",
    ]);

    // the other tab has its own answer for the same word
    fireEvent.click(getByRole("tab", { name: "GIF" }));

    expect(items(container).map((i) => i.dataset.stickerId)).toEqual([
      "rocket-launch",
    ]);
  });

  it("AC-193 a search with no match says so", async () => {
    const { container, getByLabelText, getByRole } = await renderBar();

    fireEvent.change(getByLabelText("Search stickers"), {
      target: { value: "zzzzqq" },
    });

    expect(items(container)).toHaveLength(0);
    expect(getByRole("status").textContent).toContain("zzzzqq");
  });

  it("AC-193 the bar tucks away and remembers it", async () => {
    const first = await renderBar();

    fireEvent.click(first.getByLabelText("Hide the emoji and GIF bar"));

    expect(first.container.querySelector(".excalidraw-sticker-bar")).toBeNull();
    expect(first.getByLabelText("Show the emoji and GIF bar")).toBeTruthy();
    expect(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_STICKER_BAR_HIDDEN),
    ).toBe("1");

    first.unmount();

    // a fresh mount comes back tucked away
    const second = await renderBar();

    expect(
      second.container.querySelector(".excalidraw-sticker-bar"),
    ).toBeNull();

    fireEvent.click(second.getByLabelText("Show the emoji and GIF bar"));

    expect(
      second.container.querySelector(".excalidraw-sticker-bar"),
    ).toBeTruthy();
  });
});

describe("putting a sticker on the canvas (AC-194)", () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
    stubImage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-194 a click lands on the current page", async () => {
    const { container } = await renderBar("page-2");

    await act(async () => {
      fireEvent.click(
        container.querySelector<HTMLElement>('[data-sticker-id="rocket"]')!,
      );
    });

    await waitFor(() => expect(h.elements).toHaveLength(1));

    expect(h.elements[0].type).toBe("image");
    // it used to be that an image landed on page 1 and was invisible on page 2
    expect(h.elements[0].pageId).toBe("page-2");
  });

  it("AC-194 a gif keeps its type", async () => {
    const { container, getByRole } = await renderBar();

    fireEvent.click(getByRole("tab", { name: "GIF" }));

    await act(async () => {
      fireEvent.click(
        container.querySelector<HTMLElement>(
          '[data-sticker-id="rocket-launch"]',
        )!,
      );
    });

    await waitFor(() => expect(h.elements).toHaveLength(1));

    const image = h.elements[0] as { fileId: string };

    expect(h.app.api.getFiles()[image.fileId].mimeType).toBe("image/gif");
  });

  it("AC-194 a drop centres the sticker at the pointer", async () => {
    const { container } = await renderBar();

    await act(async () => {
      dropOn(canvasOf(container), dragData("fire"), 400, 300);
    });

    await waitFor(() => expect(h.elements).toHaveLength(1));

    const image = h.elements[0];

    // the oracle: the centre of what landed, taken back to the screen through
    // the library's own conversion, is where the pointer was
    const back = sceneCoordsToViewportCoords(
      {
        sceneX: image.x + image.width / 2,
        sceneY: image.y + image.height / 2,
      },
      {
        zoom: h.state.zoom,
        scrollX: h.state.scrollX,
        scrollY: h.state.scrollY,
        // the canvas has no box in jsdom, so its origin is 0,0
        offsetLeft: 0,
        offsetTop: 0,
      },
    );

    expect(back.x).toBeCloseTo(400, 3);
    expect(back.y).toBeCloseTo(300, 3);
  });

  it("AC-194 a drop of a sticker is not also handled by the library", async () => {
    const { container } = await renderBar();
    const reached = vi.fn();
    const root = container.querySelector(".excalidraw")!;

    root.addEventListener("drop", reached);

    await act(async () => {
      dropOn(canvasOf(container), dragData("fire"), 100, 100);
    });

    expect(reached).not.toHaveBeenCalled();
  });

  it("AC-194 a drop of other data is left to the library", async () => {
    const { container } = await renderBar();
    const reached = vi.fn();
    const root = container.querySelector(".excalidraw")!;

    root.addEventListener("drop", reached);

    await act(async () => {
      dropOn(
        canvasOf(container),
        {
          types: ["text/plain"],
          getData: () => "",
          files: [],
          items: [],
        },
        100,
        100,
      );
    });

    expect(reached).toHaveBeenCalled();
    expect(h.elements).toHaveLength(0);
  });

  it("AC-194 nothing leaves the machine", async () => {
    const { container, getByRole } = await renderBar();

    await act(async () => {
      fireEvent.click(
        container.querySelector<HTMLElement>('[data-sticker-id="skull"]')!,
      );
    });
    fireEvent.click(getByRole("tab", { name: "GIF" }));
    await act(async () => {
      dropOn(canvasOf(container), dragData("skull-shake"), 200, 200);
    });

    await waitFor(() => expect(h.elements).toHaveLength(2));

    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      // our own files: a path on this origin, or data the build inlined
      expect(url.startsWith("data:") || !/^[a-z][a-z0-9+.-]*:/i.test(url)).toBe(
        true,
      );
    }
  });
});
