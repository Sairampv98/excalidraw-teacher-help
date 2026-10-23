import { useEffect, useRef } from "react";
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  drawSelection,
} from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
} from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

import type { Theme } from "@excalidraw/element/types";

import { VS_CODE_DARK, VS_CODE_DARK_TOKEN_COLORS } from "../vscodeTheme";

import { loadCodeMirrorLanguage } from "../codeLanguages";

// The library owns the mermaid grammar, and importing it registers it.
import "./mermaid-lang-lite";

/**
 * The theme an editor wears.
 *
 * `"vscode"` is the **VS Code dark theme** whatever the app's theme is: the
 * code panel is a mirror of the teacher's VS Code editor, so it has to look
 * like the editor they are looking at (D-80).
 */
export type CodeMirrorTheme = Theme | "vscode";

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyboardSubmit?: () => void;
  placeholder?: string;
  theme: CodeMirrorTheme;
  errorLine?: number | null;
  /**
   * A **mirror** shows somebody else's text: it must not be edited, and it
   * must not take the keyboard away from the canvas — a live panel that
   * swallows every keystroke would make the editor unusable while the panel
   * is on the screen.
   */
  readOnly?: boolean;
  /**
   * Whether the editor takes the focus when it mounts.
   *
   * A **dialog** wants it: the teacher opened the dialog to type. A **panel**
   * does not: a panel appears on the canvas, and taking the focus would take
   * the teacher's keystrokes away from the canvas they are drawing on. The
   * teacher clicks into the editor when they want to type (D-123).
   */
  focusOnMount?: boolean;
  /**
   * The `data-testid` of the editor's own host.
   *
   * CodeMirror builds its DOM itself, so a test that wants to find the
   * editable surface has to be given a handle - the class names are
   * CodeMirror's, not the library's (D-123).
   */
  testId?: string;
  /**
   * The language of the text, as VS Code names it (`python`, `java`,
   * `javascript`, `cpp`, ...).
   *
   * The grammar comes from the **registry** (`../codeLanguages`), which the
   * HOST fills - the library has no grammar dependencies of its own. A
   * language that is not registered gets **no** grammar: an unknown file must
   * never be highlighted as something it is not.
   *
   * `"mermaid"` is the library's own: the text-to-diagram dialog is the only
   * thing that speaks mermaid.
   */
  language?: string;
}

// ---- Dark theme ----

const darkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#1e1e1e",
      color: "#d4d4d4",
    },
    ".cm-content": { caretColor: "#fff" },
    ".cm-cursor": { borderLeftColor: "#fff" },
    ".cm-gutters": {
      backgroundColor: "#1e1e1e",
      color: "#858585",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "#2a2a2a" },
    ".cm-activeLine": { backgroundColor: "#2a2a2a" },
    ".cm-errorLine": { backgroundColor: "rgba(255, 0, 0, 0.15)" },
  },
  { dark: true },
);

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#569cd6" },
  { tag: tags.string, color: "#ce9178" },
  { tag: tags.comment, color: "#6a9955" },
  { tag: tags.number, color: "#b5cea8" },
  { tag: tags.operator, color: "#d4d4d4" },
  { tag: tags.punctuation, color: "#d4d4d4" },
  { tag: tags.variableName, color: "#9cdcfe" },
  { tag: tags.bracket, color: "#ffd700" },
]);

// ---- The VS Code dark theme ----
//
// The code panel is a mirror of the teacher's VS Code editor, so it has to
// look like the editor they are looking at - whatever the app's theme is
// (D-80). The colours are the VS Code palette's, and they live in one place
// (`../vscodeTheme`), which is plain data and pulls nothing in: the editor is
// a heavy module and the panel loads it lazily.
//
// The palette is the one VS Code PAINTS, which is the semantic token palette
// and not the TextMate one - see `../vscodeTheme` for the sources.

const vsCodeDarkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: VS_CODE_DARK.background,
      color: VS_CODE_DARK.foreground,
    },
    ".cm-content": { caretColor: VS_CODE_DARK.cursor },
    ".cm-cursor": { borderLeftColor: VS_CODE_DARK.cursor },
    ".cm-gutters": {
      backgroundColor: VS_CODE_DARK.gutterBackground,
      color: VS_CODE_DARK.gutterForeground,
      border: "none",
    },
    // The current line is a BORDER, the way VS Code draws it: neither Dark+
    // nor Dark Modern defines `editor.lineHighlightBackground`, so VS Code
    // outlines the line - `border: 2px solid <editor.lineHighlightBorder>` -
    // instead of tinting it. `box-sizing: border-box` keeps the border from
    // moving the text, as it does in VS Code.
    ".cm-activeLine": {
      backgroundColor: "transparent",
      border: `2px solid ${VS_CODE_DARK.activeLineBorder}`,
      boxSizing: "border-box",
    },
    ".cm-activeLineGutter": {
      color: VS_CODE_DARK.activeLineGutterForeground,
      backgroundColor: "transparent",
      border: `2px solid ${VS_CODE_DARK.activeLineBorder}`,
      boxSizing: "border-box",
    },
    ".cm-selectionBackground": { backgroundColor: VS_CODE_DARK.selection },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor: VS_CODE_DARK.selection,
      },
  },
  { dark: true },
);

// The token colours VS Code PAINTS, which are its SEMANTIC token colours:
// semantic highlighting is on by default, and the semantic keyword token
// probes `keyword.control` - so `import`, `def`, `return` and `for` are
// purple (#c586c0), not the blue (#569cd6) of the bare TextMate scope.
//
// The order matters: CodeMirror emits the rules in the order of the spec and
// a later rule wins, so the function colour comes after the variable colour
// (a function's name is a variable name too), and the constant colour comes
// after the variable colour as well.
const vsCodeDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: VS_CODE_DARK_TOKEN_COLORS.keyword },
  { tag: tags.controlKeyword, color: VS_CODE_DARK_TOKEN_COLORS.controlFlow },
  { tag: tags.comment, color: VS_CODE_DARK_TOKEN_COLORS.comment },
  { tag: tags.string, color: VS_CODE_DARK_TOKEN_COLORS.string },
  { tag: tags.number, color: VS_CODE_DARK_TOKEN_COLORS.number },
  { tag: tags.operator, color: VS_CODE_DARK_TOKEN_COLORS.operator },
  { tag: tags.regexp, color: VS_CODE_DARK_TOKEN_COLORS.regexp },
  { tag: tags.variableName, color: VS_CODE_DARK_TOKEN_COLORS.variable },
  { tag: tags.propertyName, color: VS_CODE_DARK_TOKEN_COLORS.variable },
  {
    tag: tags.constant(tags.variableName),
    color: VS_CODE_DARK_TOKEN_COLORS.constant,
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: VS_CODE_DARK_TOKEN_COLORS.function,
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: VS_CODE_DARK_TOKEN_COLORS.type,
  },
  { tag: tags.tagName, color: VS_CODE_DARK_TOKEN_COLORS.tag },
  // `def`, `class`, `import` ... - VS Code's semantic highlighting paints
  // these as KEYWORDS, so they are purple like every other keyword.
  {
    tag: [tags.definitionKeyword, tags.moduleKeyword],
    color: VS_CODE_DARK_TOKEN_COLORS.keyword,
  },
]);

const vsCodeDarkExtensions = [
  vsCodeDarkTheme,
  syntaxHighlighting(vsCodeDarkHighlight),
];

// ---- Light theme ----

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#1e1e1e",
  },
  ".cm-content": { caretColor: "#000" },
  ".cm-cursor": { borderLeftColor: "#000" },
  ".cm-gutters": {
    backgroundColor: "#fff",
    color: "#999",
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: "#e8e8e8" },
  ".cm-activeLine": { backgroundColor: "#e8e8e8" },
  ".cm-errorLine": { backgroundColor: "rgba(255, 0, 0, 0.1)" },
});

