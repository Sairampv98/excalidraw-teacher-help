/**
 * The **deleted pages** (D-280).
 *
 * Undo brings a deleted page back while the tab is open. A page that was
 * deleted yesterday, or before a reload, is not on the undo stack any more, and
 * a page is a lesson: so each page that is deleted is also kept here, in the
 * browser's own IndexedDB, with everything on it, and the teacher can bring it
 * back from the page bar.
 *
 * The newest {@link PAGE_TRASH_LIMIT} are kept; older ones are dropped. The
 * store is on the disk, not in memory, so a laptop with little memory pays for
 * it in disk space only - which the page bar shows (`storageUsage`).
 */

import { randomId } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  getPageRect,
  reconcileElements,
} from "@excalidraw/excalidraw";
import { clear, createStore, del, entries, set } from "idb-keyval";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawPage,
  PageRect,
} from "@excalidraw/excalidraw/types";

const trashStore = createStore("page-trash-db", "page-trash");

/** how many deleted pages are kept */
export const PAGE_TRASH_LIMIT = 100;

export type DeletedPage = {
  id: string;
  deletedAt: number;
  /** the page as it was: its name, its size, its frame */
  page: ExcalidrawPage;
  /** where the page was, so what is on it keeps its place on the page */
  rect: PageRect;
  /** the elements that were on it (also the ones that follow a page's own) */
  elements: ExcalidrawElement[];
  /** the files those elements need */
  files: Record<string, BinaryFileData>;
};

/** the files an element needs: its picture, its poster, its video */
const fileIdsOf = (element: ExcalidrawElement): FileId[] => {
  const found: Array<FileId | null | undefined> = [];
  const loose = element as unknown as {
    fileId?: FileId | null;
    posterFileId?: FileId | null;
    panel?: { source?: { type?: string; fileId?: FileId } };
  };

  found.push(loose.fileId, loose.posterFileId);

  if (loose.panel?.source?.type === "file") {
    found.push(loose.panel.source.fileId);
  }

  return found.filter((id): id is FileId => Boolean(id));
};

/**
 * Keeps the page that is about to be deleted, with its elements and files.
 *
 * It is called **before** the delete, from the page bar, and a failure to keep
 * it never stops the delete: undo is still there.
 */
export const keepDeletedPage = async (
  api: ExcalidrawImperativeAPI,
  pages: readonly ExcalidrawPage[],
  pageId: string,
): Promise<DeletedPage | null> => {
  const page = pages.find((candidate) => candidate.id === pageId);

  if (!page) {
    return null;
  }

  const elements = api
    .getSceneElementsIncludingDeleted()
    .filter((element) => element.pageId === pageId && !element.isDeleted);

  const allFiles = api.getFiles();
  const files: Record<string, BinaryFileData> = {};

  for (const element of elements) {
    for (const fileId of fileIdsOf(element)) {
      if (allFiles[fileId]) {
        files[fileId] = allFiles[fileId];
      }
    }
  }

  const entry: DeletedPage = {
    id: `${Date.now()}-${randomId()}`,
    deletedAt: Date.now(),
    page,
    rect: getPageRect(pages, pageId),
    elements: elements as ExcalidrawElement[],
    files,
  };

  await set(entry.id, entry, trashStore);
  await prune();

  return entry;
};

/** the kept pages, the newest first */
export const listDeletedPages = async (): Promise<DeletedPage[]> => {
  const all = (await entries<string, DeletedPage>(trashStore)).map(
    ([, value]) => value,
  );

  return all.sort((a, b) => b.deletedAt - a.deletedAt);
};

export const forgetDeletedPage = async (id: string) => {
  await del(id, trashStore);
};

export const forgetAllDeletedPages = async () => {
  await clear(trashStore);
};

/** drops the oldest pages past the limit */
const prune = async () => {
  const all = await listDeletedPages();

  for (const old of all.slice(PAGE_TRASH_LIMIT)) {
    await del(old.id, trashStore);
  }
};

/**
 * Brings a kept page back: as a new page after the last one, with everything
 * that was on it, in the same place on the page, and the view goes to it.
 *
 * The page is added at the end, so no other page moves and nothing else is
 * touched. The entry is removed from the store: it is a page again.
 */
export const restoreDeletedPage = async (
  api: ExcalidrawImperativeAPI,
  entry: DeletedPage,
) => {
  const state = api.getAppState();
  const pages = state.pages ?? [];
  const pageId = `page-${randomId()}`;
  const nextPages = [...pages, { ...entry.page, id: pageId }];

  const rect = getPageRect(nextPages, pageId);
  const dx = rect.x - entry.rect.x;
  const dy = rect.y - entry.rect.y;

  const restored = entry.elements.map((element) => ({
    ...element,
    x: element.x + dx,
    y: element.y + dy,
    pageId,
    isDeleted: false,
    version: element.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  })) as ExcalidrawElement[];

  const ids = new Set(restored.map((element) => element.id));
  const existing = api.getSceneElementsIncludingDeleted();

  // an element that is still in the scene as a deleted one is replaced by its
  // restored self; the rest are new
  const kept = existing.filter((element) => !ids.has(element.id));

  const files = Object.values(entry.files);

  if (files.length) {
    api.addFiles(files);
  }

  api.updateScene({
    elements: reconcileElements(
      kept as RemoteExcalidrawElement[],
      [...kept, ...restored] as RemoteExcalidrawElement[],
      state,
    ),
    appState: { pages: nextPages, currentPageId: pageId },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  await forgetDeletedPage(entry.id);

  return pageId;
};

/** how much of the browser's storage is used, when the browser says */
export const storageUsage = async (): Promise<{
  used: number;
  quota: number;
} | null> => {
  try {
    const estimate = await navigator.storage?.estimate?.();

    if (estimate?.usage === undefined || estimate.quota === undefined) {
      return null;
    }

    return { used: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
};
