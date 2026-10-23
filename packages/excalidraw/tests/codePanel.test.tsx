/**
 * The **code panel**: the mirrored editor, the program's output, the bridge's
 * own messages, and the bridge field in the panel's chrome.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import React from "react";

import { EditorView } from "@codemirror/view";
import { render as renderComponent } from "@testing-library/react";

import type {
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { VS_CODE_DARK } from "../components/vscodeTheme";
import { TTDDialogInput } from "../components/TTDDialog/TTDDialogInput";
import { UIAppStateContext } from "../context/ui-appState";
import { getDefaultAppState } from "../appState";
import {
  codePanelContent,
  emptyCodePanelState,
  readCodePanelState,
  readPanelView,
  withCodePanelState,
  withPanelDraft,
  withPanelView,
} from "../scene/panelContent";
import {
  clearAllPanelCaptures,
  getPanelCapture,
  setPanelCapture,
} from "../scene/panelFrames";
import {
  loadCodeMirrorLanguage,
  registerCodeMirrorLanguage,
} from "../components/codeLanguages";
import { mermaidLite } from "../components/TTDDialog/mermaid-lang-lite";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { CodePanelState } from "../scene/panelContent";

/** A code panel that is connected and has something to show. */
const connectedState = (): CodePanelState => ({
  ...emptyCodePanelState(),
  connection: "connected",
  statusMessage: "Connected to the Excalidraw Bridge.",
  editor: {
    uri: "file:///demo/main.py",
    language: "python",
    text: "print('hello')",
    selection: { start: 0, end: 0 },
    version: 3,
  },
  output: [{ stream: "stdout", text: "hello" }],
  console: [{ level: "info", text: "Run started: python main.py" }],
});

const codePanel = (
  state: CodePanelState,
  overrides: Partial<Record<string, unknown>> = {},
): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(state, "session-1"),
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

/**
 * A code panel in a given **view** (D-83).
 *
 * The view is the panel's own property and it lives in its payload, so a
 * panel that is born in the live view is built by widening the payload.
 */
const codePanelInView = (
  state: CodePanelState,
  view: "editor" | "live",
): ExcalidrawPanelElement =>
  codePanel(state, {
    panel: withPanelView(codePanelContent(state, "session-1"), view),
  });

/**
 * The UI app state, for a component that is rendered on its own.
 *
 * The text-to-diagram dialog reads the theme from it, and the dialog is
 * normally rendered by the app's own layer.
 */
const uiAppState = () => ({
  ...getDefaultAppState(),
  offsetTop: 0,
  offsetLeft: 0,
  width: 1000,
  height: 1000,
});

/** The CSS CodeMirror has mounted into the document. */
const mountedCss = () =>
  Array.from(document.querySelectorAll("style"))
    .map((tag) => tag.textContent)
    .join("\n");

/**
 * The colour CodeMirror paints a word in, or null when the word is not
 * painted at all.
 *
 * CodeMirror marks a token with a class, and the class carries the colour in
 * the stylesheet it mounts. So the word's colour is found by looking the
 * class up - the test never has to know which class a token happens to get.
 */
