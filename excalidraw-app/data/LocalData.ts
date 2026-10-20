/**
 * This file deals with saving data state (appState, elements, images, ...)
 * locally to the browser.
 *
 * Notes:
 *
 * - DataState refers to full state of the app: appState, elements, images,
 *   though some state is saved separately (collab username, library) for one
 *   reason or another. We also save different data to different storage
 *   (localStorage, indexedDB).
 */

import { clearAppStateForLocalStorage } from "@excalidraw/excalidraw/appState";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { growPagesToFitContent } from "@excalidraw/excalidraw/scene";
import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  debounce,
} from "@excalidraw/common";
import {
  createStore,
  entries,
  del,
  getMany,
  set,
  setMany,
  get,
} from "idb-keyval";

import { getNonDeletedElements } from "@excalidraw/element";

import { DEFAULT_PAGE_ID } from "@excalidraw/excalidraw/types";

import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawPage,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { MaybePromise } from "@excalidraw/common/utility-types";

import { appJotaiStore, atom } from "../app-jotai";
import { SAVE_TO_LOCAL_STORAGE_TIMEOUT, STORAGE_KEYS } from "../app_constants";

import { FileManager } from "./FileManager";
import { FileStatusStore } from "./fileStatusStore";
import { Locker } from "./Locker";
import { updateBrowserStateVersion } from "./tabSync";
import { importFromLocalStorage } from "./localStorage";
import {
  createDocumentStore,
  type DocumentStore,
  type DocumentStoreBackend,
} from "./documentStore";
import {
  installDocumentStatsConsoleApi,
  recordActiveBackend,
  recordDocumentCounts,
  recordSave,
} from "./documentStats";

const filesStore = createStore("files-db", "files-store");

// the document's numbers are readable from the console (D-10)
installDocumentStatsConsoleApi();

export const localStorageQuotaExceededAtom = atom(false);

/** which backend the document is persisted through (AC-8) */
export const documentStoreBackendAtom = atom<DocumentStoreBackend | null>(null);

/** a message shown to the user when the document could not be persisted */
export const documentStoreErrorAtom = atom<string | null>(null);

let documentStorePromise: Promise<DocumentStore> | null = null;

/**
 * What the store holds for each page's element bucket.
 *
 * A bucket whose content did not change is not written again: a document with
 * thousands of pages would otherwise rewrite every bucket on every keystroke.
 */
const lastWrittenBuckets = new Map<string, string>();

/**
 * The document store of this session (D-6).
 *
 * The backend is picked **once**, at startup: IndexedDB is primary, the
 * localStorage backend takes over when IndexedDB cannot be opened. The active
 * backend is reported so that a degraded store is visible.
 */
export const getDocumentStore = (): Promise<DocumentStore> => {
  if (!documentStorePromise) {
    documentStorePromise = createDocumentStore().then((store) => {
      recordActiveBackend(store.backend);
      appJotaiStore.set(documentStoreBackendAtom, store.backend);
      return store;
    });
  }

  return documentStorePromise;
};

/** drops the session's store — the next call picks the backend again */
export const resetDocumentStore = () => {
  documentStorePromise = null;
  lastWrittenBuckets.clear();
  appJotaiStore.set(documentStoreBackendAtom, null);
  recordActiveBackend(null);
};

/** the document as it is persisted */
export type LoadedDocument = {
  elements: OrderedExcalidrawElement[];
  pages: readonly ExcalidrawPage[];
  currentPageId: string;
};

class LocalFileManager extends FileManager {
  clearObsoleteFiles = async (opts: { currentFileIds: FileId[] }) => {
    await entries(filesStore).then((entries) => {
      for (const [id, imageData] of entries as [FileId, BinaryFileData][]) {
        // if image is unused (not on canvas) & is older than 1 day, delete it
        // from storage. We check `lastRetrieved` we care about the last time
        // the image was used (loaded on canvas), not when it was initially
        // created.
        if (
          (!imageData.lastRetrieved ||
            Date.now() - imageData.lastRetrieved > 24 * 3600 * 1000) &&
          !opts.currentFileIds.includes(id as FileId)
        ) {
          del(id, filesStore);
        }
      }
    });
  };
}

const saveDataStateToLocalStorage = (appState: AppState) => {
  const localStorageQuotaExceeded = appJotaiStore.get(
    localStorageQuotaExceededAtom,
  );
  try {
    const _appState = clearAppStateForLocalStorage(appState);

    if (
      _appState.openSidebar?.name === DEFAULT_SIDEBAR.name &&
      _appState.openSidebar.tab === CANVAS_SEARCH_TAB
    ) {
      _appState.openSidebar = null;
    }

    // the document's structure — its page list and its content — belongs to the
    // document store (D-6). A copy here would only risk the very quota error
    // that used to drop the page list.
    delete _appState.pages;
    delete _appState.currentPageId;

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify(_appState),
    );
    updateBrowserStateVersion(STORAGE_KEYS.VERSION_DATA_STATE);
    if (localStorageQuotaExceeded) {
      appJotaiStore.set(localStorageQuotaExceededAtom, false);
    }
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
    if (isQuotaExceededError(error) && !localStorageQuotaExceeded) {
      appJotaiStore.set(localStorageQuotaExceededAtom, true);
    }
  }
};

