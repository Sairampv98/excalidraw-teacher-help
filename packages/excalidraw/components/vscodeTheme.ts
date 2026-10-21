/**
 * The **VS Code dark theme** — the classic "Dark (Visual Studio)" palette.
 *
 * The code panel wears this theme whatever the app's theme is (D-80): the
 * teacher is looking at VS Code while they teach, and the panel has to look
 * like the editor they are looking at — at a glance, from across the room.
 *
 * The palette is **plain data** on purpose, and it has **no imports**:
 *
 * - it is the one place these colours are written down, and the panel's own
 *   surface, its tab strip and the editor all read it from here;
 * - the editor is a **heavy** module and the code panel loads it lazily, so
 *   nothing that the canvas loads eagerly may pull CodeMirror in with it.
 *   The editor's own theme is built from this palette, in the editor's own
 *   module (`TTDDialog/CodeMirrorEditor.tsx`).
 */
export const VS_CODE_DARK = {
  /** the editor's background */
  background: "#1e1e1e",
  /** the default text */
  foreground: "#d4d4d4",
  /** the line numbers */
  gutterForeground: "#858585",
  /** the line the caret is on */
  activeLine: "#2a2a2a",
  /** the hairline between the panel's regions */
  border: "#3c3c3c",
  /** the active tab's border */
  accent: "#007acc",
  /** a muted label - the language */
  muted: "#858585",
  /** `class`, `import`, `def` ... */
  keyword: "#569cd6",
  /** `if`, `else`, `for`, `while`, `return` ... */
  controlFlow: "#c586c0",
  /** the name of a function */
  function: "#dcdcaa",
  /** "a string" */
  string: "#ce9178",
  /** `// a comment` */
  comment: "#6a9955",
  /** a variable */
  variable: "#9cdcfe",
  /** `42` */
  number: "#b5cea8",
} as const;

/**
 * The token colours, as plain data.
 *
 * The **order** matters when they are handed to the editor: CodeMirror emits
 * the rules in the order of the spec, and a later rule wins. The function
 * colour therefore comes **after** the variable colour - a function's name is
 * a variable name too, and the function colour is the one the teacher expects
 * to see.
 */
export const VS_CODE_DARK_TOKEN_COLORS = {
  keyword: VS_CODE_DARK.keyword,
  controlFlow: VS_CODE_DARK.controlFlow,
  comment: VS_CODE_DARK.comment,
  string: VS_CODE_DARK.string,
  number: VS_CODE_DARK.number,
  variable: VS_CODE_DARK.variable,
  function: VS_CODE_DARK.function,
} as const;
