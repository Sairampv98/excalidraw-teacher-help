import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { FONT_FAMILY } from "@excalidraw/common";
import { ExcalidrawAPIContext } from "@excalidraw/excalidraw/components/App";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { resetBrowserState } from "../sidebar/browserState";
import { FilesTab } from "../sidebar/FilesTab";
import {
  cancelCodePaste,
  cancelImageDrag,
  handleCodePaste,
  pendingCodePaste,
} from "../sidebar/insertIntoScene";

/** jsdom's File/Blob has no text(), which the code path for md/code needs */
const makeFile = (name: string, type = "", body = "const a = 1;") => {
  const file = new File([body], name, { type });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: () => Promise.resolve(body),
  });
  return file;
};

/**
 * A file as the browser hands it over when a *folder* was picked: a flat list
 * whose files carry the path they had inside that folder.
 */
const makeFolderFile = (
  relativePath: string,
  type = "",
  body = "const a = 1;",
) => {
  const name = relativePath.split("/").pop()!;
  const file = makeFile(name, type, body);

  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });

  return file;
};

/** a file the browser cannot read — the read fails */
const makeUnreadableFile = (name: string) => {
  const file = new File(["x"], name, { type: "" });

  Object.defineProperty(file, "text", {
    configurable: true,
    value: () => Promise.reject(new Error("denied")),
  });

  return file;
};

/** the imperative API surface the sidebar touches, stubbed to record calls */
const fakeApi = () => {
  const appState = {
    scrollX: 0,
    scrollY: 0,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    selectedElementIds: {} as Record<string, boolean>,
  };

  const calls: { elements?: readonly unknown[] }[] = [];
  const files: { id: string; mimeType: string; dataURL: string }[] = [];

  const api = {
    id: "test-app",
    calls,
    getSceneElements: () => [] as never[],
    getAppState: () => appState,
    addFiles: (added: { id: string; mimeType: string; dataURL: string }[]) => {
      files.push(...added);
    },
    updateScene: (data: { elements?: readonly unknown[] }) => {
      calls.push(data);
    },
    setToast: vi.fn(),
  };

  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    calls,
    files,
  };
};

const mockClipboard = (write: unknown, Item: unknown) => {
  // `writeText` is the document path and `write` the image path; both tabs use
  // one or the other, and tests assert on the spies, so the object is returned
  const clipboard = {
    write,
    writeText: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: Item,
  });

  return clipboard;
};

/** jsdom cannot decode images, so give them a predictable size */
const mockImageDecoder = () => {
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 800;
    naturalHeight = 400;
    set src(_value: string) {
      this.onload?.();
    }
  } as unknown as typeof Image;
};

const restoreImageDecoder = () => {
  Reflect.deleteProperty(globalThis, "Image");
};

/** jsdom has no object-URL implementation, and both tabs create one per file */
const mockObjectUrls = () => {
  const created: string[] = [];
  const revoked: string[] = [];

  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock/${created.length}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });

  return { created, revoked };
};

/** drive a hidden <input type="file"> the way the browser would */
const pickFiles = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  fireEvent.change(input);
};

/**
 * The picker has two inputs: one takes files, the other a whole folder.
 *
 * They are told apart by their attribute rather than by their order in the
 * DOM: the two tabs became one tab, so "the first file input" would now pick
 * whichever of the two happens to come first — and the two mean different
 * things.
 */
const getFilesInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="file"][accept]')!;

const getFolderInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>(
    'input[type="file"][webkitdirectory]',
  )!;

/** the picked root and the browsing path live between panels, so they are reset */
beforeEach(() => {
  resetBrowserState();
});

