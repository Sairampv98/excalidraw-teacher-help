import { describe, expect, it } from "vitest";

import { editorContentMessage } from "../extension/src/editorState";

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
