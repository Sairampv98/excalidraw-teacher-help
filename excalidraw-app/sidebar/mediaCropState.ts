/**
 * Which node's media the crop screen is open on (D-247).
 *
 * Like the script editor's state it is not part of the document: nothing here is
 * saved with the drawing. It is a small store the crop screen reads, so that the
 * Edit chart panel and a double click on the media open the same screen.
 */

import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

const set = (next: string | null) => {
  if (next === current) {
    return;
  }

  current = next;
  listeners.forEach((listener) => listener());
};

/** opens the crop screen on the media of a node */
export const openMediaCrop = (nodeId: string) => set(nodeId);

export const closeMediaCrop = () => set(null);

export const mediaCropNode = () => current;

export const useMediaCropNode = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => null,
  );