describe("FilesTab", () => {
  it("renders one list of rows, grouped by type, and tracks the selection", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [
      makeFile("one.png", "image/png"),
      makeFile("two.gif", "image/gif"),
      makeFile("notes.md", ""),
    ]);

    const rows = container.querySelectorAll(".app-file-list__row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("one.png");
    expect(rows[2].textContent).toContain("notes.md");

    // an image row carries a thumbnail next to the name
    expect(rows[0].querySelector(".app-file-list__thumb img")).toBeTruthy();

    // a document row carries the badge of its own kind — a markdown file is
    // "MD", not the "TXT" the old badge gave every code file
    expect(rows[2].querySelector(".app-doc-badge")!.textContent).toBe("MD");

    // the carousel is gone
    expect(container.querySelector(".app-carousel")).toBeNull();

    // clicking a row moves the selection
    fireEvent.click(rows[0]);
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows[0].className).toContain("app-file-list__row--active");
  });

  it("names the files it cannot use, with the reason why", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [
      makeFile("one.png", "image/png"),
      makeFile("clip.mp4", "video/mp4"),
      makeFile("notes.docx", ""),
    ]);

    // nothing is dropped: both unusable files are listed, each with its reason
    const unusable = container.querySelectorAll(
      ".app-file-list__row--unsupported",
    );

    expect(unusable).toHaveLength(2);
    expect(unusable[0].textContent).toContain("clip.mp4");
    expect(unusable[0].textContent).toContain("preview only");
    expect(unusable[1].textContent).toContain("notes.docx");
    expect(unusable[1].textContent).toContain("unknown file type");
  });

  it("names a file it could not read, with the reason why", async () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [makeUnreadableFile("broken.md")]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    // the file could not be read, so it is listed as one we cannot use — with
    // the reason, not silently
    await waitFor(() =>
      expect(
        container.querySelector(".app-file-list__row--unsupported"),
      ).toBeTruthy(),
    );

    const row = container.querySelector(".app-file-list__row--unsupported")!;

    expect(row.textContent).toContain("broken.md");
    expect(row.textContent).toContain("could not be read");
  });

  it("revokes the thumbnails of the previous pick", () => {
    const { revoked } = mockObjectUrls();

    const { container, unmount } = render(<FilesTab />);
    const input = getFilesInput(container);

    pickFiles(input, [
      makeFile("one.png", "image/png"),
      makeFile("two.gif", "image/gif"),
    ]);
    expect(revoked).toHaveLength(0);

    // re-picking replaces the images, so the old URLs go away
    pickFiles(input, [makeFile("three.png", "image/png")]);
    expect(revoked).toHaveLength(2);

    unmount();
  });

  it("clicking a row copies the image and arms the canvas paste", async () => {
    mockObjectUrls();
    const write = vi.fn().mockResolvedValue(undefined);
    mockClipboard(write, class {});

    const { api, calls } = fakeApi();

    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas";
    document.body.appendChild(canvas);

    pickFiles(getFilesInput(container), [makeFile("one.png", "image/png")]);

    // nothing is armed until a row is clicked
    expect(container.querySelector(".app-sidebar-note--armed")).toBeNull();

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    // copied *and* armed: the next canvas click pastes where it was clicked
    expect(
      container.querySelector(".app-sidebar-note--armed")!.textContent,
    ).toContain("one.png");
    expect(container.querySelector(".app-file-list__row")!.className).toContain(
      "app-file-list__row--active",
    );

    mockImageDecoder();

    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 80, clientY: 60 }),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(
      (calls[0].elements as Array<{ type: string }>).some(
        (el) => el.type === "image",
      ),
    ).toBe(true);

    // the paste is spent, so the hint goes away with it
    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--armed")).toBeNull(),
    );

    restoreImageDecoder();
    canvas.remove();
  });

  it("still arms the paste when the clipboard refuses the image", async () => {
    mockObjectUrls();
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")), class {});

    const { api } = fakeApi();

    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [makeFile("one.png", "image/png")]);
    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--armed")).toBeTruthy(),
    );

    // the stash is what survives a blocked clipboard, so the row stays selected
    // and armed
    expect(container.querySelector(".app-file-list__row")!.className).toContain(
      "app-file-list__row--active",
    );
    expect(container.querySelector(".app-file-list__row")).toBeTruthy();
  });
});

