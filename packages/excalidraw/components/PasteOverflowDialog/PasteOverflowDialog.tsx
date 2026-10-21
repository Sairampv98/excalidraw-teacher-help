import React from "react";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";
import { FilledButton } from "../FilledButton";
import { Modal } from "../Modal";

import { pasteOverflowStateAtom } from "./PasteOverflowState";

import "./PasteOverflowDialog.scss";

const TITLE_ID = "paste-overflow-dialog-title";

/**
 * The offer made when a pasted text does not fit on the current page.
 *
 * The three answers are the three decisions the user may take (D-24): discard
 * the rest, place everything on this page (growing it), or place the text
 * across multiple pages. Dismissing the offer without a choice places what
 * fits and leaves the rest in the clipboard.
 */
export const PasteOverflowDialog = () => {
  const [pasteOverflowState, setState] = useAtom(pasteOverflowStateAtom);

  if (!pasteOverflowState.active) {
    return null;
  }

  /** answers the offer and closes it */
  const answer = (resolve: () => void) => {
    resolve();
    setState({ active: false });
  };

  return (
    <Modal
      className="PasteOverflowDialog"
      labelledBy={TITLE_ID}
      maxWidth={480}
      onCloseRequest={() => answer(pasteOverflowState.onClose)}
    >
      <div className="PasteOverflowDialog__content">
        <h2 id={TITLE_ID} className="PasteOverflowDialog__title">
          {t("pasteOverflow.title")}
        </h2>

        <p className="PasteOverflowDialog__description">
          {t("pasteOverflow.description", {
            fitting: pasteOverflowState.fittingLineCount,
            total: pasteOverflowState.totalLineCount,
          })}
        </p>

        <div className="PasteOverflowDialog__actions">
          <FilledButton
            color="muted"
            variant="outlined"
            label={t("pasteOverflow.discard")}
            onClick={() => answer(pasteOverflowState.onDiscard)}
          />
          <FilledButton
            color="muted"
            variant="outlined"
            label={t("pasteOverflow.allOnPage")}
            onClick={() => answer(pasteOverflowState.onAllOnPage)}
          />
          <FilledButton
            color="primary"
            label={t("pasteOverflow.multiPage")}
            onClick={() => answer(pasteOverflowState.onMultiPage)}
          />
        </div>
      </div>
    </Modal>
  );
};
