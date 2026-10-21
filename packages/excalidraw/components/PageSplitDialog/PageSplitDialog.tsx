import React from "react";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";
import { FilledButton } from "../FilledButton";
import { Modal } from "../Modal";

import { pageSplitStateAtom } from "./PageSplitState";

import "./PageSplitDialog.scss";

const TITLE_ID = "page-split-dialog-title";

/**
 * The offer made when a file that defines no pages does not fit on one page.
 *
 * The three answers are the three decisions the user may take (D-15): split
 * the content across pages, keep it on one big page, or cancel the import
 * altogether.
 */
export const PageSplitDialog = () => {
  const [pageSplitState, setState] = useAtom(pageSplitStateAtom);

  if (!pageSplitState.active) {
    return null;
  }

  /** answers the offer and closes it */
  const answer = (resolve: () => void) => {
    resolve();
    setState({ active: false });
  };

  return (
    <Modal
      className="PageSplitDialog"
      labelledBy={TITLE_ID}
      maxWidth={480}
      onCloseRequest={() => answer(pageSplitState.onClose)}
    >
      <div className="PageSplitDialog__content">
        <h2 id={TITLE_ID} className="PageSplitDialog__title">
          {t("pageSplit.title")}
        </h2>

        <p className="PageSplitDialog__description">
          {t("pageSplit.description", { count: pageSplitState.pageCount })}
        </p>

        <div className="PageSplitDialog__actions">
          <FilledButton
            color="primary"
            label={t("pageSplit.splitRecommended")}
            onClick={() => answer(pageSplitState.onSplit)}
          />
          <FilledButton
            color="muted"
            variant="outlined"
            label={t("pageSplit.keep")}
            onClick={() => answer(pageSplitState.onKeep)}
          />
          <FilledButton
            color="muted"
            variant="outlined"
            label={t("pageSplit.cancel")}
            onClick={() => answer(pageSplitState.onClose)}
          />
        </div>
      </div>
    </Modal>
  );
};