/**
 * A drag released over the sidebar is rejected on purpose — the panel floats
 * above the canvas, so inserting there would hide the result. The old code
 * dropped the hint in silence, which is how a perfectly good GIF came to look
 * broken.
 */
describe("FilesTab rejected drags", () => {
  const canvases: HTMLCanvasElement[] = [];

  afterEach(() => {
    for (const canvas of canvases.splice(0)) {
      canvas.remove();
    }
    cancelImageDrag();
  });

  const stubDataTransfer = () => ({
    effectAllowed: "",
    dropEffect: "",
    setData: vi.fn(),
    types: [] as string[],
  });

  /**
   * jsdom's own `DataTransfer` exposes `effectAllowed` as a getter only, so
   * `fireEvent.dragStart(row, { dataTransfer })` hands the component a read-only
   * object. Defining the property on the event is the way to give it a writable
   * one; the handler under test is unchanged either way.
   */
  const fireDragStart = (row: Element, dataTransfer: object) => {
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(row, event);
  };

  /**
   * A drag only arms when there is a canvas to aim at — `armImageDragOnCanvas`
   * deliberately drops the stash rather than leaving it half-armed — so every
   * test here needs one.
   */
  const stubCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    document.body.appendChild(canvas);
    canvases.push(canvas);
    return canvas;
  };

  const renderFolder = () => {
    mockObjectUrls();
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")), class {});
    stubCanvas();

    const { api, calls } = fakeApi();
    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [makeFile("clip.gif", "image/gif")]);

    return { container, calls };
  };

  it("says so when the release never reached the canvas", async () => {
    const { container } = renderFolder();

    expect(container.querySelector(".app-sidebar-note--warn")).toBeNull();

    const row = container.querySelector(".app-file-list__row")!;
    fireDragStart(row, stubDataTransfer());

    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--armed")).toBeTruthy(),
    );

    fireEvent.dragEnd(row);

    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--warn")).toBeTruthy(),
    );

    const warn = container.querySelector(".app-sidebar-note--warn")!;

    expect(warn.textContent).toMatch(/outside the canvas/i);
    // the armed hint goes, the reason stays
    expect(container.querySelector(".app-sidebar-note--armed")).toBeNull();
    // and it is announced, not just coloured
    expect(warn.getAttribute("role")).toBe("status");
  });

  it("stays quiet when the drop was accepted", async () => {
    const { container } = renderFolder();

    mockImageDecoder();

    const row = container.querySelector(".app-file-list__row")!;
    fireDragStart(row, stubDataTransfer());

    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--armed")).toBeTruthy(),
    );

    // the stash is consumed by the accepted drop, so `dragend` sees nothing
    // left armed and must not claim the gesture failed. A MouseEvent is used
    // rather than a DragEvent: this jsdom exposes no `DragEvent`, and the
    // handler only ever reads the coordinates off it.
    window.dispatchEvent(
      new MouseEvent("drop", {
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );
    fireEvent.dragEnd(row);

    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--warn")).toBeNull(),
    );

    restoreImageDecoder();
  });

  it("clears the complaint on the next gesture", async () => {
    const { container } = renderFolder();

    const row = container.querySelector(".app-file-list__row")!;
    fireDragStart(row, stubDataTransfer());
    fireEvent.dragEnd(row);

    await waitFor(() =>
      expect(container.querySelector(".app-sidebar-note--warn")).toBeTruthy(),
    );

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    expect(container.querySelector(".app-sidebar-note--warn")).toBeNull();
  });
});

