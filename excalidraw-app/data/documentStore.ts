import { clear, createStore, del, get, getMany, keys, set } from "idb-keyval";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";

/**
 * The document store (D-6).
 *
 * The document — its page list and its content — is persisted through this
 * interface, with two backends:
 *
 * - **IndexedDB is primary.** `idb-keyval` (already a dependency) stores the
 *   page index and the per-page element buckets as **separate records**, so a
 *   failed element write can never take the page list down with it. That
 *   separation is the structural fix for the "pages stop being saved past
 *   roughly fifteen" bug: the old code wrote the elements and the page list
 *   into one `localStorage` blob, and a `QuotaExceededError` on the first
 *   write aborted the second.
 * - **localStorage is the fallback**, used when IndexedDB cannot be opened
 *   (private mode, disabled, or throwing on open). It keeps the same record
 *   separation, one `localStorage` key per record.
 *
 * A write failure is **surfaced, never swallowed**: the backends let the
 * error through, and the caller reports it to the user.
 *
 * Binary assets (images, GIFs) are *not* stored here — they keep using the
 * existing `files-db` IndexedDB store and are referenced by `fileId`.
 */

export type DocumentStoreBackend = "indexeddb" | "localstorage";

/** everything the document consists of, as persisted */
export type StoredDocument = {
  /** the page index */
  pages: readonly ExcalidrawPage[];
  /** the page the user was on — `null` when it is unknown */
  currentPageId: string | null;
  /** the element buckets, keyed by page id */
  elementsByPage: Record<string, readonly ExcalidrawElement[]>;
};

export interface DocumentStore {
  /** which backend is in use — reported to the user */
  readonly backend: DocumentStoreBackend;
  /** reads the whole document back */
  load(): Promise<StoredDocument>;
  /** writes the page index — a record of its own */
  savePages(
    pages: readonly ExcalidrawPage[],
    currentPageId?: string | null,
  ): Promise<void>;
  /** writes one page's element bucket — a record of its own */
  savePageElements(
    pageId: string,
    elements: readonly ExcalidrawElement[],
  ): Promise<void>;
  /**
   * Writes several element buckets at once.
   *
   * Optional: it is an optimisation (one transaction instead of one per
   * page), not a change of the contract — a batch is still a record that is
   * separate from the page index, so a failed batch cannot lose the page list.
   */
  savePageElementsMany?: (
    entries: readonly (readonly [string, readonly ExcalidrawElement[]])[],
  ) => Promise<void>;
  /** drops one page's element bucket */
  removePage(pageId: string): Promise<void>;
  /** drops everything */
  clear(): Promise<void>;
}

const DOCUMENT_DB_NAME = "excalidraw-document-db";
const DOCUMENT_STORE_NAME = "document-store";

/** key of the page index record */
const PAGES_KEY = "pages";
/** prefix of the per-page element bucket records */
const ELEMENTS_KEY_PREFIX = "elements:";

const elementsKey = (pageId: string) => `${ELEMENTS_KEY_PREFIX}${pageId}`;

const isElementsKey = (key: IDBValidKey | string): key is string =>
  typeof key === "string" && key.startsWith(ELEMENTS_KEY_PREFIX);

/** the page index record */
type PageIndexRecord = {
  pages: readonly ExcalidrawPage[];
  currentPageId: string | null;
};

/**
 * Reads a page index record.
 *
 * A bare array is accepted too, so a record written by an older build of the
 * store still loads.
 */
const readPageIndex = (value: unknown): PageIndexRecord => {
  if (Array.isArray(value)) {
    return { pages: value as readonly ExcalidrawPage[], currentPageId: null };
  }
  const record = value as PageIndexRecord | undefined;
  return {
    pages: Array.isArray(record?.pages) ? record.pages : [],
    currentPageId:
      typeof record?.currentPageId === "string" ? record.currentPageId : null,
  };
};

/**
 * IndexedDB backend — the primary store.
 *
 * The page index and the element buckets live in **separate records**, so a
 * failed element write leaves the page list intact.
 */
export class IndexedDbDocumentStore implements DocumentStore {
  readonly backend = "indexeddb" as const;

  private store = createStore(DOCUMENT_DB_NAME, DOCUMENT_STORE_NAME);

  /** opens the database — throws when IndexedDB is unavailable */
  async probe(): Promise<void> {
    await get(PAGES_KEY, this.store);
  }

