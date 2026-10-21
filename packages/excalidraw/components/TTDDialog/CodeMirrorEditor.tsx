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

import { mermaidLite } from "./mermaid-lang-lite";

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
// The token colours are in the order of the palette: CodeMirror emits the
// rules in the order of the spec and a later rule wins, so the function
// colour comes after the variable colour - a function's name is a variable
// name too.

const vsCodeDarkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: VS_CODE_DARK.background,
      color: VS_CODE_DARK.foreground,
    },
    ".cm-content": { caretColor: "#ffffff" },
    ".cm-cursor": { borderLeftColor: "#ffffff" },
    ".cm-gutters": {
      backgroundColor: VS_CODE_DARK.background,
      color: VS_CODE_DARK.gutterForeground,
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: VS_CODE_DARK.activeLine },
    ".cm-activeLine": { backgroundColor: VS_CODE_DARK.activeLine },
  },
  { dark: true },
);

const vsCodeDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: VS_CODE_DARK_TOKEN_COLORS.keyword },
  { tag: tags.controlKeyword, color: VS_CODE_DARK_TOKEN_COLORS.controlFlow },
  { tag: tags.comment, color: VS_CODE_DARK_TOKEN_COLORS.comment },
  { tag: tags.string, color: VS_CODE_DARK_TOKEN_COLORS.string },
  { tag: tags.number, color: VS_CODE_DARK_TOKEN_COLORS.number },
  { tag: tags.variableName, color: VS_CODE_DARK_TOKEN_COLORS.variable },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: VS_CODE_DARK_TOKEN_COLORS.function,
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
}: CodeMirrorEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onKeyboardSubmitRef = useRef(onKeyboardSubmit);
  const themeCompartmentRef = useRef(new Compartment());
  const errorLineCompartmentRef = useRef(new Compartment());

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
          mermaidLite(),
          drawSelection({ drawRangeCursor: true }),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    if (!readOnly) {
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
    />
  );
};

export default CodeMirrorEditor;
