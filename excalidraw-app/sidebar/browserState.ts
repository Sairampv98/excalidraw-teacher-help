/**
 * The picked root and the directory the user is browsing.
 *
 * The sidebar's panel is re-created whenever it is closed and opened again,
 * and a page switch can re-create it too. A `File` cannot be written to disk,
 * so the picked root lives here — in memory, for as long as the app is open —
 * and the browsing path (`cwd`) lives with it. That is what the pin keeps
 * alive: the place the user was in.
 *
 * The root is kept *whole*, not just the files of the current directory: a
 * `webkitdirectory` pick hands over a flat list whose files carry their
 * relative paths, and without the whole list there is no way to walk back out
 * of a subfolder.
 */

export type BrowserState = {
  /** every file of the picked root, so a subfolder can be browsed */
  root: File[];
  /** the picked root's own name, when the browser gives one */
  rootName: string | null;
  /** the directory being browsed, relative to the root */
  cwd: string[];
};

const empty: BrowserState = { root: [], rootName: null, cwd: [] };

let state: BrowserState = empty;

/** the root and the browsing path, as they are right now */
export const browserState = (): BrowserState => state;

/** a new pick replaces the root and goes back to its top */
export const setBrowserRoot = (root: File[], rootName: string | null) => {
  state = { root, rootName, cwd: [] };
};

/** the browsing path, kept as the user walks into folders and back out */
export const setBrowserCwd = (cwd: string[]) => {
  state = { ...state, cwd };
};

/** forgets the root and the path — used when the panel is reset */
export const resetBrowserState = () => {
  state = empty;
};
