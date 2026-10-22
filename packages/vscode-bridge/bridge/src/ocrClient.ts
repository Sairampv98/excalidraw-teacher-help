/**
 * The browser side of the **OCR** capability.
 *
 * The app asks the bridge to read an image; the bridge answers. This module is
 * the app's half of that conversation, and it is deliberately **thin**: it
 * speaks the shared contract (`./ocr`) and it never touches an engine.
 *
 * ## There is no engine here, and there must not be one
 *
 * The engine is `tesseract.js` (WASM), and it runs in the bridge's Node
 * process (D-59). A WASM OCR engine in the browser is a multi-megabyte
 * download on a slow classroom connection, and the project rule is no new
 * dependency without the owner's approval. So this file imports nothing but
 * types.
 *
 * ## With no bridge, the app says so
 *
 * `OCR_NEEDS_BRIDGE` is the sentence the app shows. A read that fails
 * **silently** is worse than one that fails loudly: the teacher would see a
 * panel with no text and no idea why (D-59).
 */

import type { BridgeMessage } from "./protocol";

import type { OcrEngineState, OcrRequest, OcrResult } from "./ocr";

/**
 * The sentence the app shows when there is no bridge to do the reading.
 */
export const OCR_NEEDS_BRIDGE =
  "OCR needs the bridge — start the Excalidraw Bridge extension in VS Code.";

/**
 * How long the app waits for the answer before it gives up.
 *
 * A cold worker pays for the language data on its first read, so the wait is
 * generous; a read that never answers must still end.
 */
export const OCR_TIMEOUT_MS = 60000;

export type OcrClientOptions = {
  /**
   * Sends the request to the bridge.
   *
   * It returns `false` when there is no bridge — the client turns that into
   * the "needs the bridge" refusal, so no caller has to check the connection
   * itself.
   */
  send: (message: BridgeMessage) => boolean;
  /** the id generator. For the tests. */
  newId?: () => string;
  /** how long to wait for the answer */
  timeoutMs?: number;
};

export type OcrClient = {
  /**
   * Reads the text out of an image.
   *
   * It rejects with the "needs the bridge" message when there is no bridge,
   * and with the bridge's own message when the read failed.
   */
  recognize: (request: Omit<OcrRequest, "id">) => Promise<OcrResult>;
  /** the answer arrived */
  settle: (result: OcrResult) => void;
  /** the read failed */
  fail: (id: string, message: string) => void;
  /** whether a read is in flight */
  isPending: () => boolean;
  /**
   * The engine's **state** arrived (D-90, D-91).
   *
   * The client only holds it: the panel shows it, and the reason an engine is
   * not there is a thing the teacher has to be told.
   */
  setState: (state: OcrEngineState) => void;
  /** the engine's state, as the extension last said it */
  getState: () => OcrEngineState | null;
};

let counter = 0;

const defaultNewId = () => {
  counter += 1;

  return `ocr-${Date.now().toString(36)}-${counter}`;
};

export const createOcrClient = ({
  send,
  newId = defaultNewId,
  timeoutMs = OCR_TIMEOUT_MS,
}: OcrClientOptions): OcrClient => {
  const pending = new Map<
    string,
    {
      resolve: (result: OcrResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  /**
   * The engine's state, as the extension last said it (D-90, D-91).
   *
   * It is held here so that the app can show it: which engine is in use, and
   * - when it is not there - the reason and what to install.
   */
  let engineState: OcrEngineState | null = null;

  const settleWith = (
    id: string,
    apply: (entry: NonNullable<ReturnType<typeof pending.get>>) => void,
  ) => {
    const entry = pending.get(id);

    if (!entry) {
      return;
    }

    pending.delete(id);

    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }

    apply(entry);
  };

  return {
    recognize: (request) => {
      const id = newId();

      const sent = send({
        v: 1,
        type: "ocr:request",
        id,
        imageBase64: request.imageBase64,
        ...(request.region ? { region: request.region } : {}),
        ...(request.language ? { language: request.language } : {}),
        // the engine is optional: the extension falls back to its own setting
        ...(request.engine ? { engine: request.engine } : {}),
      });

      if (!sent) {
        return Promise.reject(new Error(OCR_NEEDS_BRIDGE));
      }

      return new Promise<OcrResult>((resolve, reject) => {
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                pending.delete(id);
                reject(
                  new Error(
                    "the bridge did not answer the OCR request in time — is the extension still running?",
                  ),
                );
              }, timeoutMs)
            : null;

        pending.set(id, { resolve, reject, timer });
      });
    },

    settle: (result) => {
      settleWith(result.id, (entry) =>
        entry.resolve({
          id: result.id,
          text: result.text,
          lines: result.lines ?? [],
          ...(result.confidence === undefined
            ? {}
            : { confidence: result.confidence }),
          // which engine ran, and how long it took (D-90)
          ...(result.engine === undefined ? {} : { engine: result.engine }),
          ...(result.durationMs === undefined
            ? {}
            : { durationMs: result.durationMs }),
        }),
      );
    },

    fail: (id, message) => {
      settleWith(id, (entry) => entry.reject(new Error(message)));
    },

    isPending: () => pending.size > 0,

    setState: (next) => {
      engineState = next;
    },

    getState: () => engineState,
  };
};