  async load(): Promise<StoredDocument> {
    const pageIndex = readPageIndex(await get(PAGES_KEY, this.store));
    const pages = pageIndex.pages;

    const allKeys = await keys(this.store);
    const bucketKeys = allKeys.filter(isElementsKey);

    const buckets = await getMany<readonly ExcalidrawElement[]>(
      bucketKeys,
      this.store,
    );

    const elementsByPage: Record<string, readonly ExcalidrawElement[]> = {};

    bucketKeys.forEach((key, position) => {
      const pageId = key.slice(ELEMENTS_KEY_PREFIX.length);
      const elements = buckets[position];
      if (elements) {
        elementsByPage[pageId] = elements;
      }
    });

    return {
      pages,
      currentPageId: pageIndex.currentPageId,
      elementsByPage,
    };
  }

  async savePages(
    pages: readonly ExcalidrawPage[],
    currentPageId?: string | null,
  ): Promise<void> {
    const record: PageIndexRecord = {
      pages,
      currentPageId: currentPageId ?? null,
    };
    await set(PAGES_KEY, record, this.store);
  }

  async savePageElements(
    pageId: string,
    elements: readonly ExcalidrawElement[],
  ): Promise<void> {
    await set(elementsKey(pageId), elements, this.store);
  }

  async savePageElementsMany(
    entries: readonly (readonly [string, readonly ExcalidrawElement[]])[],
  ): Promise<void> {
    await Promise.all(
      entries.map(([pageId, elements]) =>
        this.savePageElements(pageId, elements),
      ),
    );
  }

  async removePage(pageId: string): Promise<void> {
    await del(elementsKey(pageId), this.store);
  }

  async clear(): Promise<void> {
    await clear(this.store);
  }
}

/**
 * localStorage backend — the fallback, used when IndexedDB cannot be opened.
 *
 * Same record separation as the IndexedDB backend: the page index has its own
 * key, every element bucket has its own.
 */
export class LocalStorageDocumentStore implements DocumentStore {
  readonly backend = "localstorage" as const;

  private pagesKey = STORAGE_KEYS.LOCAL_STORAGE_DOCUMENT_PAGES;
  private elementsKeyPrefix = STORAGE_KEYS.LOCAL_STORAGE_DOCUMENT_ELEMENTS;

  private elementsKey = (pageId: string) =>
    `${this.elementsKeyPrefix}:${pageId}`;

  async load(): Promise<StoredDocument> {
    const rawPages = localStorage.getItem(this.pagesKey);

    let pages: readonly ExcalidrawPage[] = [];
    let currentPageId: string | null = null;

    if (rawPages) {
      try {
        const index = readPageIndex(JSON.parse(rawPages));
        pages = index.pages;
        currentPageId = index.currentPageId;
      } catch (error) {
        console.error("document: could not read the page index", error);
      }
    }

    const elementsByPage: Record<string, readonly ExcalidrawElement[]> = {};

    for (const page of pages) {
      const raw = localStorage.getItem(this.elementsKey(page.id));
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          elementsByPage[page.id] = parsed;
        }
      } catch (error) {
        console.error("document: could not read a page's elements", error);
      }
    }

    return { pages, currentPageId, elementsByPage };
  }

  async savePages(
    pages: readonly ExcalidrawPage[],
    currentPageId?: string | null,
  ): Promise<void> {
    const record: PageIndexRecord = {
      pages,
      currentPageId: currentPageId ?? null,
    };
    localStorage.setItem(this.pagesKey, JSON.stringify(record));
  }

  async savePageElements(
    pageId: string,
    elements: readonly ExcalidrawElement[],
  ): Promise<void> {
    localStorage.setItem(this.elementsKey(pageId), JSON.stringify(elements));
  }

  async savePageElementsMany(
    entries: readonly (readonly [string, readonly ExcalidrawElement[]])[],
  ): Promise<void> {
    for (const [pageId, elements] of entries) {
      await this.savePageElements(pageId, elements);
    }
  }

  async removePage(pageId: string): Promise<void> {
    localStorage.removeItem(this.elementsKey(pageId));
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.pagesKey);
  }
}

/**
 * Picks the backend — once, at startup.
 *
 * IndexedDB is primary; the localStorage backend takes over when IndexedDB
 * cannot be opened. The active backend is reported to the user (AC-8), so a
 * degraded store is visible rather than silent.
 */
export const createDocumentStore = async (): Promise<DocumentStore> => {
  try {
    const store = new IndexedDbDocumentStore();
    await store.probe();
    return store;
  } catch (error) {
    console.warn(
      "document: IndexedDB is unavailable, falling back to localStorage",
      error,
    );
    return new LocalStorageDocumentStore();
  }
};
