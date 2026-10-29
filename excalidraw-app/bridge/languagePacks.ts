/**
 * Language packs (D-289).
 *
 * Python and JavaScript run in the browser with nothing to download. Every
 * other language the in-browser editor runs comes as a **pack**: a runtime that
 * is downloaded once, when the teacher asks for it, and kept by the browser. The
 * language picker lists every language with a download icon on those that are
 * not here yet; a click starts the download and a bar says how far it is.
 *
 * A pack is data and two functions - how to install it and how to run with it -
 * so adding a language is adding an entry here. A pack that has no verified
 * source yet is listed as **not available yet** and cannot be started: the
 * picker never offers a download that would fail.
 */

/** where a language stands for the teacher */
export type LanguagePackState =
  | "ready"
  | "download"
  | "downloading"
  | "unavailable";

export type LanguagePack = {
  /** the language id the picker and the editor use */
  id: string;
  /** the name shown in the picker */
  name: string;
  /** runs with nothing to download */
  builtIn?: boolean;
  /**
   * Downloads the runtime, reporting how far it is (a fraction, or `null` when
   * it cannot tell). Absent until the pack has a source that was verified.
   */
  install?: (onProgress: (fraction: number | null) => void) => Promise<void>;
};

export const LANGUAGE_PACKS: LanguagePack[] = [
  { id: "python", name: "Python", builtIn: true },
  { id: "javascript", name: "JavaScript", builtIn: true },
  // listed, and not available yet: each needs a runtime whose source and size
  // are verified before a download is offered for it
  { id: "go", name: "Go" },
  { id: "java", name: "Java" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
];

const STORAGE_KEY = "language-packs-installed";

type Listener = () => void;

/**
 * The state of the packs of this page: which are installed, which are
 * downloading and how far. A small store with a subscription, so the panel and
 * the host see the same thing.
 */
export const createLanguagePacks = ({
  packs = LANGUAGE_PACKS,
  storage = typeof localStorage === "undefined" ? null : localStorage,
}: {
  packs?: readonly LanguagePack[];
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
} = {}) => {
  const listeners = new Set<Listener>();
  const downloading = new Map<string, number | null>();

  const readInstalled = (): Set<string> => {
    try {
      return new Set<string>(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  };

  const installed = readInstalled();

  const changed = () => listeners.forEach((listener) => listener());

  const stateOf = (pack: LanguagePack): LanguagePackState => {
    if (pack.builtIn || installed.has(pack.id)) {
      return "ready";
    }

    if (downloading.has(pack.id)) {
      return "downloading";
    }

    return pack.install ? "download" : "unavailable";
  };

  /** every pack, with where it stands */
  const list = () =>
    packs.map((pack) => ({
      id: pack.id,
      name: pack.name,
      state: stateOf(pack),
      progress: downloading.get(pack.id) ?? null,
    }));

  /** starts the download of a pack; the promise ends when it is installed */
  const install = async (id: string) => {
    const pack = packs.find((candidate) => candidate.id === id);

    if (!pack) {
      throw new Error(`There is no language pack called ${id}.`);
    }

    const state = stateOf(pack);

    if (state === "ready" || state === "downloading") {
      return;
    }

    if (!pack.install) {
      throw new Error(`${pack.name} is not available yet.`);
    }

    downloading.set(id, null);
    changed();

    try {
      await pack.install((fraction) => {
        downloading.set(id, fraction);
        changed();
      });
      installed.add(id);

      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...installed]));
      } catch {
        // the pack is installed for this visit even if it cannot be remembered
      }
    } finally {
      downloading.delete(id);
      changed();
    }
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  return {
    list,
    install,
    subscribe,
    isReady: (id: string) => {
      const pack = packs.find((candidate) => candidate.id === id);

      return !!pack && stateOf(pack) === "ready";
    },
  };
};

/** the packs of the page */
export const languagePacks = createLanguagePacks();