/**
 * "Insert into canvas" has no drop point, so it centres on what the user can
 * see. The sidebar is an overlay rather than a docked panel, so that is not the
 * middle of the canvas box — and centring on the box put the image half under
 * the panel, which read as "nothing happened".
 *
 * Driven through the real button so the wiring between `readCover` and
 * `viewportCenter` is covered, not just the pure helpers.
 */
describe("FilesTab insert placement around the sidebar", () => {
  const CANVAS = { left: 0, top: 0, width: 800, height: 600 };
  const SIDEBAR_WIDTH = 302;

  const stubCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    canvas.getBoundingClientRect = () =>
      ({
        ...CANVAS,
        right: CANVAS.left + CANVAS.width,
        bottom: CANVAS.top + CANVAS.height,
        x: CANVAS.left,
        y: CANVAS.top,
        toJSON: () => ({}),
      } as DOMRect);
    document.body.appendChild(canvas);
    return canvas;
  };

  /** a right-docked sidebar, i.e. what the library renders by default */
  const stubSidebar = () => {
    const sidebar = document.createElement("div");
    sidebar.className = "sidebar";
    sidebar.getBoundingClientRect = () => {
      const left = CANVAS.left + CANVAS.width - SIDEBAR_WIDTH;
      return {
        left,
        top: 0,
        right: CANVAS.left + CANVAS.width,
        bottom: CANVAS.height,
        width: SIDEBAR_WIDTH,
        height: CANVAS.height,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
    document.body.appendChild(sidebar);
    return sidebar;
  };

  const insertAndMeasure = async () => {
    mockObjectUrls();
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")), class {});
    const canvas = stubCanvas();
    const sidebar = stubSidebar();
    mockImageDecoder();

    const { api, calls } = fakeApi();
    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [makeFile("clip.gif", "image/gif")]);

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Insert into canvas",
      )!,
    );

    await waitFor(() => expect(calls).toHaveLength(1));

    const image = (
      calls[0].elements as Array<{ type: string; x: number; width: number }>
    ).find((el) => el.type === "image")!;

    restoreImageDecoder();
    canvas.remove();
    sidebar.remove();

    return { left: image.x, centreX: image.x + image.width / 2 };
  };

  it("centres on the visible strip, not on the canvas box", async () => {
    const { centreX } = await insertAndMeasure();

    // the free strip is [0, 498]; its middle is 249, not the canvas' 400
    expect(centreX).toBeCloseTo((CANVAS.width - SIDEBAR_WIDTH) / 2, 5);
    expect(centreX).toBeLessThan(CANVAS.width / 2);
  });

  it("keeps the image clear of the panel's edge", async () => {
    const { left, centreX } = await insertAndMeasure();
    const panelEdge = CANVAS.width - SIDEBAR_WIDTH;

    expect(left).toBeGreaterThanOrEqual(-1);
    expect(centreX).toBeLessThan(panelEdge);
  });

  it("falls back to the canvas centre when no sidebar is open", async () => {
    mockObjectUrls();
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")), class {});
    const canvas = stubCanvas();
    mockImageDecoder();

    const { api, calls } = fakeApi();
    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [makeFile("clip.gif", "image/gif")]);

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Insert into canvas",
      )!,
    );

    await waitFor(() => expect(calls).toHaveLength(1));

    const image = (
      calls[0].elements as Array<{ type: string; x: number; width: number }>
    ).find((el) => el.type === "image")!;

    expect(image.x + image.width / 2).toBeCloseTo(CANVAS.width / 2, 5);

    restoreImageDecoder();
    canvas.remove();
  });
});

