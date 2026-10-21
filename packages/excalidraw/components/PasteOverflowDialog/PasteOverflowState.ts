import { atom, editorJotaiStore } from "../../editor-jotai";

/**
 * The answer the user gave to the paste offer.
 *
 * - `"discard"`: only the part that fits the page is placed, and the rest is
 *   written back to the clipboard (D-26);
 * - `"all-on-page"`: everything is placed and the page grows to contain it;
 * - `"multi-page"`: the text is split across pages.
 *
 * `null` is the offer **dismissed** without a choice: the first answer
 * without the clipboard write — what fits is placed, and the rest is left in
 * the clipboard.
 */
export type PasteOverflowChoice = "discard" | "all-on-page" | "multi-page";

export type PasteOverflowState =
  | {
      active: true;
      /** how many lines of the paste fit on the current page */
      fittingLineCount: number;
      /** how many lines the paste has in total */
      totalLineCount: number;

      onDiscard: () => void;
      onAllOnPage: () => void;
      onMultiPage: () => void;
      onClose: () => void;
    }
  | { active: false };

export const pasteOverflowStateAtom = atom<PasteOverflowState>({
  active: false,
});

/**
 * Asks the user what should happen to the text that does not fit on the page.
 *
 * The promise resolves with the answer, or with `null` when the offer is
 * dismissed without a choice.
 */
export async function openPasteOverflowModal({
  fittingLineCount,
  totalLineCount,
}: {
  fittingLineCount: number;
  totalLineCount: number;
}): Promise<PasteOverflowChoice | null> {
  return new Promise((resolve) => {
    editorJotaiStore.set(pasteOverflowStateAtom, {
      active: true,
      fittingLineCount,
      totalLineCount,
      onDiscard: () => resolve("discard"),
      onAllOnPage: () => resolve("all-on-page"),
      onMultiPage: () => resolve("multi-page"),
      onClose: () => resolve(null),
    });
  });
}
