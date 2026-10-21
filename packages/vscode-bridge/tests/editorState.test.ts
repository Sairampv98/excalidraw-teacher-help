import { describe, expect, it } from "vitest";

import {
  editorContentMessage,
  editorToMirror,
  type EditorLike,
} from "../extension/src/editorState";

/**
 * The extension's rule for what it tells the panel about the editor.
 *
 * The important part is the **empty** case: when no file is open, the
 * extension still sends a message, and the message says so with an empty uri.
 * A message that is not sent is a message the panel cannot explain - the
 * teacher would see a panel that is connected and empty (D-75).
 */
describe("the extension's editor state", () => {
  it("AC-86 with no file open the extension says so instead of saying nothing", () => {
    const message = editorContentMessage(undefined);

    expect(message.type).toBe("editor:content");
    expect(message.uri).toBe("");
    expect(message.text).toBe("");
    expect(message.language).toBe("");
    expect(message.version).toBe(0);
    // no selection: there is no editor to have one
    expect(message.selection).toBeUndefined();
  });

  it("AC-86 the active editor's text, language and selection are published", () => {
    const message = editorContentMessage({
      document: {
        uri: { toString: () => "file:///c:/work/main.py" },
        languageId: "python",
        getText: () => "print('hi')\n",
        version: 7,
        offsetAt: (position: unknown) => (position === "start" ? 0 : 11),
      },
      selection: { start: "start", end: "end" },
    });

    expect(message.uri).toBe("file:///c:/work/main.py");
    expect(message.language).toBe("python");
    expect(message.text).toBe("print('hi')\n");
    expect(message.version).toBe(7);
    expect(message.selection).toEqual({ start: 0, end: 11 });
  });
});

/**
 * Which editor the panel mirrors.
 *
 * The teacher is teaching from a file. The focus moves to the terminal, to
 * the explorer, to the extensions view - and the file is still open, still
 * what the panel should show. Publishing the empty state in that moment
 * **erases the mirror**, and the code the panel was showing vanishes for a
 * reason nobody can see (D-78).
 */
describe("which editor the panel mirrors", () => {
  const editor = (name: string): EditorLike => ({
    document: {
      uri: { toString: () => `file:///c:/work/${name}` },
      languageId: "java",
      getText: () => `// ${name}`,
      version: 1,
      offsetAt: () => 0,
    },
    selection: { start: 0, end: 0 },
  });

  it("AC-90 the mirror keeps the last editor when the focus moves away from it", () => {
    const last = editor("Program2.java");

    // the focus moved to a terminal: there is no active text editor, but the
    // document is still open
    const mirrored = editorToMirror(last, undefined, () => true);

    expect(mirrored).toBe(last);
  });

  it("AC-90 the mirror follows the active editor when there is one", () => {
    const last = editor("Program2.java");
    const active = editor("Other.java");

    expect(editorToMirror(last, active, () => true)).toBe(active);
  });

  it("AC-91 the mirror is cleared when the file is closed", () => {
    const last = editor("Program2.java");

    // no active editor AND the document is gone: the file was closed
    expect(editorToMirror(last, undefined, () => false)).toBeUndefined();
  });

  it("AC-91 with no editor at all there is nothing to mirror", () => {
    expect(editorToMirror(undefined, undefined, () => true)).toBeUndefined();
  });

  it("AC-96 the active tab is mirrored even when the editor has no focus", () => {
    const last = editor("Old.java");
    const tabDocument = editor("Program2.java").document;

    // The teacher is in the BROWSER, showing the canvas: the window lost the
    // focus, so there is no active editor - but the tab is still the file
    // they are teaching from, and that is what the panel must show.
    const mirrored = editorToMirror(last, undefined, () => true, tabDocument);

    expect(mirrored).toBeDefined();
    expect(mirrored!.document).toBe(tabDocument);
    expect(mirrored!.document.getText()).toContain("Program2.java");
  });

  it("AC-96 the active tab wins over the remembered editor", () => {
    const last = editor("Old.java");
    const tabDocument = editor("Program2.java").document;

    const mirrored = editorToMirror(last, undefined, () => true, tabDocument);

    expect(mirrored!.document).toBe(tabDocument);
  });

  it("AC-96 with no editor and no tab the last editor is still mirrored", () => {
    const last = editor("Program2.java");

    const mirrored = editorToMirror(last, undefined, () => true, undefined);

    expect(mirrored).toBe(last);
  });
});