describe("FilesTab list and reader", () => {
  it("goes list -> viewer -> back to the list without rescanning", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [
      makeFile("b.pdf", "application/pdf"),
      makeFile("c.ts", ""),
    ]);

    // 1. list state
    expect(container.querySelector(".app-file-list")).toBeTruthy();
    expect(container.querySelector(".app-doc-viewer")).toBeNull();
    expect(container.querySelector(".app-doc-back")).toBeNull();

    // 2. clicking a row opens the viewer for that document
    fireEvent.click(container.querySelectorAll(".app-file-list__row")[0]);
    expect(container.querySelector(".app-file-list")).toBeNull();

    const viewer = container.querySelector(".app-doc-viewer")!;
    expect(viewer.querySelector("object[type='application/pdf']")).toBeTruthy();
    expect(viewer.textContent).toContain("b.pdf");

    // 3. read-back returns to the list, same rows, no rescan
    fireEvent.click(container.querySelector(".app-doc-back")!);

    expect(container.querySelector(".app-doc-viewer")).toBeNull();
    const rows = container.querySelectorAll(".app-file-list__row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("b.pdf");
  });

  it("switches document from inside the viewer", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [
      makeFile("b.pdf", "application/pdf"),
      makeFile("c.ts", ""),
    ]);

    fireEvent.click(container.querySelectorAll(".app-file-list__row")[0]);
    expect(
      container.querySelector("object[type='application/pdf']"),
    ).toBeTruthy();

    const next = container.querySelectorAll(".app-doc-step__btn")[1];
    fireEvent.click(next);

    // same viewer, different document — no read-back needed
    expect(container.querySelector(".app-doc-viewer")).toBeTruthy();
    expect(
      container.querySelector("object[type='application/pdf']"),
    ).toBeNull();
    expect(container.querySelector(".app-doc-title")!.textContent).toContain(
      "c.ts",
    );
  });

  it("keeps insert and copy actions for code documents", async () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [makeFile("c.ts", "")]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    // the read + shiki highlight is async, and the button reads "Inserting…"
    // until it settles — wait for the settled label
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll(".app-doc-viewer button")).map(
          (button) => button.textContent,
        ),
      ).toContain("Insert as a code card"),
    );

    const labels = Array.from(
      container.querySelectorAll(".app-doc-viewer button"),
    ).map((button) => button.textContent);

    expect(labels).toContain("Copy code");
  });

  it("always offers both load actions", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    const actions = Array.from(
      container.querySelectorAll(".app-sidebar-actions > button"),
    ).map((button) => button.textContent);

    expect(actions).toEqual(["Open files", "Open folder"]);
  });

  it("renders a markdown document as a document, with a zoom control", async () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [
      makeFile(
        "notes.md",
        "",
        ["# Notes", "", "Some **bold** text.", "", "- one", "- two"].join("\n"),
      ),
    ]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    // markdown is rendered, not highlighted as source
    await waitFor(() =>
      expect(container.querySelector(".app-doc-markdown h1")).toBeTruthy(),
    );

    const markdown = container.querySelector<HTMLElement>(".app-doc-markdown")!;
    expect(markdown.querySelector("strong")!.textContent).toBe("bold");
    expect(markdown.querySelectorAll("li")).toHaveLength(2);
    // no raw markdown markers survive
    expect(markdown.innerHTML).not.toContain("**bold**");

    const zoomOut = container.querySelector(
      '.app-doc-zoom button[aria-label="Zoom out"]',
    )!;
    const zoomIn = container.querySelector(
      '.app-doc-zoom button[aria-label="Zoom in"]',
    )!;
    const level = container.querySelector(".app-doc-zoom__level")!;

    expect(level.textContent).toBe("100%");
    expect(markdown.style.fontSize).toBe("100%");

    fireEvent.click(zoomIn);
    expect(level.textContent).toBe("110%");
    expect(markdown.style.fontSize).toBe("110%");

    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    expect(level.textContent).toBe("90%");

    // the percentage doubles as reset
    fireEvent.click(level);
    expect(level.textContent).toBe("100%");
    expect(markdown.style.fontSize).toBe("100%");
  });

  it("has no zoom control for a code document", async () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [makeFile("c.ts", "")]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(() =>
      expect(container.querySelector(".app-doc-code")).toBeTruthy(),
    );

    expect(container.querySelector(".app-doc-zoom")).toBeNull();
  });
});