const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#0000ff" },
  { tag: tags.string, color: "#a31515" },
  { tag: tags.comment, color: "#008000" },
  { tag: tags.number, color: "#098658" },
  { tag: tags.operator, color: "#1e1e1e" },
  { tag: tags.punctuation, color: "#1e1e1e" },
  { tag: tags.variableName, color: "#001080" },
  { tag: tags.bracket, color: "#af00db" },
]);

// ---- Error line decoration ----

const errorLineDeco = Decoration.line({ class: "cm-errorLine" });

const getErrorLineExtension = (
  errorLine: number | null | undefined,
  doc: { line(n: number): { from: number }; lines: number },
): Extension => {
  if (!errorLine || errorLine < 1 || errorLine > doc.lines) {
    return EditorView.decorations.of(Decoration.none);
  }
  const line = doc.line(errorLine);
  return EditorView.decorations.of(
    Decoration.set([errorLineDeco.range(line.from)]),
  );
};

// ---- Helpers ----

const getThemeExtensions = (theme: CodeMirrorTheme) => {
  if (theme === "vscode") {
    return vsCodeDarkExtensions;
  }
  if (theme === "dark") {
    return [darkTheme, syntaxHighlighting(darkHighlight)];
  }
  return [lightTheme, syntaxHighlighting(lightHighlight)];
};

const CodeMirrorEditor = ({
  value,
  onChange,
  onKeyboardSubmit,
  placeholder,
  theme,
  errorLine,
  readOnly = false,
  language,
  testId,
  focusOnMount = true,
}: CodeMirrorEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onKeyboardSubmitRef = useRef(onKeyboardSubmit);
  const themeCompartmentRef = useRef(new Compartment());
  const errorLineCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());

  onChangeRef.current = onChange;
  onKeyboardSubmitRef.current = onKeyboardSubmit;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const themeCompartment = themeCompartmentRef.current;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onKeyboardSubmitRef.current?.();
                return true;
              },
            },
            // historyKeymap binds Mod-Shift-z only on Mac; add it for all platforms
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lineNumbers(),
          EditorView.lineWrapping,
          // a mirror is read-only: the text belongs to the editor it mirrors
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          themeCompartment.of(getThemeExtensions(theme)),
          errorLineCompartmentRef.current.of([]),
          // the grammar lives in its own compartment: it is fetched
          // asynchronously, and it is swapped when the file changes
          languageCompartmentRef.current.of([]),
          drawSelection({ drawRangeCursor: true }),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    if (!readOnly && focusOnMount) {
      // a read-only mirror must not steal the keyboard from the canvas
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap theme dynamically via compartment
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        getThemeExtensions(theme),
      ),
    });
  }, [theme]);

  // Update error line highlight
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: errorLineCompartmentRef.current.reconfigure(
        getErrorLineExtension(errorLine, view.state.doc),
      ),
    });
  }, [errorLine]);

  /**
   * The grammar of the file.
   *
   * The grammar is fetched from the **registry** the host filled, so it is
   * asynchronous. Until it arrives the PREVIOUS grammar stays: there is no
   * flash of unhighlighted text, and the file is never highlighted as
   * something it is not.
   *
   * A language that is not registered - or no language at all - resolves to no
   * grammar, and the grammar is REMOVED.
   */
  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    let cancelled = false;

    loadCodeMirrorLanguage(language ?? "").then((extension) => {
      if (cancelled) {
        return;
      }

      view.dispatch({
        effects: languageCompartmentRef.current.reconfigure(
          extension ? [extension] : [],
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Sync external value changes into EditorView
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="ttd-dialog-input ttd-dialog-input--codemirror"
      data-testid={testId}
    />
  );
};

export default CodeMirrorEditor;
