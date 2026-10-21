/**
 * Inserting a document into the current canvas (D-35..D-38).
 *
 * The fork owner's request: "if I open one excalidraw file and then open another
 * excalidraw file in the same canvas, the second should merge into the first".
 *
 * Opening a file **replaces** the canvas and keeps doing so — the merge is an
 * explicit action ("File > Insert document..."), so what is checked here is the
 * *insertion*:
 *
 * - the document's content is **added** to the canvas, and the content that was
 *   already there is left alone (AC-41);
 * - it lands on the **page the user is on**, and that page **grows** to hold
 *   it (AC-42);
 * - the binary files it brings get ids of their **own**, so an id that is
 *   already taken in this document cannot change an image (AC-43).
 *
 * Every assertion goes through the library's own functions — `getCommonBounds`,
 * `getPageRect`, `getElementsForPage` — so a self-consistent-but-wrong
 * implementation cannot pass.
 */

import { getCommonBounds, newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import { actionInsertDocument } from "../actions/actionExport";
import { Excalidraw } from "../index";
import { getElementsForPage, getPageRect } from "../scene/pages";
import {
  insertDocumentIntoScene,
  readDocumentFromFile,
} from "../scene/insertDocument";
import { PAGE_WIDTH } from "../types";

import { render } from "./test-utils";
import { API } from "./helpers/api";

import type { BinaryFiles, ExcalidrawPage } from "../types";

const PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

/** an element as it is written into a `.excalidraw` file */
const fileElement = (overrides: Record<string, unknown> = {}) => ({
  id: "el-1",
  type: "rectangle",
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: "a0",
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  ...overrides,
});

/** a `.excalidraw` file */
const makeFile = ({
  elements = [fileElement()],
  files = {},
}: {
  elements?: Record<string, unknown>[];
  files?: Record<string, unknown>;
} = {}) =>
  new Blob(
    [
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements,
        appState: {},
        files,
      }),
    ],
    { type: "application/json" },
  );

