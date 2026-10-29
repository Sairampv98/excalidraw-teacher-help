/**
 * AC-289 - the files of a panel are kept with the document (D-250).
 *
 * A video that is small enough to travel in the document is a file of the
 * document's store. It has to be saved to the browser's storage like a picture
 * is, or the panel says its file is no longer there after a reload.
 */

import { describe, expect, it, vi } from "vitest";

import { videoPanelContent } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import { FileManager } from "../data/FileManager";
import { fileIdsOf, fileIdsOfAll } from "../data/fileIds";

const VIDEO = "video-file" as FileId;
const POSTER = "poster-file" as FileId;
const PICTURE = "picture-file" as FileId;

const videoPanel = (
  source: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  API.createElement({
    type: "panel",
    width: 200,
    height: 100,
    panelKind: "video",
    panel: videoPanelContent({
      source: source as never,
      tracks: [],
      language: "en",
      naturalWidth: 1920,
      naturalHeight: 1080,
    }),
    posterMode: false,
    posterFileId: null,
    ...extra,
  } as never) as ExcalidrawElement;

const fileOf = (id: FileId): BinaryFileData =>
  ({
    id,
    mimeType: "video/mp4",
    dataURL: "data:video/mp4;base64,AAAA",
    created: 1,
    lastRetrieved: 1,
    version: 1,
  } as unknown as BinaryFileData);

describe("AC-289 the files of a panel are kept with the document", () => {
  it("AC-289 an element needs the files it is made of", () => {
    // a picture needs its picture
    const picture = API.createElement({
      type: "image",
      fileId: PICTURE,
    });

    expect(fileIdsOf(picture)).toEqual([PICTURE]);

    // a video that is a file needs that file
    expect(
      fileIdsOf(
        videoPanel({ type: "file", fileId: VIDEO, mimeType: "video/mp4" }),
      ),
    ).toEqual([VIDEO]);

    // a poster panel needs the picture of its poster too
    expect(
      fileIdsOf(
        videoPanel(
          { type: "file", fileId: VIDEO, mimeType: "video/mp4" },
          { posterMode: true, posterFileId: POSTER },
        ),
      ),
    ).toEqual([VIDEO, POSTER]);

    // a video in the browser's media store, and a YouTube video, are not files of the document
    expect(
      fileIdsOf(
        videoPanel({ type: "media", mediaId: "m1", mimeType: "video/mp4" }),
      ),
    ).toEqual([]);
    expect(fileIdsOf(videoPanel({ type: "youtube", videoId: "abc" }))).toEqual(
      [],
    );

    // nothing else needs a file
    expect(fileIdsOf(API.createElement({ type: "rectangle" }))).toEqual([]);
    expect(fileIdsOf(API.createElement({ type: "text", text: "a" }))).toEqual(
      [],
    );
  });

  it("AC-289 the files of all the elements are named once each", () => {
    const panel = videoPanel({
      type: "file",
      fileId: VIDEO,
      mimeType: "video/mp4",
    });

    expect(
      fileIdsOfAll([
        panel,
        videoPanel({ type: "file", fileId: VIDEO, mimeType: "video/mp4" }),
        API.createElement({ type: "image", fileId: PICTURE }),
      ]),
    ).toEqual([VIDEO, PICTURE]);
    expect(fileIdsOfAll(null)).toEqual([]);
    expect(fileIdsOfAll(undefined)).toEqual([]);
  });

  it("AC-289 the file of a video panel is saved, once", async () => {
    const files = new Manager();
    const panel = videoPanel({
      type: "file",
      fileId: VIDEO,
      mimeType: "video/mp4",
    });

    await files.manager.saveFiles({
      elements: [panel],
      files: { [VIDEO]: fileOf(VIDEO) },
    });

    expect(files.save).toHaveBeenCalledTimes(1);
    expect([...files.save.mock.calls[0][0].addedFiles.keys()]).toEqual([VIDEO]);

    // it is saved already: the next change of the scene does not save it again
    await files.manager.saveFiles({
      elements: [panel],
      files: { [VIDEO]: fileOf(VIDEO) },
    });
    expect(files.save.mock.calls[1][0].addedFiles.size).toBe(0);

    // a panel whose file is not in the store has nothing to save
    const empty = new Manager();

    await empty.manager.saveFiles({ elements: [panel], files: {} });
    expect(empty.save.mock.calls[0][0].addedFiles.size).toBe(0);
  });

  it("AC-289 the page is not closed while the file of a video is being saved", async () => {
    let finish: () => void = () => {};
    const files = new Manager(
      (data) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              savedFiles: new Map(data.addedFiles),
              erroredFiles: new Map(),
            });
        }),
    );
    const panel = videoPanel({
      type: "file",
      fileId: VIDEO,
      mimeType: "video/mp4",
    });

    const saving = files.manager.saveFiles({
      elements: [panel],
      files: { [VIDEO]: fileOf(VIDEO) },
    });

    expect(files.manager.shouldPreventUnload([panel])).toBe(true);
    // and not for what is not being saved
    expect(
      files.manager.shouldPreventUnload([
        API.createElement({ type: "rectangle" }),
      ]),
    ).toBe(false);

    finish();
    await saving;

    expect(files.manager.shouldPreventUnload([panel])).toBe(false);
  });
});

/** a file manager that saves into a spy */
class Manager {
  save: ReturnType<typeof vi.fn> &
    ((data: { addedFiles: Map<FileId, BinaryFileData> }) => Promise<{
      savedFiles: Map<FileId, BinaryFileData>;
      erroredFiles: Map<FileId, BinaryFileData>;
    }>);

  manager: FileManager;

  constructor(
    save: (data: { addedFiles: Map<FileId, BinaryFileData> }) => Promise<{
      savedFiles: Map<FileId, BinaryFileData>;
      erroredFiles: Map<FileId, BinaryFileData>;
    }> = async (data) => ({
      savedFiles: new Map(data.addedFiles),
      erroredFiles: new Map(),
    }),
  ) {
    this.save = vi.fn(save) as never;
    this.manager = new FileManager({
      getFiles: async () => ({ loadedFiles: [], erroredFiles: new Map() }),
      saveFiles: this.save,
    });
  }
}
