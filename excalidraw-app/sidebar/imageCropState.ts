/**
 * Which image the crop window is open on (D-348).
 *
 * Like the node media's crop screen it is not part of the document: a small
 * store the window reads, so a double click, the crop button and Enter all open
 * the same window.
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

/** opens the crop window on an image of the canvas */
export const openImageCrop = (elementId: string) => set(elementId);

export const closeImageCrop = () => set(null);

export const imageCropElement = () => current;

export const useImageCropElement = () =>
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
