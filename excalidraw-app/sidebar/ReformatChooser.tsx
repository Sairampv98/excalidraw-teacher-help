import React, { useState } from "react";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { REFORMATS, reformatSelection } from "./reformat";

import type { ReformatFormat } from "./reformat";

/**
 * The chooser the canvas context menu's "Reformat as…" entry opens.
 *
 * The library cannot reformat anything itself — a syntax-highlighted code card
 * needs the app's own highlighter — so the app owns the chooser *and* the
 * reformats behind it.
 */
export const ReformatChooser = ({
  elements,
  onClose,
}: {
  elements: readonly ExcalidrawElement[];
  onClose: () => void;
}) => {
  const api = useExcalidrawAPI();
  const [busy, setBusy] = useState(false);

  const onChoose = async (format: ReformatFormat) => {
    if (!api || busy) {
      return;
    }

    setBusy(true);

    try {
      await reformatSelection(api, elements, format);
      onClose();
    } catch (error) {
      console.error(error);
      api.setToast({
        message: "Could not reformat the selection",
        closable: true,
      });
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("labels.reformatSelection")}
      onCloseRequest={onClose}
      size="small"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {REFORMATS.map((format) => (
          <FilledButton
            key={format.id}
            variant="outlined"
            fullWidth
            disabled={busy}
            onClick={() => onChoose(format.id)}
          >
            {format.label}
          </FilledButton>
        ))}
      </div>
    </Dialog>
  );
};
