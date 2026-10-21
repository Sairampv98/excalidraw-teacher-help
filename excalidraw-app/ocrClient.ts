/**
 * The OCR hook of a panel.
 *
 * A panel's content may carry text that the machine should read: a video's
 * captions, a chart's labels, a slide's text. The OCR hook is the one place
 * where that text leaves the panel and comes back as **text**, so it is kept
 * deliberately small and deliberately separate from the panel machinery.
 *
 * ## Why it is a client and not a library call
 *
 * OCR is a **service**, not a browser feature: there is no offline OCR in the
 * platform. So the panel machinery only knows the *shape* of the hook — a
 * request in, a result out — and the host decides which service answers it.
 * That keeps the library free of an endpoint, an API key and a network
 * dependency, and it keeps the OCR service swappable.
 *
 * ## The size rule
 *
 * The request carries an ordinary **PNG** — a poster, never a panel's own
 * bytes (D-65). A panel's bytes never travel a channel that has no size
 * guard.
 */

export type OcrRequest = {
  /** the image to read, as a data URL */
  dataURL: string;
  /** the image's media type */
  mimeType: string;
  /** the language hint, when the caller knows it */
  language?: string;
};

/** One block of recognised text, with its box in the image's own pixels. */
export type OcrBlock = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrResult = {
  /** the whole recognised text */
  text: string;
  /** the recognised blocks, when the service reports them */
  blocks: OcrBlock[];
};

export type OcrClient = {
  recognize: (request: OcrRequest) => Promise<OcrResult>;
};

export class OcrError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OcrError";
  }
}

const parseResult = (payload: unknown): OcrResult => {
  if (!payload || typeof payload !== "object") {
    throw new OcrError("The OCR service returned a malformed response");
  }

  const { text, blocks } = payload as { text?: unknown; blocks?: unknown };

  if (typeof text !== "string") {
    throw new OcrError("The OCR service returned no text");
  }

  return {
    text,
    blocks: Array.isArray(blocks)
      ? (blocks as OcrBlock[]).filter(
          (block) =>
            !!block &&
            typeof block.text === "string" &&
            typeof block.x === "number" &&
            typeof block.y === "number" &&
            typeof block.width === "number" &&
            typeof block.height === "number",
        )
      : [],
  };
};

/**
 * A client for an OCR service.
 *
 * The service is expected to answer with JSON: `{ "text": string, "blocks":
 * [...] }`. The client's job is only to carry the request and to refuse a
 * malformed answer — everything about *which* service answers is the host's
 * business.
 */
export const createOcrClient = ({
  endpoint,
  fetchImpl,
  headers,
}: {
  /** the URL of the OCR service */
  endpoint: string;
  /** the fetch to use — the default is the global one */
  fetchImpl?: typeof fetch;
  /** extra headers, e.g. an authorization header */
  headers?: Record<string, string>;
}): OcrClient => {
  const doFetch =
    fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  return {
    recognize: async (request) => {
      let response: Response;

      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({
            image: request.dataURL,
            mimeType: request.mimeType,
            language: request.language ?? null,
          }),
        });
      } catch (error) {
        throw new OcrError("The OCR service could not be reached", error);
      }

      if (!response.ok) {
        throw new OcrError(`The OCR service answered with ${response.status}`);
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch (error) {
        throw new OcrError("The OCR service returned malformed JSON", error);
      }

      return parseResult(payload);
    },
  };
};
