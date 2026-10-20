import { atom, editorJotaiStore } from "../../editor-jotai";

import type { PageSplitChoice } from "../../data/pageSplit";

export type PageSplitState =
  | {
      active: true;
      /** how many pages the split would produce */
      pageCount: number;

      onClose: () => void;
      onSplit: () => void;
      onKeep: () => void;
    }
  | { active: false };

export const pageSplitStateAtom = atom<PageSplitState>({ active: false });

/**
 * Asks the user how a file that does not fit on one page should open.
 *
 * The promise resolves with the answer: `"split"` (tile it across pages),
 * `"keep"` (leave it on one big page) or `"cancel"` (import nothing).
 */
export async function openPageSplitModal({
  pageCount,
}: {
  pageCount: number;
}): Promise<PageSplitChoice> {
  return new Promise((resolve) => {
    editorJotaiStore.set(pageSplitStateAtom, {
      active: true,
      pageCount,
      onSplit: () => resolve("split"),
      onKeep: () => resolve("keep"),
      onClose: () => resolve("cancel"),
    });
  });
}