/**
 * The merged list: one picker, sorted by type, with folders you can walk into
 * and out of, and a pin that keeps your place.
 */
describe("FilesTab browsing", () => {
  it("AC-45 the list is grouped by type, with an icon per group", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFilesInput(container), [
      makeFile("one.png", "image/png"),
      makeFile("two.gif", "image/gif"),
      makeFile("doc.pdf", "application/pdf"),
      makeFile("notes.md", ""),
      makeFile("script.ts", ""),
      makeFile("clip.mp4", "video/mp4"),
    ]);

    const groups = container.querySelectorAll(".app-file-group");

    // the groups come in the fixed order
    expect(
      Array.from(groups).map(
        (group) => group.querySelector(".app-file-group__label")!.textContent,
      ),
    ).toEqual(["Images", "Documents", "Markdown", "Code", "Video"]);

    // and every one of them carries an icon of its own
    for (const group of groups) {
      expect(group.querySelector(".app-file-group__icon svg")).toBeTruthy();
    }

    // the rows sit under the group of their kind
    expect(groups[0].querySelectorAll(".app-file-list__row")).toHaveLength(2);
    expect(groups[1].querySelectorAll(".app-file-list__row")).toHaveLength(1);
    expect(groups[2].querySelectorAll(".app-file-list__row")).toHaveLength(1);
    expect(groups[3].querySelectorAll(".app-file-list__row")).toHaveLength(1);
    // the video cannot be used, and says so where it is listed
    expect(
      groups[4].querySelectorAll(".app-file-list__row--unsupported"),
    ).toHaveLength(1);
  });

  it("AC-46 the back button returns to the parent listing", () => {
    mockObjectUrls();

    const { container } = render(<FilesTab />);

    pickFiles(getFolderInput(container), [
      makeFolderFile("root/top.md", ""),
      makeFolderFile("root/sub/deep.png", "image/png"),
    ]);

    // the root listing shows the folder — not what is inside it
    expect(container.querySelector(".app-file-list")!.textContent).toContain(
      "sub",
    );
    expect(
      container.querySelector(".app-file-list")!.textContent,
    ).not.toContain("deep.png");

    // walking into the folder
    fireEvent.click(container.querySelector(".app-file-list__row--folder")!);

    expect(container.querySelector(".app-file-list")!.textContent).toContain(
      "deep.png",
    );

    // and the way back out of it
    const back = container.querySelector(".app-doc-back");
    expect(back).toBeTruthy();

    fireEvent.click(back!);

    expect(container.querySelector(".app-file-list")!.textContent).toContain(
      "sub",
    );
    expect(
      container.querySelector(".app-file-list")!.textContent,
    ).not.toContain("deep.png");
    // at the top of the root there is nowhere left to go back to
    expect(container.querySelector(".app-doc-back")).toBeNull();
  });

  it("AC-47 the pin preserves the browsing path across a page switch", () => {
    mockObjectUrls();

    const { container, unmount } = render(<FilesTab />);

    pickFiles(getFolderInput(container), [
      makeFolderFile("root/sub/deep.png", "image/png"),
    ]);

    fireEvent.click(container.querySelector(".app-file-list__row--folder")!);

    expect(container.querySelector(".app-file-list")!.textContent).toContain(
      "deep.png",
    );

    // The page switch: the sidebar's panel is re-created for the other page.
    //
    // The path has to come back with it, because the place the user was in
    // lives outside the panel — the panel only holds what it is showing.
    unmount();

    const { container: next } = render(<FilesTab />);

    expect(next.querySelector(".app-doc-back")).toBeTruthy();
    expect(next.querySelector(".app-file-list")!.textContent).toContain(
      "deep.png",
    );
    // and the path it came back to is the folder that was open
    expect(next.querySelector(".app-file-browse__path")!.textContent).toContain(
      "sub",
    );
  });
});

