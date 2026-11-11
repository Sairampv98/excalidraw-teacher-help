/**
 * The **pairing prompt** (D-518): a page that has no token asks to connect, and
 * the editor asks the teacher - "Allow the whiteboard at 127.0.0.1:3061 to
 * connect?" - instead of the teacher copying a token from the editor to the page.
 *
 * Only the origins the bridge already accepts can even ask (localhost and the
 * loopback address, checked before the websocket is upgraded), and the answer
 * is the teacher's: a page that is refused, or dismissed, or not answered, does
 * not connect. An origin that was allowed is remembered, so the teacher is
 * asked once for each; the remembered list can be forgotten with a command.
 *
 * This module imports nothing from `vscode`: the editor's prompt and the
 * editor's storage are handed in, so the rules can be driven by a test.
 */

/** where the allowed origins are kept: the editor's own global state */
export interface PairingStore {
  read: () => string[];
  write: (origins: string[]) => PromiseLike<void> | void;
}

/** asks the teacher; true only for an explicit Allow */
export type PairingAsk = (question: string, origin: string) => Promise<boolean>;

export interface PairingOptions {
  store: PairingStore;
  ask: PairingAsk;
  /** how many origins are remembered at most; the oldest is dropped */
  limit?: number;
}

export interface Pairing {
  /**
   * May this origin connect? Remembered origins are allowed without asking;
   * otherwise the teacher is asked, and an Allow is remembered. Two pages of
   * the same origin asking together get ONE question.
   */
  decide: (origin: string | undefined) => Promise<boolean>;
  /** is this origin remembered as allowed? */
  isPaired: (origin: string | undefined) => boolean;
  /** the remembered origins, oldest first */
  list: () => string[];
  /** forget every remembered origin; how many were forgotten */
  forget: () => Promise<number>;
}

/** the buttons of the prompt */
export const PAIRING_ALLOW = "Allow";
export const PAIRING_DENY = "Not now";

/** how many origins are remembered if nothing says otherwise */
export const PAIRING_LIMIT = 20;

/** the host and port of an origin, as the teacher reads them: `127.0.0.1:3061` */
export const originLabel = (origin: string): string => {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
};

/** the question the teacher is asked */
export const pairingQuestion = (origin: string): string =>
  `Allow the whiteboard at ${originLabel(origin)} to connect?`;

/** an origin as it is compared and remembered: scheme, host and port, lower case */
const normalise = (origin: string | undefined): string | null => {
  if (!origin) {
    return null;
  }

  try {
    const url = new URL(origin);

    return url.origin === "null" ? null : url.origin.toLowerCase();
  } catch {
    return null;
  }
};

export const createPairing = (options: PairingOptions): Pairing => {
  const limit = options.limit ?? PAIRING_LIMIT;
  const asking = new Map<string, Promise<boolean>>();

  const list = (): string[] =>
    options.store
      .read()
      .filter((entry): entry is string => typeof entry === "string");

  const isPaired = (origin: string | undefined): boolean => {
    const key = normalise(origin);

    return key !== null && list().includes(key);
  };

  const remember = async (key: string) => {
    const next = [...list().filter((entry) => entry !== key), key];

    await options.store.write(next.slice(Math.max(0, next.length - limit)));
  };

  return {
    list,
    isPaired,

    decide: (origin) => {
      const key = normalise(origin);

      if (key === null) {
        return Promise.resolve(false);
      }

      if (isPaired(key)) {
        return Promise.resolve(true);
      }

      const pending = asking.get(key);

      if (pending) {
        return pending;
      }

      const answer = (async () => {
        try {
          if (!(await options.ask(pairingQuestion(key), key))) {
            return false;
          }

          await remember(key);

          return true;
        } catch {
          // a prompt that failed is not an Allow
          return false;
        } finally {
          asking.delete(key);
        }
      })();

      asking.set(key, answer);

      return answer;
    },

    forget: async () => {
      const count = list().length;

      await options.store.write([]);

      return count;
    },
  };
};
