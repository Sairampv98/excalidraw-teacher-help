/**
 * The **VS Code dark theme** — the classic "Dark (Visual Studio)" palette.
 *
 * The code panel wears this theme whatever the app's theme is (D-80): the
 * teacher is looking at VS Code while they teach, and the panel has to look
 * like the editor they are looking at — at a glance, from across the room.
 *
 * **These are the colours VS Code PAINTS, not the ones it remembers.**
 *
 * The palette was first written from memory of Dark+, and memory is wrong in
 * the most visible way there is. VS Code paints a keyword **#c586c0**
 * (purple), not #569cd6 (blue): #569cd6 is the colour of the bare TextMate
 * scope `keyword`, and with semantic highlighting on — which is the default —
 * the semantic **keyword** token is what paints the word, and it probes
 * `keyword.control`. So in a real VS Code, `import`, `def`, `return` and
 * `for` are purple.
 *
 * The numbers come from VS Code 1.144.0 (commit 1519239):
 *
 * - `extensions/theme-defaults/themes/dark_plus.json` — the **semantic**
 *   token colours (`semanticTokenColors`) and the editor's chrome
 *   (`colors`). Dark+ and Dark Modern share the SAME token palette; they
 *   differ only in the chrome around it.
 * - `extensions/theme-defaults/themes/dark_vs.json` — the TextMate scopes,
 *   for the tokens semantic highlighting does not cover (`tag`, `storage`).
 * - `src/vs/editor/browser/viewParts/currentLineHighlight/` — the current
 *   line is a **border**, not a band: neither Dark+ nor Dark Modern defines
 *   `editor.lineHighlightBackground`, so VS Code draws
 *   `border: 2px solid <editor.lineHighlightBorder>` instead of a tinted
 *   band.
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
  /** the gutter's background — the gutter is the editor's background */
  gutterBackground: "#1e1e1e",
  /** the line numbers */
  gutterForeground: "#858585",
  /** the number of the line the caret is on */
  activeLineGutterForeground: "#c6c6c6",
  /** the current line is a BORDER — 2px, solid — and not a tinted band */
  activeLineBorder: "#282828",
  /** the caret */
  cursor: "#aeafad",
  /** the selection */
  selection: "#264f78",
  /** the hairline between the panel's regions */
  border: "#3c3c3c",
  /** the active tab's border */
  accent: "#007acc",
  /** a muted label - the language */
  muted: "#858585",
  /** `class`, `import`, `def` ... — the semantic keyword token */
  keyword: "#c586c0",
  /** `if`, `else`, `for`, `while`, `return` ... */
  controlFlow: "#c586c0",
  /** the name of a function */
  function: "#dcdcaa",
  /** a class, a type, a namespace */
  type: "#4ec9b0",
  /** "a string" */
  string: "#ce9178",
  /** `// a comment` */
  comment: "#6a9955",
  /** a variable, a parameter */
  variable: "#9cdcfe",
  /** `42` */
  number: "#b5cea8",
  /** an operator */
  operator: "#d4d4d4",
  /** a regular expression */
  regexp: "#646695",
  /** a constant, an enum member */
  constant: "#4fc1ff",
  /** a tag */
  tag: "#569cd6",
  /** the storage and type keywords — `class`, `def`, `function` */
  storage: "#569cd6",
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
  type: VS_CODE_DARK.type,
  operator: VS_CODE_DARK.operator,
  regexp: VS_CODE_DARK.regexp,
  constant: VS_CODE_DARK.constant,
  tag: VS_CODE_DARK.tag,
  storage: VS_CODE_DARK.storage,
} as const;