/**
 * Copying code and pasting it used to land as a plain text element: the
 * clipboard only carried the source text, so the paste had nothing to know it
 * was code. Now the copy also arms one paste, which builds the same code card
 * the Insert button does.
 */
describe("FilesTab copy -> paste as a code card", () => {
  const CODE = "def second_largest(nums):\n    return sorted(nums)[-2]";

  const stubCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    document.body.appendChild(canvas);
    return canvas;
  };

  const openCodeDoc = async (name = "c.py", body = CODE) => {
    mockObjectUrls();
    const clipboard = mockClipboard(
      vi.fn().mockResolvedValue(undefined),
      class {},
    );
    const canvas = stubCanvas();

    const { api, calls, files } = fakeApi();
    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [makeFile(name, "", body)]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(() =>
      expect(container.querySelector(".app-doc-code")).toBeTruthy(),
    );

    const clickButton = (label: string) =>
      fireEvent.click(
        Array.from(container.querySelectorAll("button")).find(
          (b) => b.textContent === label,
        )!,
      );

    /**
     * The copy handler arms only after the clipboard write resolves, so every
     * test has to wait for the stash rather than assume it is already there.
     */
    const copyAndWait = async (label = "Copy code") => {
      clickButton(label);
      await waitFor(() => expect(pendingCodePaste()).toBeTruthy());
    };

    /**
     * The armed paste, run and settled.
     *
     * The library calls the app's `onPaste` hook from its own paste path —
     * the one funnel the keyboard paste and the context menu's paste both go
     * through — so that is what a paste drives now. The DOM event the browser
     * used to fire is not what the library listens to.
     */
    const pasteAndWait = async (text = CODE) => {
      await handleCodePaste({ text }, null);
      await waitFor(() => expect(calls).toHaveLength(1));
    };

    return {
      container,
      calls,
      files,
      canvas,
      clipboard,
      clickButton,
      copyAndWait,
      pasteAndWait,
    };
  };

  afterEach(() => {
    cancelCodePaste();
  });

  it("inserts a highlighted card of real text, not an image", async () => {
    const { container, calls, canvas, copyAndWait, pasteAndWait } =
      await openCodeDoc();

    await copyAndWait();
    await pasteAndWait();

    const elements = calls[0].elements as Array<{
      type: string;
      fileId?: string | null;
      fontFamily: number;
      strokeColor: string;
      text?: string;
      groupIds: string[];
    }>;

    // a card is a dark rounded rectangle with the code on top of it
    expect(elements.some((el) => el.type === "rectangle")).toBe(true);

    const body = elements.filter((el) => el.type === "text");

    expect(body.length).toBeGreaterThan(1);

    // the code is text, not a picture: no file was attached to it
    for (const run of body) {
      expect(run.fileId ?? null).toBeNull();
      expect(run.fontFamily).toBe(FONT_FAMILY.Cascadia);
      expect(run.text!.length).toBeGreaterThan(0);
    }

    // and it is coloured: several distinct stroke colours across the card
    expect(new Set(body.map((el) => el.strokeColor)).size).toBeGreaterThan(1);

    // every run belongs to one group, so the card moves as a unit
    const groups = new Set(body.map((el) => el.groupIds[0]));
    expect(groups.size).toBe(1);

    container.remove();
    canvas.remove();
  });

  it("falls back to the editable text card when it cannot highlight", async () => {
    // A fence in a language this shiki build has never heard of. There is
    // nothing to highlight with, and the paste must still deliver a card rather
    // than nothing at all.
    mockObjectUrls();
    const canvas = stubCanvas();
    const { api, calls } = fakeApi();
    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [
      makeFile("notes.md", "", "```not-a-real-language\nhello\n```"),
    ]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(() =>
      expect(container.querySelector(".app-doc-codeblock")).toBeTruthy(),
    );

    // the fence's language survives onto the wrapper, which is the only place
    // the copy handler can read it from
    const block = container.querySelector<HTMLElement>(".app-doc-codeblock")!;

    expect(block.dataset.language).toBe("not-a-real-language");

    fireEvent.click(block.querySelector(".app-doc-copy-code")!);
    await waitFor(() => expect(pendingCodePaste()).toBeTruthy());

    // the clipboard holds the fence's own text, which is what the library
    // parses out and hands to the app's `onPaste` hook
    const fenced = block.querySelector("pre")!.textContent!;

    await handleCodePaste({ text: fenced }, null);
    await waitFor(() => expect(calls).toHaveLength(1));

    const elements = calls[0].elements as Array<{
      type: string;
      fontFamily: number;
      strokeColor: string;
      text?: string;
    }>;

    expect(elements.some((el) => el.type === "rectangle")).toBe(true);

    const body = elements.find((el) => el.type === "text" && el.text)!;

    expect(body.fontFamily).toBe(FONT_FAMILY.Cascadia);
    expect(body.strokeColor).toBe("#e6edf3");
    expect(body.text).toContain("hello");

    container.remove();
    canvas.remove();
  });

  it("arms the paste with the fence's own language, not the document's", async () => {
    // A markdown document is `markdown`; a ```python fence inside it is not.
    // Highlighting the whole file as markdown would put every line in the same
    // colour, which is the problem this is meant to solve.
    mockObjectUrls();
    const canvas = stubCanvas();
    const { api, calls } = fakeApi();
    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(getFilesInput(container), [
      makeFile("notes.md", "", "```python\ndef f():\n    return 1\n```"),
    ]);

    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(() =>
      expect(container.querySelector(".app-doc-codeblock")).toBeTruthy(),
    );

    fireEvent.click(container.querySelector(".app-doc-copy-code")!);
    await waitFor(() => expect(pendingCodePaste()).toBeTruthy());

    const fenced = container.querySelector("pre")!.textContent!;

    await handleCodePaste({ text: fenced }, null);
    await waitFor(() => expect(calls).toHaveLength(1));

    // highlighted, so the card is not one flat colour
    const body = (
      calls[0].elements as Array<{ type: string; strokeColor: string }>
    ).filter((el) => el.type === "text");

    expect(new Set(body.map((el) => el.strokeColor)).size).toBeGreaterThan(1);

    container.remove();
    canvas.remove();
  });

  it("leaves the plain text on the clipboard for other apps", async () => {
    const { container, canvas, clipboard, clickButton } = await openCodeDoc();

    clickButton("Copy code");

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(CODE));

    container.remove();
    canvas.remove();
  });

  it("only intercepts one paste, then gets out of the way", async () => {
    const { container, calls, canvas, copyAndWait, pasteAndWait } =
      await openCodeDoc();

    await copyAndWait();
    await pasteAndWait();

    // a second, unrelated paste must not insert the code again
    const handled = await handleCodePaste({ text: "something else" }, null);

    expect(handled).toBe(true);
    expect(calls).toHaveLength(1);

    container.remove();
    canvas.remove();
  });

  it("does not intercept a paste that was never armed", async () => {
    const handled = await handleCodePaste({ text: "hello" }, null);

    expect(handled).toBe(true);
  });

  it("drops the armed paste when the reader leaves the document", async () => {
    const { container, canvas, copyAndWait } = await openCodeDoc();

    await copyAndWait();

    // back to the list
    fireEvent.click(container.querySelector(".app-doc-back")!);

    await waitFor(() => expect(pendingCodePaste()).toBeNull());

    container.remove();
    canvas.remove();
  });

  it("drops the armed paste when the document is inserted instead", async () => {
    const { container, canvas, clickButton, copyAndWait } = await openCodeDoc();

    await copyAndWait();

    clickButton("Insert as a code card");

    expect(pendingCodePaste()).toBeNull();

    container.remove();
    canvas.remove();
  });
});
