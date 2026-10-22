/**
 * The **language registry**: the library's own way of reaching a grammar.
 *
 * The published package `@excalidraw/excalidraw` must not grow five grammar
 * dependencies - that would add megabytes to every consumer of the library.
 * So the library owns a REGISTRY and the HOST fills it: the app registers the
 * grammars it has, and the editor asks the registry for the grammar of the
 * file it is showing.
 *
 * The registry is deliberately empty of grammars it does not own. The one
 * grammar the library has itself is the **mermaid** one
 * (`./TTDDialog/mermaid-lang-lite`), which the text-to-diagram dialog needs and
 * which the library registers itself.
 *
 * A language that is not registered resolves to **no grammar at all** (plain
 * text). That is correct: an unknown language must never be highlighted as
 * something it is not.
 */

import type { Extension } from "@codemirror/state";

/**
 * How a grammar is fetched.
 *
 * It is **asynchronous** on purpose: the host registers a DYNAMIC import, so
 * a grammar is only downloaded when a file of that language is actually shown.
 */
export type CodeMirrorLanguageLoader = () => Promise<Extension>;

/** The registered grammars, by language id. */
const registry = new Map<string, CodeMirrorLanguageLoader>();

/** The id a language is registered under. */
const languageKey = (id: string) => id.trim().toLowerCase();

/**
 * Registers the grammar of a language.
 *
 * The id is the one VS Code sends (`document.languageId`): `python`, `java`,
 * `javascript`, `cpp`, `c`, `rust`, `typescript`, ...
 */
export const registerCodeMirrorLanguage = (
  id: string,
  load: CodeMirrorLanguageLoader,
): void => {
  const key = languageKey(id);

  if (!key) {
    return;
  }

  registry.set(key, load);
};

/**
 * The grammar of a language, or null when the language is not registered.
 *
 * A loader that FAILS resolves to null as well: a broken grammar must not
 * take the editor down with it, and the text is still worth showing.
 */
export const loadCodeMirrorLanguage = async (
  id: string,
): Promise<Extension | null> => {
  const load = registry.get(languageKey(id));

  if (!load) {
    return null;
  }

  try {
    return (await load()) ?? null;
  } catch {
    return null;
  }
};

/** The ids of the registered languages. */
export const codeMirrorLanguageIds = (): string[] => [...registry.keys()];
