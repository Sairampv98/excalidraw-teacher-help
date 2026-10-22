/**
 * The **media store** (D-94).
 *
 * A video that is too big to travel in the document does not travel in the
 * document at all: its bytes go into a Blob in the origin's own IndexedDB, and
 * the document carries a **short id** instead of them.
 *
 * The store is `media-db` / `media-store` — the same `idb-keyval` helpers
 * `files-db` already uses, beside it in the same browser. IndexedDB stores a
 * Blob **by reference**, so the bytes go to the browser's own disk and never
 * into the JavaScript heap: a 620 MB video costs the tab nothing.
 *
 * The id is **random**, not a hash of the bytes: hashing would mean reading
 * the whole file again, which is the very thing this store exists to avoid.
 */

import { randomId } from "@excalidraw/common";
import { registerMediaResolver } from "@excalidraw/excalidraw";
import { createStore, del, get, set } from "idb-keyval";

/** the store's own database and object store, beside `files-db` */
const mediaStore = createStore("media-db", "media-store");

/**
 * The size a video may have before it stops travelling in the document.
 *
 * It is the **same number** the presenter's files channel already uses — the
 * two are the same decision seen from two sides (D-94, D-96).
 */
export const MEDIA_STORE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Writes a blob into the store and answers with its id.
 *
 * The blob is stored **as it is**: no base64, no ArrayBuffer copy, no hash.
 */
export const storeMedia = async (blob: Blob): Promise<string> => {
  const id = randomId();

  await set(id, blob, mediaStore);

  return id;
};

/**
 * Reads a blob back, or `null` when the store does not have it.
 *
 * `null` means the media is gone — the browser cleared the store, or the
 * document was opened on another machine. The panel says so rather than
 * showing an empty frame (D-93).
 */
export const readMedia = async (id: string): Promise<Blob | null> => {
  const value = await get<Blob>(id, mediaStore);

  return value instanceof Blob ? value : null;
};

/** forgets a media */
export const deleteMedia = async (id: string): Promise<void> => {
  await del(id, mediaStore);
};

/**
 * Registers the app's resolver with the library (D-95).
 *
 * The editor and the presenter both call it: they are the **same origin**, so
 * they read the same store, and each window makes its own object URL for it
 * (D-96). The library owns the shape and the app owns the bytes — the library
 * never touches IndexedDB and never sees a Blob.
 */
export const registerMediaStore = () => {
  registerMediaResolver(async (mediaId: string) => {
    const blob = await readMedia(mediaId);

    return blob ? URL.createObjectURL(blob) : null;
  });
};