const isQuotaExceededError = (error: any) => {
  return error instanceof DOMException && error.name === "QuotaExceededError";
};

type SavingLockTypes = "collaboration";

export class LocalData {
  private static _save = debounce(
    async (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      saveDataStateToLocalStorage(appState);

      await this.saveDocument(elements, appState);

      await this.fileStorage.saveFiles({
        elements,
        files,
      });
      onFilesSaved();
    },
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /**
   * Writes the document through the store (D-6).
   *
   * The **page index** and the **element buckets** are separate records: the
   * index is written first, so a failing element write can never take the
   * page list down with it. That separation is the structural fix for the
   * "pages stop being saved past roughly fifteen" bug.
   *
   * A write failure is surfaced to the user, never swallowed.
   */
  static saveDocument = async (
    elements: readonly ExcalidrawElement[],
    appState: Pick<AppState, "pages" | "currentPageId">,
  ) => {
    const store = await getDocumentStore();
    const pages = appState.pages ?? [];

    const nonDeleted = getNonDeletedElements(elements);

    const buckets = new Map<string, ExcalidrawElement[]>();
    for (const page of pages) {
      buckets.set(page.id, []);
    }
    for (const element of nonDeleted) {
      const pageId = element.pageId ?? DEFAULT_PAGE_ID;
      const bucket = buckets.get(pageId);
      if (bucket) {
        bucket.push(element);
      }
    }

    // only the buckets whose content changed are written again — rewriting
    // every bucket of a document with thousands of pages on every keystroke
    // would make that document unusable
    const serialized = new Map<string, string>();
    const changed: (readonly [string, readonly ExcalidrawElement[]])[] = [];

    for (const page of pages) {
      const content = JSON.stringify(buckets.get(page.id) ?? []);
      serialized.set(page.id, content);
      if (lastWrittenBuckets.get(page.id) !== content) {
        changed.push([page.id, buckets.get(page.id) ?? []]);
      }
    }

    const startedAt = performance.now();

    try {
      // the page index goes first, and on its own
      await store.savePages(pages, appState.currentPageId ?? null);

      if (store.savePageElementsMany) {
        await store.savePageElementsMany(changed);
      } else {
        for (const [pageId, pageElements] of changed) {
          await store.savePageElements(pageId, pageElements);
        }
      }
    } catch (error) {
      console.error("document: could not save the document", error);
      appJotaiStore.set(
        documentStoreErrorAtom,
        "Could not save the document. Your changes may not be stored.",
      );
      throw error;
    }

    // remember what the store holds now
    for (const [pageId, content] of serialized) {
      lastWrittenBuckets.set(pageId, content);
    }
    for (const pageId of [...lastWrittenBuckets.keys()]) {
      if (!serialized.has(pageId)) {
        lastWrittenBuckets.delete(pageId);
      }
    }

    const latencyMs = performance.now() - startedAt;

    const bytes =
      JSON.stringify(pages).length +
      [...serialized.values()].reduce(
        (total, content) => total + content.length,
        0,
      );

    recordSave({ latencyMs, bytes });

    recordDocumentCounts({
      totalElementCount: nonDeleted.length,
      currentPageElementCount:
        buckets.get(appState.currentPageId ?? DEFAULT_PAGE_ID)?.length ?? 0,
      pageCount: pages.length,
    });
  };

  /**
   * Reads the document back (D-6).
   *
   * The store is the document's home. The legacy localStorage snapshot is only
   * read when the store has never been written — that is the migration path
   * for documents saved before the store existed.
   *
   * The elements are stamped with the document's **default page id**, and the
   * pages are grown to contain their content, so an imported scene's content
   * is reachable.
   */
  static loadDocument = async (): Promise<LoadedDocument | null> => {
    const store = await getDocumentStore();

    let pages: readonly ExcalidrawPage[] = [];
    let rawElements: readonly ExcalidrawElement[] = [];
    let currentPageId: string | null = null;

    try {
      const stored = await store.load();
      pages = stored.pages;
      rawElements = Object.values(stored.elementsByPage).flat();
      currentPageId = stored.currentPageId;
    } catch (error) {
      console.error("document: could not read the document", error);
      appJotaiStore.set(
        documentStoreErrorAtom,
        "Could not read the saved document.",
      );
    }

    const legacy = importFromLocalStorage();

    if (!pages.length) {
      // the store has never been written — fall back to the legacy snapshot
      pages = legacy.appState?.pages ?? [];
      rawElements = legacy.elements ?? [];
    }

    if (!pages.length) {
      return null;
    }

    const defaultPageId = pages[0].id;

    const elements = restoreElements(rawElements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
      defaultPageId,
    });

    return {
      elements,
      pages: growPagesToFitContent(pages, elements),
      currentPageId:
        currentPageId && pages.some((page) => page.id === currentPageId)
          ? currentPageId
          : defaultPageId,
    };
  };