describe("insert a document into the current canvas", () => {
  it("AC-41 inserting a document adds its elements and leaves the canvas alone", async () => {
    const kept = newElementWith(
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      }),
      { pageId: "page-1" },
    );

    const document = await readDocumentFromFile(
      makeFile({
        elements: [
          fileElement({ id: "ins-1", x: 0, y: 0, width: 100, height: 50 }),
          fileElement({
            id: "ins-2",
            type: "ellipse",
            x: 0,
            y: 0,
            width: 80,
            height: 40,
          }),
        ],
      }),
    );

    const result = insertDocumentIntoScene({
      elements: [kept],
      pages: PAGES,
      currentPageId: "page-1",
      document,
      files: {},
    });

    // what was on the canvas is still there, exactly as it was
    const survivor = result.elements.find((el) => el.id === kept.id);

    expect(survivor).toBeDefined();
    expect(survivor!.x).toBe(100);
    expect(survivor!.y).toBe(100);
    expect(survivor!.width).toBe(200);
    expect(survivor!.height).toBe(100);
    expect(survivor!.pageId).toBe("page-1");

    // and the document's content was **added** to it, not swapped for it
    expect(result.elements.length).toBe(3);

    const arrived = result.elements.filter((el) => el.id !== kept.id);

    expect(arrived.length).toBe(2);

    // the content that arrived does not sit on top of what was already there
    const [, , existingRight] = getCommonBounds([kept]);
    const [arrivedLeft] = getCommonBounds(arrived);

    expect(arrivedLeft).toBeGreaterThan(existingRight);
  });

  it("AC-42 the inserted content is on the current page and the page grows", async () => {
    const page2 = getPageRect(PAGES, "page-2");

    // the content of page 2 sits near the page's right edge, so the content
    // that arrives beside it hangs over the edge
    const kept = newElementWith(
      API.createElement({
        type: "rectangle",
        x: page2.x + page2.width - 200,
        y: page2.y + 100,
        width: 100,
        height: 100,
      }),
      { pageId: "page-2" },
    );

    const document = await readDocumentFromFile(
      makeFile({
        elements: [
          fileElement({ id: "ins-1", x: 0, y: 0, width: 300, height: 100 }),
        ],
      }),
    );

    const result = insertDocumentIntoScene({
      elements: [kept],
      pages: PAGES,
      currentPageId: "page-2",
      document,
      files: {},
    });

    const arrived = result.elements.filter((el) => el.id !== kept.id);

    expect(arrived.length).toBe(1);

    // the content is on the page the user is on
    expect(arrived[0].pageId).toBe("page-2");
    expect(getElementsForPage(result.elements, "page-2").length).toBe(2);
    expect(getElementsForPage(result.elements, "page-1").length).toBe(0);

    // the page grew to contain it
    const grown = getPageRect(result.pages, "page-2");

    expect(grown.width).toBeGreaterThan(page2.width);

    // ... and the content is inside the grown page, so the camera can reach it
    const [minX, minY, maxX, maxY] = getCommonBounds(arrived);

    expect(minX).toBeGreaterThanOrEqual(grown.x);
    expect(minY).toBeGreaterThanOrEqual(grown.y);
    expect(maxX).toBeLessThanOrEqual(grown.x + grown.width);
    expect(maxY).toBeLessThanOrEqual(grown.y + grown.height);

    // the page that was not being edited is left alone
    expect(getPageRect(result.pages, "page-1").width).toBe(PAGE_WIDTH);
  });

  it("AC-43 the inserted content's file ids are fresh", async () => {
    // this document already holds a file under the id "file-1"
    const files: BinaryFiles = {
      "file-1": {
        id: "file-1" as FileId,
        dataURL:
          "data:image/png;base64,EXISTING" as BinaryFiles[string]["dataURL"],
        mimeType: "image/png",
        created: 1,
      },
    };

    // and the inserted document brings an image under **that** id
    const document = await readDocumentFromFile(
      makeFile({
        elements: [
          fileElement({
            id: "ins-img",
            type: "image",
            fileId: "file-1",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          }),
        ],
        files: {
          "file-1": {
            id: "file-1",
            dataURL: "data:image/png;base64,INSERTED",
            mimeType: "image/png",
            created: 1,
          },
        },
      }),
    );

    const result = insertDocumentIntoScene({
      elements: [],
      pages: PAGES,
      currentPageId: "page-1",
      document,
      files,
    });

    const arrived = result.elements[0] as ExcalidrawElement & {
      fileId: FileId | null;
    };

    expect(arrived.type).toBe("image");
    expect(arrived.fileId).toBeTruthy();

    // the id that was already taken did not change the image
    expect(arrived.fileId).not.toBe("file-1");
    expect(files["file-1"].dataURL).toBe(
      "data:image/png;base64,EXISTING" as BinaryFiles[string]["dataURL"],
    );

    // the inserted image is in the file store under its own id
    expect(result.files[arrived.fileId!]).toBeDefined();
    expect(result.files[arrived.fileId!].dataURL).toBe(
      "data:image/png;base64,INSERTED" as BinaryFiles[string]["dataURL"],
    );
    expect(result.files[arrived.fileId!].id).toBe(arrived.fileId);
  });

  it("the action is offered only when the canvas has content", async () => {
    await render(
      <Excalidraw UIOptions={{ canvasActions: { insertDocument: true } }} />,
    );

    const actionManager = (window.h.app as any).actionManager;

    API.setElements([]);

    // an empty canvas: "open" is what the user wants there, not "insert"
    expect(actionManager.isActionEnabled(actionInsertDocument)).toBe(false);

    API.setElements([API.createElement({ type: "rectangle" })]);

    expect(actionManager.isActionEnabled(actionInsertDocument)).toBe(true);
  });

  it("the action is off unless the host app turns it on", async () => {
    await render(<Excalidraw />);

    API.setElements([API.createElement({ type: "rectangle" })]);

    const actionManager = (window.h.app as any).actionManager;

    expect(actionManager.isActionEnabled(actionInsertDocument)).toBe(false);
  });
});
