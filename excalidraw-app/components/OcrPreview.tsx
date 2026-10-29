import { useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";

import { CODE_LANGUAGE_IDS } from "../codeLanguages";
import { correctedLines, ocrLinesToText } from "../ocr/ocrText";
import {
  insertCodeIntoScene,
  insertOcrLinesIntoScene,
  insertTextBlockIntoScene,
} from "../sidebar/insertIntoScene";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

export type OcrPreviewData = {
  lines: readonly OcrLine[];
  engine?: string;
  durationMs?: number;
};

/**
 * What an OCR read found, shown before it goes anywhere (D-277).
 *
 * The text is shown the way the picture had it - in order, with the indent of
 * each line - and it can be corrected here. Then the teacher chooses: put it on
 * the page as a text block, put it on the page as a code card in the language
 * they pick, put each line back where it was on the picture (D-293), or copy
 * it. Nothing is put on the page until they choose.
 */
export const OcrPreview = ({
  data,
  onClose,
}: {
  data: OcrPreviewData;
  onClose: () => void;
}) => {
  const api = useExcalidrawAPI();
  const [text, setText] = useState(() => ocrLinesToText(data.lines));
  const [language, setLanguage] = useState<string>("python");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown> | unknown) => {
    if (!api || busy || !text.trim()) {
      return;
    }

    setBusy(true);

    try {
      await action();
      onClose();
    } catch (error) {
      console.error(error);
      api.setToast({ message: "Could not use the text", closable: true });
      setBusy(false);
    }
  };

  const by = [
    data.engine ? `read with ${data.engine}` : "",
    data.durationMs ? `${Math.round(data.durationMs)} ms` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Dialog title="The text that was read" onCloseRequest={onClose} size="wide">
      <div
        data-testid="ocr-preview"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {by ? <div style={{ opacity: 0.7, fontSize: 13 }}>{by}</div> : null}
        <textarea
          data-testid="ocr-preview-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          rows={14}
          style={{
            width: "100%",
            boxSizing: "border-box",
            fontFamily: "monospace",
            fontSize: 15,
            whiteSpace: "pre",
            tabSize: 4,
            padding: 8,
          }}
        />
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          Paste where it was puts each line back at the place it had on the
          page.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            data-testid="ocr-preview-language"
            aria-label="Language of the code block"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {CODE_LANGUAGE_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <FilledButton
            variant="filled"
            disabled={busy || !text.trim()}
            onClick={() =>
              run(() => insertCodeIntoScene(api!, text, { language }))
            }
          >
            Paste as code block
          </FilledButton>
          <FilledButton
            variant="outlined"
            disabled={busy || !text.trim()}
            onClick={() => run(() => insertTextBlockIntoScene(api!, text))}
          >
            Paste as text
          </FilledButton>
          <FilledButton
            variant="outlined"
            disabled={busy || !text.trim()}
            onClick={() =>
              run(() =>
                insertOcrLinesIntoScene(api!, correctedLines(data.lines, text)),
              )
            }
          >
            Paste where it was
          </FilledButton>
          <FilledButton
            variant="outlined"
            disabled={busy || !text.trim()}
            onClick={() => run(() => navigator.clipboard.writeText(text))}
          >
            Copy
          </FilledButton>
          <FilledButton variant="outlined" onClick={onClose}>
            Cancel
          </FilledButton>
        </div>
      </div>
    </Dialog>
  );
};