  /**
   * The raw document, as the legacy export path expects it: the app state and
   * the elements as JSON strings.
   *
   * The document itself lives in the store now, so the elements are read back
   * from there rather than from the legacy localStorage snapshot.
   */
  static getRawDocument = async (): Promise<{
    rawAppStateString: string | null;
    rawElementsString: string | null;
  }> => {
    const store = await getDocumentStore();
    const stored = await store.load();

    let appState: Record<string, unknown> = {};

    try {
      appState = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE) ?? "{}",
      );
    } catch (error) {
      console.error(error);
    }

    return {
      rawAppStateString: JSON.stringify({
        ...appState,
        pages: stored.pages,
        currentPageId: stored.currentPageId,
      }),
      rawElementsString: JSON.stringify(
        Object.values(stored.elementsByPage).flat(),
      ),
    };
  };

  /** Saves DataState, including files. Bails if saving is paused */
  static save = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ) => {
    // we need to make the `isSavePaused` check synchronously (undebounced)
    if (!this.isSavePaused()) {
      this._save(elements, appState, files, onFilesSaved);
    }
  };

  static flushSave = () => {
    this._save.flush();
  };

  private static locker = new Locker<SavingLockTypes>();

  static pauseSave = (lockType: SavingLockTypes) => {
    this.locker.lock(lockType);
  };

  static resumeSave = (lockType: SavingLockTypes) => {
    this.locker.unlock(lockType);
  };

  static isSavePaused = () => {
    return document.hidden || this.locker.isLocked();
  };

  // ---------------------------------------------------------------------------

  static fileStorage = new LocalFileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles(ids) {
      return getMany(ids, filesStore).then(
        async (filesData: (BinaryFileData | undefined)[]) => {
          const loadedFiles: BinaryFileData[] = [];
          const erroredFiles = new Map<FileId, true>();

          const filesToSave: [FileId, BinaryFileData][] = [];

          filesData.forEach((data, index) => {
            const id = ids[index];
            if (data) {
              const _data: BinaryFileData = {
                ...data,
                lastRetrieved: Date.now(),
              };
              filesToSave.push([id, _data]);
              loadedFiles.push(_data);
            } else {
              erroredFiles.set(id, true);
            }
          });

          try {
            // save loaded files back to storage with updated `lastRetrieved`
            setMany(filesToSave, filesStore);
          } catch (error) {
            console.warn(error);
          }

          return { loadedFiles, erroredFiles };
        },
      );
    },
    async saveFiles({ addedFiles }) {
      const savedFiles = new Map<FileId, BinaryFileData>();
      const erroredFiles = new Map<FileId, BinaryFileData>();

      // before we use `storage` event synchronization, let's update the flag
      // optimistically. Hopefully nothing fails, and an IDB read executed
      // before an IDB write finishes will read the latest value.
      updateBrowserStateVersion(STORAGE_KEYS.VERSION_FILES);

      await Promise.all(
        [...addedFiles].map(async ([id, fileData]) => {
          try {
            await set(id, fileData, filesStore);
            savedFiles.set(id, fileData);
          } catch (error: any) {
            console.error(error);
            erroredFiles.set(id, fileData);
          }
        }),
      );

      return { savedFiles, erroredFiles };
    },
  });
}
export class LibraryIndexedDBAdapter {
  /** IndexedDB database and store name */
  private static idb_name = STORAGE_KEYS.IDB_LIBRARY;
  /** library data store key */
  private static key = "libraryData";

  private static store = createStore(
    `${LibraryIndexedDBAdapter.idb_name}-db`,
    `${LibraryIndexedDBAdapter.idb_name}-store`,
  );

  static async load() {
    const IDBData = await get<LibraryPersistedData>(
      LibraryIndexedDBAdapter.key,
      LibraryIndexedDBAdapter.store,
    );

    return IDBData || null;
  }

  static save(data: LibraryPersistedData): MaybePromise<void> {
    return set(
      LibraryIndexedDBAdapter.key,
      data,
      LibraryIndexedDBAdapter.store,
    );
  }
}

/** LS Adapter used only for migrating LS library data
 * to indexedDB */
export class LibraryLocalStorageMigrationAdapter {
  static load() {
    const LSData = localStorage.getItem(
      STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY,
    );
    if (LSData != null) {
      const libraryItems: ImportedDataState["libraryItems"] =
        JSON.parse(LSData);
      if (libraryItems) {
        return { libraryItems };
      }
    }
    return null;
  }
  static clear() {
    localStorage.removeItem(STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY);
  }
}
