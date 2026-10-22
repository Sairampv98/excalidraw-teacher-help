/**
 * The **grammars the app owns**.
 *
 * The published library `@excalidraw/excalidraw` must not grow five grammar
 * dependencies - that would add megabytes to every consumer of it. So the
 * library owns a REGISTRY (`registerCodeMirrorLanguage`) and the APP fills it
 * (D-84).
 *
 * Every grammar is a **dynamic import**: it is fetched when a file of that
 * language is actually shown, and not before. A teacher who only ever opens a
 * Python file never downloads the Rust grammar.
 *
 * The library's own **mermaid** grammar is NOT registered here: the library
 * owns it, and the text-to-diagram dialog is the only thing that speaks
 * mermaid.
 */

import { registerCodeMirrorLanguage } from "@excalidraw/excalidraw";

/**
 * The languages the app registers.
 *
 * The ids are VS Code's own language ids - the bridge sends
 * `document.languageId` verbatim - so the registry keys ARE the ids the
 * editor asks for.
 *
 * TypeScript and JSX come free with the JavaScript package, so they are
 * registered too: the owner asked for six languages, and these two cost
 * nothing.
 */
export const CODE_LANGUAGE_IDS = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "java",
  "python",
  "c",
  "cpp",
  "rust",
] as const;

/**
 * Registers the grammars with the library's registry.
 *
 * Calling it twice is harmless: the registry simply holds the newer loader.
 */
export const registerCodeLanguages = () => {
  registerCodeMirrorLanguage("javascript", async () =>
    (await import("@codemirror/lang-javascript")).javascript(),
  );

  // The JavaScript package carries JSX and TypeScript too, and it is the one
  // way to get them: `javascript()` takes the dialect as its configuration.
  registerCodeMirrorLanguage("javascriptreact", async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  );

  registerCodeMirrorLanguage("typescript", async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      typescript: true,
    }),
  );

  registerCodeMirrorLanguage("typescriptreact", async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      jsx: true,
      typescript: true,
    }),
  );

  registerCodeMirrorLanguage("java", async () =>
    (await import("@codemirror/lang-java")).java(),
  );

  registerCodeMirrorLanguage("python", async () =>
    (await import("@codemirror/lang-python")).python(),
  );

  // The C++ package is the only C-family grammar CodeMirror ships, and C is
  // a subset of C++: the same grammar reads a `.c` file, with its keywords,
  // types and comments painted the way C is painted.
  registerCodeMirrorLanguage("c", async () =>
    (await import("@codemirror/lang-cpp")).cpp(),
  );

  registerCodeMirrorLanguage("cpp", async () =>
    (await import("@codemirror/lang-cpp")).cpp(),
  );

  registerCodeMirrorLanguage("rust", async () =>
    (await import("@codemirror/lang-rust")).rust(),
  );
};

// the module registers the languages when it is imported, so the app's entry
// point only has to import it
registerCodeLanguages();