const tokenColour = (word: string): string | null => {
  const content = document.querySelector(
    '[data-testid="code-panel-source"] .cm-content',
  );

  if (!content) {
    return null;
  }

  const span = Array.from(content.querySelectorAll("span")).find(
    (candidate) => candidate.textContent === word,
  );

  if (!span) {
    return null;
  }

  const css = mountedCss();

  for (const className of Array.from(span.classList)) {
    const rule = new RegExp(
      `\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ).exec(css);

    if (rule) {
      return rule[1];
    }
  }

  return null;
};

describe("the code panel", () => {
  it("AC-60 the panel shows the editor, the output and the console", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    expect(overlay).not.toBeNull();

    // the three regions, in the order the teacher reads them
    expect(
      overlay!.querySelector('[data-testid="code-panel-editor"]'),
    ).not.toBeNull();
    expect(
      overlay!.querySelector('[data-testid="code-panel-output"]')!.textContent,
    ).toContain("hello");
    expect(
      overlay!.querySelector('[data-testid="code-panel-console"]')!.textContent,
    ).toContain("Run started");
  });

  it("AC-61 with no bridge the panel shows the reconnect state, not a blank editor", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(emptyCodePanelState()))]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    // the state is shown ...
    const status = overlay!.querySelector('[data-testid="code-panel-status"]');

    expect(status).not.toBeNull();
    expect(status!.getAttribute("data-bridge-state")).toBe("not-connected");
    expect(status!.textContent).not.toBe("");

    // ... and there is **no** blank editor behind it
    expect(
      overlay!.querySelector('[data-testid="code-panel-editor"]'),
    ).toBeNull();
  });

  it("AC-84 a connected panel with no editor shows what it knows, not a blank region", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });

    // connected, but the extension has not sent an editor: no file is open
    API.setElements([
      asElement(
        codePanel({
          ...emptyCodePanelState(),
          connection: "connected",
          statusMessage: "Connected to the Excalidraw Bridge.",
        }),
      ),
    ]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    expect(overlay).not.toBeNull();

    // the region is there ...
    expect(
      overlay!.querySelector('[data-testid="code-panel-editor"]'),
    ).not.toBeNull();

    // ... and it SAYS that no file is open, instead of being blank. A blank
    // region looks like a broken panel, and the teacher cannot tell it apart
    // from a program that produced nothing (D-52).
    const noEditor = overlay!.querySelector(
      '[data-testid="code-panel-no-editor"]',
    );

    expect(noEditor).not.toBeNull();
    expect(noEditor!.textContent).not.toBe("");
    expect(noEditor!.textContent).toContain("No file is open");
  });

  it("AC-130 the code panel's source region is never blank", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });

    // The bridge is not connected. The panel says WHY it has nothing to show,
    // and it never renders an empty editor - a blank editor is a black box
    // with no explanation, which is exactly what the owner saw on 2026-10-22
    // (D-93).
    API.setElements([asElement(codePanel(emptyCodePanelState()))]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-status"]'),
      ).not.toBeNull(),
    );

    const status = document.querySelector('[data-testid="code-panel-status"]')!;

    expect(status.textContent).not.toBe("");
    expect(status.textContent).toContain("Not connected");

    // and there is no empty editor pretending to be the source
    expect(
      document.querySelector('[data-testid="code-panel-editor"]'),
    ).toBeNull();

    // The bridge is connected and a file IS open, but the file has no content.
    // The source region says that, instead of showing an empty editor.
    const state = connectedState();

    API.setElements([
      asElement(
        codePanel({
          ...state,
          editor: { ...state.editor, text: "" },
        }),
      ),
    ]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-empty-file"]'),
      ).not.toBeNull(),
    );

    const source = document.querySelector('[data-testid="code-panel-source"]')!;

    expect(source.textContent).toContain("This file is empty.");
    expect(source.querySelector(".cm-editor")).toBeNull();
  });

  it("AC-82 the panel chrome shows the three connection states", async () => {
    const onPasteToken = vi.fn();

    const bridge = (status: "not-connected" | "connected" | "rejected") => ({
      status,
      message: `state: ${status}`,
      token: "",
      onPasteToken,
    });

    // one mount, three props: the editor is heavy, and the gate runs the whole
    // suite on this machine
    const { rerender } = await render(
      <Excalidraw panelBridge={bridge("not-connected")} />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const panel = codePanel(connectedState());

    API.setElements([asElement(panel)]);
    API.setSelectedElements([asElement(panel)]);

    for (const status of ["not-connected", "connected", "rejected"] as const) {
      rerender(<Excalidraw panelBridge={bridge(status)} />);

      const field = document.querySelector('[data-testid="panel-bridge"]');

      expect(field).not.toBeNull();
      expect(field!.getAttribute("data-bridge-state")).toBe(status);
      expect(
        document.querySelector('[data-testid="panel-bridge-state"]')!
          .textContent,
      ).toBe(`state: ${status}`);
    }
  });

  it("AC-80 the paste button asks the host for the token, and the token is masked", async () => {
    const onPasteToken = vi.fn();

    await render(
      <Excalidraw
        panelBridge={{
          status: "not-connected",
          message: "Not connected to the Excalidraw Bridge.",
          token: "a-token-the-teacher-pasted",
          onPasteToken,
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const panel = codePanel(connectedState());

    API.setElements([asElement(panel)]);
    API.setSelectedElements([asElement(panel)]);

    const input = document.querySelector(
      '[data-testid="panel-bridge-token"]',
    ) as HTMLInputElement;

    expect(input).not.toBeNull();
    // a secret is not shown on the screen
    expect(input.getAttribute("type")).toBe("password");

    document
      .querySelector('[data-testid="panel-bridge-paste"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onPasteToken).toHaveBeenCalledTimes(1);
  });

  it("AC-81 the panel's payload carries the live state, and not the token", async () => {
    const state = connectedState();

    const panel = codePanel(state);

    // the live state rides inside the payload (D-46) ...
    expect(readCodePanelState(panel.panel)).toEqual(state);

    // ... and it is plain data: it survives a structured clone
    const cloned = structuredClone(panel.panel);

    expect(readCodePanelState(cloned)).toEqual(state);
  });

  it("AC-92 the panel's editor region names the file it is mirroring, and says so when there is none", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    // the tab strip is IN the editor region ...
    const editor = overlay!.querySelector('[data-testid="code-panel-editor"]')!;
    const header = editor.querySelector('[data-testid="code-panel-header"]');

    expect(header).not.toBeNull();

    // ... and it says WHICH file this is, the way a VS Code tab says it: the
    // file's name and its language. Code with no name reads as a text box
    // (D-80).
    expect(
      header!.querySelector('[data-testid="code-panel-file"]')!.textContent,
    ).toBe("main.py");
    expect(
      header!.querySelector('[data-testid="code-panel-language"]')!.textContent,
    ).toBe("python");

    // with no file open, the header SAYS so - with the wording the panel
    // already uses for that case
    API.setElements([
      asElement(
        codePanel({
          ...emptyCodePanelState(),
          connection: "connected",
          statusMessage: "Connected to the Excalidraw Bridge.",
        }),
      ),
    ]);

    const emptyHeader = document.querySelector(
      '[data-testid="code-panel-header"]',
    )!;

    expect(emptyHeader.textContent).toContain("No file is open");
  });

  it("AC-93 the mirrored code is rendered in the VS Code dark theme, with its line numbers", async () => {
    // the app is in its LIGHT theme: the panel wears the VS Code dark theme
    // whatever the app's theme is (D-80) - the teacher is looking at VS Code
    // while they teach
    await render(<Excalidraw theme="light" />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    // the editor is loaded lazily, the way the TTD dialog loads it
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // CodeMirror mounts its theme into the document
    const css = mountedCss();

    // the VS Code dark theme: the background, the text and the gutter
    expect(css).toContain("background-color: #1e1e1e");
    expect(css).toContain("color: #d4d4d4");

    // the VS Code token colours
    expect(css).toContain("#c586c0"); // keywords and control flow
    expect(css).toContain("#dcdcaa"); // functions
    expect(css).toContain("#ce9178"); // strings
    expect(css).toContain("#6a9955"); // comments
    expect(css).toContain("#9cdcfe"); // variables
    expect(css).toContain("#569cd6"); // tags

    // and NOT the app's light theme
    expect(css).not.toContain("#0000ff"); // the light theme's keyword colour

    // the line numbers are there
    expect(
      document.querySelector(
        '[data-testid="code-panel-source"] .cm-lineNumbers',
      ),
    ).not.toBeNull();
  });

  it("AC-94 the code region keeps its height: the chrome, the output and the console do not squeeze the code out of the panel", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]')!;

    const editor = overlay.querySelector(
      '[data-testid="code-panel-editor"]',
    ) as HTMLElement;
    const output = overlay.querySelector(
      '[data-testid="code-panel-output"]',
    ) as HTMLElement;
    const consoleRegion = overlay.querySelector(
      '[data-testid="code-panel-console"]',
    ) as HTMLElement;

    // the code region has a FLOOR: the chrome, the output and the console
    // cannot squeeze it out of the panel
    expect(editor.style.minHeight).toBe("120px");
    expect(editor.style.flex).toBe("1 1 auto");

    // and the output and the console shrink instead of the code - they scroll
    expect(output.style.flex).toBe("0 1 auto");
    expect(consoleRegion.style.flex).toBe("0 1 auto");
  });

  it("AC-98 the panel paints the VS Code token colours", async () => {
    // The palette is the ONE place the colours are written down, and these
    // are the colours VS Code PAINTS: the SEMANTIC token colours, because
    // semantic highlighting is on (D-81). A keyword is purple - #c586c0 -
    // and not the blue (#569cd6) of the bare TextMate scope, which the
    // semantic keyword token does not even probe.
    expect(VS_CODE_DARK.keyword).toBe("#c586c0");
    expect(VS_CODE_DARK.controlFlow).toBe("#c586c0");
    expect(VS_CODE_DARK.comment).toBe("#6a9955");
    expect(VS_CODE_DARK.string).toBe("#ce9178");
    expect(VS_CODE_DARK.function).toBe("#dcdcaa");
    expect(VS_CODE_DARK.type).toBe("#4ec9b0");
    expect(VS_CODE_DARK.variable).toBe("#9cdcfe");
    expect(VS_CODE_DARK.number).toBe("#b5cea8");
    expect(VS_CODE_DARK.operator).toBe("#d4d4d4");
    expect(VS_CODE_DARK.regexp).toBe("#646695");
    expect(VS_CODE_DARK.constant).toBe("#4fc1ff");
    expect(VS_CODE_DARK.tag).toBe("#569cd6");
    expect(VS_CODE_DARK.storage).toBe("#569cd6");

    // and the chrome VS Code paints around the text
    expect(VS_CODE_DARK.background).toBe("#1e1e1e");
    expect(VS_CODE_DARK.foreground).toBe("#d4d4d4");
    expect(VS_CODE_DARK.gutterBackground).toBe("#1e1e1e");
    expect(VS_CODE_DARK.gutterForeground).toBe("#858585");
    expect(VS_CODE_DARK.activeLineGutterForeground).toBe("#c6c6c6");
    expect(VS_CODE_DARK.activeLineBorder).toBe("#282828");
    expect(VS_CODE_DARK.cursor).toBe("#aeafad");
    expect(VS_CODE_DARK.selection).toBe("#264f78");

    // the panel's editor wears them - the app's own theme is light here, and
    // the panel is dark whatever the app's theme is (D-80)
    await render(<Excalidraw theme="light" />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    const css = mountedCss();

    // the chrome: #1e1e1e on #d4d4d4
    expect(css).toContain("background-color: #1e1e1e");
    expect(css).toContain("color: #d4d4d4");

    // the token colours
    expect(css).toContain("color: #c586c0"); // the keyword and the control flow
    expect(css).toContain("color: #6a9955"); // the comment
    expect(css).toContain("color: #ce9178"); // the string
    expect(css).toContain("color: #dcdcaa"); // the function
    expect(css).toContain("color: #4ec9b0"); // the type
    expect(css).toContain("color: #9cdcfe"); // the variable
    expect(css).toContain("color: #b5cea8"); // the number
    expect(css).toContain("color: #646695"); // the regular expression
    expect(css).toContain("color: #4fc1ff"); // the constant
    expect(css).toContain("color: #569cd6"); // the tag
  });

  it("AC-99 the current line is drawn as a border, the way VS Code draws it, and not as a tinted band", async () => {
    await render(<Excalidraw theme="light" />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    const css = mountedCss();

    // The panel's own rule is the LAST `.cm-activeLine` rule in the sheet:
    // CodeMirror mounts its base theme first and the user's theme after it,
    // and a later rule of the same specificity wins. (CodeMirror's base
    // theme tints the line - #99eeff33 in dark mode - and the panel's rule
    // overrides it.)
    const activeLineRules = Array.from(
      css.matchAll(/\.cm-activeLine\s*\{([^}]*)\}/g),
    ).map((match) => match[1]);

    expect(activeLineRules.length).toBeGreaterThan(0);

    const panelRule = activeLineRules[activeLineRules.length - 1];

    // VS Code draws the current line as an OUTLINE: neither Dark+ nor Dark
    // Modern defines `editor.lineHighlightBackground`, so the editor
    // highlights the line with `border: 2px solid <editor.lineHighlightBorder>`
    // - a 2px solid #282828 border - and not with a tinted band (D-81).
    expect(panelRule).toContain("border: 2px solid #282828");

    // and the line is NOT tinted
    expect(panelRule).toContain("background-color: transparent");
    expect(panelRule).not.toContain("#2a2a2a");
  });

  it("AC-101 the live view draws the live stream in a plain img", async () => {
    // the teacher is in the live view: the panel is in the live view
    const panel = codePanelInView(connectedState(), "live");

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // The live view arrives on the library's own registry - the second channel
    // that keeps the picture OUT of the element's payload (D-82). What is in
    // it now is the **stream's URL**, not a picture: the frames are served as
    // an MJPEG stream and the panel plays them in a plain `<img>` (D-85).
    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    const image = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-live-frame"]',
      );

      expect(found).not.toBeNull();

      return found as HTMLImageElement;
    })) as HTMLImageElement;

    // the picture IS the stream ...
    expect(image.getAttribute("src")).toBe(
      "http://127.0.0.1:47511/s/a-capability/frame",
    );

    // ... and it is NOT a data URL: the app never holds a byte of the picture
    // (D-85)
    expect(image.getAttribute("src")).not.toContain("data:image");

    // ... and it keeps the aspect ratio it has in the editor: the picture is
    // fitted into the panel and not stretched (D-82). The frame's own size
    // comes from the stream itself - the app is never told it.
    expect(image.style.objectFit).toBe("contain");
    expect(image.getAttribute("width")).toBeNull();
    expect(image.getAttribute("height")).toBeNull();

    // the tab strip is still there: the live view replaces the TEXT, not the
    // panel's chrome
    expect(
      document.querySelector('[data-testid="code-panel-file"]')!.textContent,
    ).toBe("main.py");
    expect(
      document.querySelector('[data-testid="code-panel-language"]')!
        .textContent,
    ).toBe("python");

    // and the mirrored text is not drawn under the picture
    expect(
      document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
    ).toBeNull();

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-102 a frame never reaches the element payload", async () => {
    // the live view is opt-in, so the panel is put in it (D-83)
    const panel = codePanelInView(connectedState(), "live");

    setPanelCapture(panel.id, {
      status: "live",
      streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
    });

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // the panel really does draw the live view ...
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-frame"]'),
      ).not.toBeNull(),
    );

    // ... and the payload carries NO frame at all. The payload is saved with
    // the document, so a frame in it would put the teacher's screen into the
    // .excalidraw file (D-82). And since wave 5i the frame does not even
    // reach the app: it is served as an MJPEG stream (D-85).
    const state = readCodePanelState(panel.panel);

    expect(JSON.stringify(state)).not.toContain("a-frame-in-base64");
    expect(JSON.stringify(panel)).not.toContain("a-frame-in-base64");
    expect(Object.keys(state!)).not.toContain("frame");
    expect(Object.keys(state!)).not.toContain("data");

    // the live view is in the registry, and the registry is NOT in the element
    expect(getPanelCapture(panel.id)?.status).toBe("live");

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-113 the panel's live view is a plain img pointed at the stream", async () => {
    // the teacher turned the live view on: the panel is in the live view
    const panel = codePanelInView(connectedState(), "live");

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    const image = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-live-frame"]',
      );

      expect(found).not.toBeNull();

      return found as HTMLImageElement;
    })) as HTMLImageElement;

    // A PLAIN `<img>`: the browser decodes the MJPEG stream natively, so the
    // app does no per-frame work at all (D-85).
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("src")).toBe(
      "http://127.0.0.1:47511/s/a-capability/frame",
    );

    // and NOT a data URL: the picture never becomes text, and never becomes
    // a base64 blob the app has to build and swap (D-85)
    expect(image.getAttribute("src")).not.toContain("data:image");

    // the panel's own state carries no picture either: the payload is saved
    // with the document (D-82)
    const state = readCodePanelState(panel.panel);

    expect(Object.keys(state!)).not.toContain("data");
    expect(Object.keys(state!)).not.toContain("frame");

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-119 the live view falls back to the text mirror and says why", async () => {
    // the teacher turned the live view on, and the capture cannot run
    const panel = codePanelInView(connectedState(), "live");

    setPanelCapture(panel.id, {
      status: "unavailable",
      reason: "the capture helper could not be started",
    });

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // the TEXT is the fallback: the mirrored code is still there ...
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // ... and the panel SAYS why there is no live view. A fallback the
    // teacher cannot explain is a broken panel (D-75).
    const status = document.querySelector(
      '[data-testid="code-panel-live-status"]',
    );

    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("capture helper");

    // and there is no picture pretending to be the editor
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).toBeNull();

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-103 in the live view, with no capture, the panel falls back to the text and says why", async () => {
    // the teacher turned the live view on, and there is no picture to show
    const panel = codePanelInView(connectedState(), "live");

    // the capture helper cannot run, or it stopped: the extension says so
    setPanelCapture(panel.id, {
      status: "unavailable",
      reason: "the capture helper could not be started",
    });

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // the TEXT is the fallback: the mirrored code is still there ...
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // ... and the panel SAYS why there is no live view. A fallback the
    // teacher cannot explain is a broken panel (D-75).
    const status = document.querySelector(
      '[data-testid="code-panel-live-status"]',
    );

    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("capture helper");

    // and there is no picture pretending to be the editor
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).toBeNull();

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-103 in the editor view there is nothing to explain: the panel shows the editor", async () => {
    // the same missing capture, but the teacher is in the EDITOR view - the
    // one they chose (D-99)
    const panel = codePanelInView(connectedState(), "editor");

    setPanelCapture(panel.id, {
      status: "unavailable",
      reason: "the capture helper could not be started",
    });

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // the editor is there ...
    expect(
      document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
    ).not.toBeNull();

    // ... and there is NO reason line: the teacher did not ask for the live
    // view, so there is nothing to explain (D-83).
    expect(
      document.querySelector('[data-testid="code-panel-live-status"]'),
    ).toBeNull();

    act(() => {
      clearAllPanelCaptures();
    });
  });
});

describe("the code panel's view", () => {
  /**
   * The registry is global, so the spies a test installs are undone after it:
   * the library's own mermaid grammar is back for the next test.
   */
  afterEach(() => {
    registerCodeMirrorLanguage("mermaid", async () => mermaidLite());
  });

  it("AC-106 the code panel's default view is the live window, and the native editor is the teacher's choice", async () => {
    // a panel that carries no choice: it follows the default (D-99)
    const panel = codePanel(connectedState());

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // a live frame arrives - the bridge is streaming the editor's window ...
    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    // ... and the panel shows the LIVE WINDOW: it is the default, and the
    // teacher never asked for anything else (D-99).
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-frame"]'),
      ).not.toBeNull(),
    );

    // the picture replaced the text: the live window IS the view now
    expect(
      document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
    ).toBeNull();

    // and the panel SAYS which view it is in
    const toggle = document.querySelector(
      '[data-testid="code-panel-view-toggle"]',
    ) as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("data-view")).toBe("live");

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-107 the teacher turns the live view on from the panel, and the choice is the panel's own", async () => {
    // the teacher is in the EDITOR view - the one they chose (D-99)
    const panel = codePanelInView(connectedState(), "editor");

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // the toggle is in the panel's OWN header, which is always mounted. It is
    // NOT in the chrome: the chrome is only rendered for a SELECTED panel, so
    // a button there would be invisible until the panel is selected.
    const toggle = document.querySelector(
      '[data-testid="code-panel-view-toggle"]',
    ) as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("data-view")).toBe("editor");

    // the teacher turns the live view on
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-frame"]'),
      ).not.toBeNull(),
    );

    // and the frame replaces the text
    expect(
      document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
    ).toBeNull();

    // the choice is the PANEL's own, and it is persisted in its payload
    expect(readPanelView(panel.panel)).toBe("live");

    // and it survives the bridge's own writes: the bridge rewrites the
    // panel's payload on every keystroke in the teacher's editor, and the
    // teacher's choice of view must not be wiped by that (D-83).
    const afterBridgeWrite = withCodePanelState(panel.panel, {
      ...connectedState(),
      editor: {
        ...connectedState().editor,
        text: "print('bye')",
        version: 4,
      },
    });

    expect(readPanelView(afterBridgeWrite)).toBe("live");

    // and the teacher turns it back
    fireEvent.click(
      document.querySelector('[data-testid="code-panel-view-toggle"]')!,
    );

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    expect(readPanelView(panel.panel)).toBe("editor");

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-137 a new code panel shows the live window by default", async () => {
    // a NEW panel: its payload carries no choice, so it follows the default
    const fresh = codePanel(connectedState());

    // and a panel that ALREADY exists: wave 5h wrote `view: "editor"` into
    // every payload, and that was the OLD default - not a choice the teacher
    // ever made (D-99)
    const existing = codePanel(connectedState(), {
      panel: {
        ...codePanelContent(connectedState(), "session-1"),
        view: "editor",
      },
    });

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(fresh), asElement(existing)]);

    // the bridge is streaming the editor's window ...
    act(() => {
      for (const panel of [fresh, existing]) {
        setPanelCapture(panel.id, {
          status: "live",
          streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
        });
      }
    });

    // ... and BOTH panels show the LIVE WINDOW: it is the default, and the
    // flip reaches the panels that already exist (D-99)
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-testid="code-panel-live-frame"]'),
      ).toHaveLength(2),
    );

    // the picture replaced the text in both of them
    expect(
      document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
    ).toBeNull();

    // and the panel SAYS which view it is in, so the teacher can see what a
    // click will do
    const toggle = document.querySelector(
      '[data-testid="code-panel-view-toggle"]',
    ) as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("data-view")).toBe("live");

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-137 a panel the teacher switched to the editor keeps the editor across a reload", async () => {
    // the teacher switched the panel to the editor view: that is a CHOICE,
    // and it is in the payload (D-99)
    const panel = codePanelInView(connectedState(), "editor");

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    expect(readPanelView(panel.panel)).toBe("editor");

    // a RELOAD: the document brings the payload back, and the panel is a new
    // element - with a new id, and the same payload
    const reloaded = codePanel(connectedState(), { panel: panel.panel });

    API.setElements([asElement(reloaded)]);

    // the bridge is streaming, and the descriptor arrives for the new panel
    act(() => {
      setPanelCapture(reloaded.id, {
        status: "live",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    // the panel STILL shows the editor: the teacher's choice survived the
    // reload (D-83's promise, and D-99's)
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).toBeNull();

    // and the header says which view it is in
    const toggle = document.querySelector(
      '[data-testid="code-panel-view-toggle"]',
    ) as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("data-view")).toBe("editor");

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-108 the editor's grammar follows the file's language, and it is not the mermaid one", async () => {
    const asked: string[] = [];

    registerCodeMirrorLanguage("python", async () => {
      asked.push("python");
      return [];
    });

    registerCodeMirrorLanguage("mermaid", async () => {
      asked.push("mermaid");
      return [];
    });

    // the file VS Code calls `python`
    const panel = codePanel(connectedState());

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // the editor asked the registry for the FILE's language ...
    await waitFor(() => expect(asked).toContain("python"), { timeout: 10000 });

    // ... and it did NOT ask for the mermaid grammar. The mermaid grammar
    // belongs to the text-to-diagram dialog, which is the only thing that
    // speaks mermaid (D-84).
    expect(asked).not.toContain("mermaid");
  });

  it("AC-109 the mermaid grammar is for mermaid only, and the text-to-diagram dialog keeps it", async () => {
    // the library's own grammar is registered
    expect(await loadCodeMirrorLanguage("mermaid")).not.toBeNull();

    // the spy goes in AFTER that check, so the only thing that can put
    // "mermaid" into `asked` is the dialog itself
    const asked: string[] = [];

    registerCodeMirrorLanguage("mermaid", async () => {
      asked.push("mermaid");
      return mermaidLite();
    });

    // and the text-to-diagram dialog asks for it: the dialog is the mermaid
    // input, so it is the one thing that wears the mermaid grammar.
    renderComponent(
      <UIAppStateContext.Provider value={uiAppState()}>
        <TTDDialogInput
          input="flowchart TD"
          placeholder="mermaid"
          onChange={() => {}}
        />
      </UIAppStateContext.Provider>,
    );

    await waitFor(() => expect(asked).toContain("mermaid"), { timeout: 10000 });
  });

  it("AC-110 a language that is not registered gets NO grammar", async () => {
    // a language nobody registered: it must not be highlighted as something
    // it is not (D-84).
    const state = connectedState();

    const panel = codePanel({
      ...state,
      editor: {
        ...state.editor,
        uri: "file:///demo/main.bf",
        language: "brainfuck",
        text: "def greet():",
      },
    });

    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // the text is there ...
    expect(
      document.querySelector('[data-testid="code-panel-source"] .cm-content')
        ?.textContent,
    ).toContain("def greet():");

    // ... and NO word is painted: an unknown language is plain text, and it
    // is never the mermaid one.
    expect(tokenColour("def")).toBeNull();

    expect(
      document.querySelectorAll(
        '[data-testid="code-panel-source"] .cm-content span',
      ).length,
    ).toBe(0);
  });

  it("AC-161 the teacher can type in the editor view", async () => {
    const onChange = vi.fn();

    const panel = codePanelInView(connectedState(), "editor");

    await render(<Excalidraw panelDraft={{ onChange }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    // the editor is there, and CodeMirror says on its own DOM that it is
    // **editable**: a read-only mirror says `aria-readonly`
    const host = await waitFor(() => {
      const found = overlay!.querySelector(
        '[data-testid="code-panel-draft-editor"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });

    const content = await waitFor(() => {
      const found = host.querySelector(".cm-content") as HTMLElement | null;

      expect(found).not.toBeNull();

      return found!;
    });

    expect(content.getAttribute("contenteditable")).toBe("true");
    expect(content.getAttribute("aria-readonly")).toBeNull();

    // and the teacher's typing is reported to the host, which owns the write
    const view = EditorView.findFromDOM(host as HTMLElement);

    expect(view).not.toBeNull();

    act(() => {
      view!.dispatch({
        changes: {
          from: 0,
          to: view!.state.doc.length,
          insert: "print('bye')",
        },
      });
    });

    expect(onChange).toHaveBeenCalledWith(panel.id, "print('bye')");

    // and the panel says which text it is showing: the mirror, because the
    // teacher has not touched the draft yet (D-123)
    expect(
      overlay!
        .querySelector('[data-testid="code-panel-editor-source"]')!
        .getAttribute("data-source"),
    ).toBe("mirror");
  });

  it("AC-161 a mirror update does not overwrite a panel the teacher has edited", async () => {
    const onChange = vi.fn();

    const panel = codePanelInView(connectedState(), "editor");

    // the teacher typed: the draft is theirs
    const edited = {
      ...panel,
      panel: withPanelDraft(panel.panel, {
        text: "print('mine')",
        language: "python",
        edited: true,
      }),
    } as unknown as ExcalidrawPanelElement;

    await render(<Excalidraw panelDraft={{ onChange }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(edited)]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-content'),
      ).not.toBeNull(),
    );

    // the extension publishes **other** text: the mirror moves on
    const mirrored = {
      ...edited,
      panel: withCodePanelState(edited.panel, {
        ...connectedState(),
        editor: {
          ...connectedState().editor,
          text: "print('theirs')",
        },
      }),
    } as unknown as ExcalidrawPanelElement;

    act(() => {
      API.setElements([asElement(mirrored)]);
    });

    // the teacher's own text is still there
    const content = document.querySelector(
      '[data-testid="code-panel-source"] .cm-content',
    );

    expect(content!.textContent).toContain("print('mine')");
    expect(content!.textContent).not.toContain("print('theirs')");

    // and the panel says it is showing the draft
    expect(
      overlay!
        .querySelector('[data-testid="code-panel-editor-source"]')!
        .getAttribute("data-source"),
    ).toBe("draft");
  });

  it("AC-164 the editor view works with no bridge and says that running needs one", async () => {
    const onChange = vi.fn();

    const panel = codePanelInView(emptyCodePanelState(), "editor");

    await render(<Excalidraw panelDraft={{ onChange }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    // the state of the connection is said ...
    const status = overlay!.querySelector('[data-testid="code-panel-status"]');

    expect(status).not.toBeNull();
    expect(status!.getAttribute("data-bridge-state")).toBe("not-connected");
    expect(status!.textContent).not.toBe("");

    // ... and the editor is there anyway, and it is editable: the teacher's
    // own text does not need a bridge (D-123)
    const host = await waitFor(() => {
      const found = overlay!.querySelector(
        '[data-testid="code-panel-draft-editor"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });

    const content = await waitFor(() => {
      const found = host.querySelector(".cm-content") as HTMLElement | null;

      expect(found).not.toBeNull();

      return found!;
    });

    expect(content.getAttribute("contenteditable")).toBe("true");
    expect(content.getAttribute("aria-readonly")).toBeNull();

    // and the panel says that running needs the bridge (D-124)
    const note = overlay!.querySelector(
      '[data-testid="code-panel-run-needs-bridge"]',
    );

    expect(note).not.toBeNull();
    expect(note!.textContent).not.toBe("");
    expect(note!.textContent).toContain("Bridge");

    // the Run control is there, and it is not pretending
    const run = overlay!.querySelector(
      '[data-testid="code-panel-run"]',
    ) as HTMLButtonElement;

    expect(run).not.toBeNull();
    expect(run.disabled).toBe(true);
  });
});
