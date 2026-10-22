/**
 * The app's side of the VS Code bridge: the session, the token, and the state
 * the code panel shows.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { newPanelElement } from "@excalidraw/element";
import { validateFractionalIndices } from "@excalidraw/element";
import { Excalidraw } from "@excalidraw/excalidraw";
import { codePanelContent, emptyCodePanelState } from "@excalidraw/excalidraw";
import { readCodePanelState } from "@excalidraw/excalidraw";
import { withPanelView } from "@excalidraw/excalidraw";
import {
  codeMirrorLanguageIds,
  loadCodeMirrorLanguage,
} from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { bridgeConnection } from "../bridge/bridgeSession";
import {
  initialCodePanelState,
  reduceCodePanelState,
} from "../bridge/codePanel";
import { insertCodePanel } from "../bridge/insertCodePanel";
import { useBridgePanel } from "../bridge/useBridgePanel";
import { CODE_LANGUAGE_IDS } from "../codeLanguages";

import { BRIDGE_URL_ENV_VAR } from "../../packages/vscode-bridge/bridge/src/protocol";

/**
 * A token that is **obviously** not a secret: the kit's secret scanner
 * exempts values that say they are a test, a fake or a placeholder.
 */
const TEST_TOKEN = "test-token-placeholder";

/**
 * The socket the app opens, standing in for the browser's `WebSocket`.
 *
 * The bridge server is in the teacher's VS Code, so the app's side is tested
 * against a socket the test drives: the test opens it, sends the frames the
 * extension would send, and reads what the app sent back.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  readyState = 1;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  /** every frame the app sent */
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** the socket opens */
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** the bridge sends a frame */
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** the connection is refused */
  refuse() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const lastSocket = () => FakeSocket.instances[FakeSocket.instances.length - 1];

/** The clipboard the field reads. */
const mockClipboard = (text: string) => {
  const clipboard = {
    read: vi.fn(async () => []),
    readText: vi.fn(async () => text),
    writeText: vi.fn(async () => undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
};

/** A code panel, with the bridge as its source. */
const codePanelElement = () =>
  newPanelElement({
    type: "panel",
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(emptyCodePanelState(), "session-1"),
    posterMode: false,
    posterFileId: null,
  });

/**
 * A code panel that is already **connected**, the way it is after the bridge
 * has said hello.
 *
 * The harness's API is a stand-in: it holds the elements in a variable, so
 * what the app writes into them is not what the rendered Excalidraw shows.
 * A panel that draws its editor region therefore has to start connected.
 *
 * The `view` is the panel's own: `"live"` is the opt-in live window, and
 * `"editor"` (the default) is the native editor (D-83).
 */
const connectedCodePanelElement = (view?: "editor" | "live") => {
  const content = codePanelContent(
    {
      ...emptyCodePanelState(),
      connection: "connected",
      statusMessage: "Connected to the Excalidraw Bridge.",
    },
    "session-1",
  );

  return newPanelElement({
    type: "panel",
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: view ? withPanelView(content, view) : content,
    posterMode: false,
    posterFileId: null,
  });
};

/**
 * A code panel that is connected and is mirroring a **python** file.
 *
 * The bridge sends VS Code's own language id, so the panel knows the file is
 * `python` - and the editor must wear the python grammar (D-84).
 */
const pythonCodePanelElement = () =>
  newPanelElement({
    type: "panel",
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(
      {
        ...emptyCodePanelState(),
        connection: "connected",
        statusMessage: "Connected to the Excalidraw Bridge.",
        editor: {
          uri: "file:///demo/main.py",
          language: "python",
          text: "def greet():\n    return 1",
          selection: null,
          version: 1,
        },
      },
      "session-1",
    ),
    posterMode: false,
    posterFileId: null,
  });

/**
 * The app's scene, and the API the hook writes into.
 *
 * The hook needs an API; this one keeps the elements in a variable, so the
 * test can look at what the app wrote into the document.
 */
const scene = (element?: ExcalidrawElement) => {
  const panel = (element ?? codePanelElement()) as unknown as ExcalidrawElement;

  const state: { elements: ExcalidrawElement[] } = { elements: [panel] };

  const api = {
    getSceneElements: () => state.elements,
    updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
      if (data.elements) {
        state.elements = [...data.elements];
      }
    },
  } as unknown as ExcalidrawImperativeAPI;

  return { api, state, panel };
};

/** The panel's live state, as the app wrote it into the document. */
const panelState = (state: { elements: ExcalidrawElement[] }) => {
  const panel = state.elements[0] as unknown as {
    panel: Parameters<typeof readCodePanelState>[0];
  };

  return readCodePanelState(panel.panel);
};

/** The editor, with the app's bridge wiring. */
const Harness = ({
  api,
  panel,
}: {
  api: ExcalidrawImperativeAPI;
  panel: ExcalidrawElement;
}) => {
  const { bridge } = useBridgePanel(api);

  return (
    <Excalidraw
      initialData={{
        elements: [panel],
        // the panel is selected, so its chrome — and with it the bridge field —
        // is on the screen
        appState: { selectedElementIds: { [panel.id]: true } },
      }}
      panelBridge={bridge}
    />
  );
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The keys a `Storage` holds.
 *
 * `Object.keys(storage)` is not the way: a `Storage` is not a plain object,
 * and its keys are not own enumerable properties. The spec's own way is
 * `length` and `key(i)`.
 */
const storageKeys = (storage: Storage): string[] => {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);

    if (key !== null) {
      keys.push(key);
    }
  }

  return keys;
};

/** Whether any value in the storage holds the token. */
const storageHolds = (storage: Storage, token: string): boolean =>
  storageKeys(storage).some((key) =>
    (storage.getItem(key) ?? "").includes(token),
  );

describe("the app's side of the bridge", () => {
  it("AC-60 a run:start produces a run:started / run:output / run:exit sequence in the panel", async () => {
    mockClipboard(TEST_TOKEN);

    const { api, state, panel } = scene();

    await render(<Harness api={api} panel={panel} />);

    // jsdom has no layout, so the editor's viewport is 0x0 and nothing would
    // be visible
    API.setAppState({ width: 1000, height: 1000 });

    // the teacher pastes the token: the app opens the socket and sends the
    // token in the FIRST frame
    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    const socket = lastSocket();

    socket.open();

    await waitFor(() => expect(socket.sent.length).toBe(1));

    // the app talks to the bridge on the loopback interface, and the token is
    // NOT in the URL (D-50)
    expect(BRIDGE_URL_ENV_VAR).toBe("VITE_APP_BRIDGE_URL");
    expect(socket.url).toBe("ws://127.0.0.1:47511/");
    expect(socket.url).not.toContain(TEST_TOKEN);

    expect(JSON.parse(socket.sent[0])).toEqual({
      v: 1,
      type: "bridge:auth",
      token: TEST_TOKEN,
    });

    // the extension answers, and the program runs
    act(() => {
      socket.receive({
        v: 1,
        type: "bridge:hello",
        version: "1.0.0",
        workspace: "demo",
      });
      socket.receive({
        v: 1,
        type: "run:started",
        runId: "run-1",
        command: "python main.py",
        cwd: "/demo",
      });
      socket.receive({
        v: 1,
        type: "run:output",
        runId: "run-1",
        stream: "stdout",
        text: "hello",
      });
      socket.receive({ v: 1, type: "run:exit", runId: "run-1", code: 0 });
    });

    await waitFor(() => {
      const current = panelState(state);

      expect(current?.connection).toBe("connected");
      expect(current?.run.state).toBe("exited");
      expect(current?.run.exitCode).toBe(0);
      expect(current?.output).toEqual([{ stream: "stdout", text: "hello" }]);
      expect(current?.console.map((line) => line.text).join("\n")).toContain(
        "Run started: python main.py",
      );
    });
  });

  it("AC-61 with no bridge the panel shows the reconnect state, not a blank editor", async () => {
    mockClipboard(TEST_TOKEN);

    const { api, state, panel } = scene();

    await render(<Harness api={api} panel={panel} />);

    // jsdom has no layout, so the editor's viewport is 0x0 and nothing would
    // be visible
    API.setAppState({ width: 1000, height: 1000 });

    // the teacher pastes the token, but nothing is listening: the connection
    // is refused
    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    act(() => {
      lastSocket().open();
      lastSocket().refuse();
    });

    await waitFor(() => {
      const current = panelState(state);

      // the panel says what is wrong ...
      expect(current?.connection).toBe("rejected");
      expect(current?.statusMessage).not.toBe("");
      expect(current?.statusMessage).toContain("Not connected");
    });
  });

  it("AC-80 the Paste from clipboard button fills the field from navigator.clipboard.readText()", async () => {
    const clipboard = mockClipboard(TEST_TOKEN);

    const { api, panel } = scene();

    await render(<Harness api={api} panel={panel} />);

    // jsdom has no layout, so the editor's viewport is 0x0 and nothing would
    // be visible
    API.setAppState({ width: 1000, height: 1000 });

    const input = document.querySelector(
      '[data-testid="panel-bridge-token"]',
    ) as HTMLInputElement;

    expect(input.value).toBe("");

    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(input.value).toBe(TEST_TOKEN));

    expect(clipboard.readText).toHaveBeenCalled();
  });

  it("AC-81 the token is never persisted", async () => {
    mockClipboard(TEST_TOKEN);

    const { api, state, panel } = scene();

    await render(<Harness api={api} panel={panel} />);

    // jsdom has no layout, so the editor's viewport is 0x0 and nothing would
    // be visible
    API.setAppState({ width: 1000, height: 1000 });

    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    // not in the browser's storage ...
    expect(storageHolds(localStorage, TEST_TOKEN)).toBe(false);
    expect(storageHolds(sessionStorage, TEST_TOKEN)).toBe(false);
    expect(document.cookie).not.toContain(TEST_TOKEN);

    // ... not in the URL ...
    expect(window.location.href).not.toContain(TEST_TOKEN);

    // ... and not in the document: the panel's payload is saved with it
    expect(JSON.stringify(state.elements)).not.toContain(TEST_TOKEN);
  });

  it("AC-82 the three connection states are the states the panel can show", () => {
    expect(bridgeConnection("idle")).toBe("not-connected");
    expect(bridgeConnection("connecting")).toBe("not-connected");
    expect(bridgeConnection("closed")).toBe("not-connected");
    expect(bridgeConnection("connected")).toBe("connected");
    // a refused connection: the token was wrong, or the extension is not
    // running
    expect(bridgeConnection("reconnecting")).toBe("rejected");
  });

  it("AC-87 the bridge identifies the editor it runs in, and the app shows it", async () => {
    mockClipboard(TEST_TOKEN);

    const { api, state, panel } = scene();

    await render(<Harness api={api} panel={panel} />);

    API.setAppState({ width: 1000, height: 1000 });

    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    const socket = lastSocket();
    socket.open();

    await waitFor(() => expect(socket.sent.length).toBe(1));

    // The extension says WHICH editor it is. The port is fixed, so with two
    // editors running the app may reach the one that does NOT have the
    // teacher's file open - and the teacher has to be able to see that (D-76).
    act(() => {
      socket.receive({
        v: 1,
        type: "bridge:hello",
        version: "0.1.0",
        workspace: "demo",
        appName: "VSCodium",
      });
    });

    // the chrome says it ...
    await waitFor(() => {
      const chrome = document.querySelector(
        '[data-testid="panel-bridge-state"]',
      );

      expect(chrome?.textContent).toContain("VSCodium");
    });

    // ... and so does the panel's console
    await waitFor(() => {
      const current = panelState(state);

      expect(current?.console.map((line) => line.text).join("\n")).toContain(
        "VSCodium",
      );
    });
  });

  it("AC-89 a hello without the editor's name still connects", async () => {
    mockClipboard(TEST_TOKEN);

    const { api, state } = scene();

    await render(<Harness api={api} panel={state.elements[0]} />);

    API.setAppState({ width: 1000, height: 1000 });

    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    const socket = lastSocket();
    socket.open();

    await waitFor(() => expect(socket.sent.length).toBe(1));

    // an extension that predates the field says nothing about itself, and it
    // still connects
    act(() => {
      socket.receive({
        v: 1,
        type: "bridge:hello",
        version: "1.0.0",
        workspace: "demo",
      });
    });

    await waitFor(() => {
      expect(panelState(state)?.connection).toBe("connected");
    });
  });

  it("AC-85 a reconnect replaces the connection line instead of adding another one", () => {
    const hello = {
      v: 1,
      type: "bridge:hello",
      version: "0.1.0",
      workspace: "session2",
    } as const;

    const first = reduceCodePanelState(initialCodePanelState(), hello);
    const second = reduceCodePanelState(first, hello);
    const third = reduceCodePanelState(second, hello);

    // ONE line, not three: the console rides in the element's payload, and
    // the payload is saved with the document - so a line that is added on
    // every reconnect would grow the document for ever (D-75).
    expect(third.console).toHaveLength(1);
    expect(third.console[0].text).toContain("Connected to session2");
    expect(third.console[0].kind).toBe("connection");

    // a line that is NOT a connection line is kept
    const withRun = reduceCodePanelState(third, {
      v: 1,
      type: "run:started",
      runId: "run-1",
      command: "python main.py",
      cwd: "C:/work",
    } as const);

    const afterAnotherHello = reduceCodePanelState(withRun, hello);

    expect(afterAnotherHello.console).toHaveLength(2);
    expect(
      afterAnotherHello.console.filter((line) => line.kind === "connection"),
    ).toHaveLength(1);
    expect(
      afterAnotherHello.console.some((line) =>
        line.text.includes("Run started"),
      ),
    ).toBe(true);
  });

  it("AC-83 an inserted code panel gets a fractional index, so the scene accepts it", () => {
    const state: { elements: ExcalidrawElement[] } = { elements: [] };

    const api = {
      getSceneElements: () => state.elements,
      getAppState: () => ({
        width: 800,
        height: 600,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
        currentPageId: "page-1",
      }),
      updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
        if (data.elements) {
          state.elements = [...data.elements];
        }
      },
    } as unknown as ExcalidrawImperativeAPI;

    insertCodePanel(api);

    expect(state.elements).toHaveLength(1);

    // a NEW element is born with `index: null` ("not yet assigned to the
    // scene"). The scene validates the indices BEFORE it syncs them, so an
    // element that still has no index fails that validation - and in dev and
    // test it throws, which killed the very first insert of a panel into an
    // empty scene.
    expect(state.elements[0].index).not.toBeNull();

    // the library's own validator is the oracle: the elements the app hands
    // over must satisfy it
    expect(() =>
      validateFractionalIndices(state.elements, {
        shouldThrow: true,
        includeBoundTextValidation: true,
      }),
    ).not.toThrow();
  });

  it("AC-95 a new code panel is about half the visible canvas, not a constant", () => {
    const state: { elements: ExcalidrawElement[] } = { elements: [] };

    const api = (width: number, height: number) =>
      ({
        getSceneElements: () => state.elements,
        getAppState: () => ({
          width,
          height,
          scrollX: 0,
          scrollY: 0,
          zoom: { value: 1 },
          currentPageId: "page-1",
        }),
        updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
          if (data.elements) {
            state.elements = [...data.elements];
          }
        },
      } as unknown as ExcalidrawImperativeAPI);

    // the owner's canvas: the editor's view covers HALF of what the teacher
    // can see - 990x1024 on a 1980x2048 screen (D-80)
    insertCodePanel(api(1980, 2048));

    expect(state.elements[0].width).toBe(990);
    expect(state.elements[0].height).toBe(1024);

    // it is a SHARE of the viewport, not a constant: a smaller screen gets a
    // smaller panel ...
    state.elements = [];
    insertCodePanel(api(1000, 800));

    expect(state.elements[0].width).toBe(500);
    expect(state.elements[0].height).toBe(400);

    // ... and a tiny one still gets a panel the teacher can read
    state.elements = [];
    insertCodePanel(api(400, 300));

    expect(state.elements[0].width).toBe(280);
    expect(state.elements[0].height).toBe(200);
  });

  it("AC-102 the app's frame handler writes nothing into the document", async () => {
    mockClipboard(TEST_TOKEN);

    // the panel is already connected, so it draws its editor region, and it is
    // in the LIVE view: the live window is the opt-in alternative (D-83)
    const { api, state, panel } = scene(connectedCodePanelElement("live"));

    await render(<Harness api={api} panel={panel} />);

    API.setAppState({ width: 1000, height: 1000 });

    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    const socket = lastSocket();

    socket.open();

    await waitFor(() => expect(socket.sent.length).toBe(1));

    // the extension says hello ...
    act(() => {
      socket.receive({
        v: 1,
        type: "bridge:hello",
        version: "0.1.0",
        workspace: "demo",
        appName: "VSCodium",
      });
    });

    // ... and then it streams a frame of the editor's own window
    act(() => {
      socket.receive({
        v: 1,
        type: "editor:frame",
        state: "live",
        data: "a-frame-in-base64",
        width: 1295,
        height: 687,
        seq: 1,
      });
    });

    // the panel DRAWS it ...
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-frame"]'),
      ).not.toBeNull(),
    );

    // ... and the DOCUMENT carries no frame at all. The payload is saved with
    // the document, so a frame in it would put the teacher's screen into the
    // .excalidraw file (D-82).
    expect(JSON.stringify(state.elements)).not.toContain("a-frame-in-base64");
    expect(JSON.stringify(panelState(state))).not.toContain(
      "a-frame-in-base64",
    );
    expect(JSON.stringify(state.elements)).not.toContain("editor:frame");
  });
});

describe("the app's code languages", () => {
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

    const css = Array.from(document.querySelectorAll("style"))
      .map((tag) => tag.textContent)
      .join("\n");

    for (const className of Array.from(span.classList)) {
      const rule = new RegExp(
        `\\.${className.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}\\s*\\{([^}]*)\\}`,
      ).exec(css);

      if (rule) {
        return rule[1];
      }
    }

    return null;
  };

  it("AC-108 a python file is highlighted with the python grammar, not the mermaid one", async () => {
    // the app's grammars are registered when the module is imported
    await import("../codeLanguages");

    const panel = pythonCodePanelElement();

    await render(<Excalidraw initialData={{ elements: [panel] }} />);

    API.setAppState({ width: 1000, height: 1000 });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );

    // `def` is painted - the python grammar knows it is a keyword. The
    // grammar arrives ASYNCHRONOUSLY (the app fetches it with a dynamic
    // import), so the test waits for the painting rather than for the
    // editor.
    await waitFor(
      () => {
        const colour = tokenColour("def");

        expect(colour).not.toBeNull();

        // ... with the VS Code KEYWORD colour (#c586c0) ...
        expect(colour).toContain("#c586c0");

        // ... and NOT with the variable colour (#9cdcfe). That is the bug the
        // owner reported: the mermaid grammar matched `def` as a node name and
        // painted it as a variable (D-84).
        expect(colour).not.toContain("#9cdcfe");
      },
      { timeout: 10000 },
    );
  });

  it("AC-111 the app registers the six day-1 languages, and fetches them lazily", async () => {
    await import("../codeLanguages");

    const ids = codeMirrorLanguageIds();

    // the six the owner asked for, plus TypeScript and JSX, which come free
    // with the JavaScript package
    for (const id of CODE_LANGUAGE_IDS) {
      expect(ids).toContain(id);
    }

    expect(ids).toContain("javascript");
    expect(ids).toContain("java");
    expect(ids).toContain("python");
    expect(ids).toContain("c");
    expect(ids).toContain("cpp");
    expect(ids).toContain("rust");

    // and the grammar is really there
    expect(await loadCodeMirrorLanguage("python")).not.toBeNull();
    expect(await loadCodeMirrorLanguage("mermaid")).not.toBeNull();

    // and the registrations are LAZY: every grammar is fetched with a DYNAMIC
    // import, so it is downloaded only when a file of that language is
    // actually shown.
    const source = readFileSync(
      join(__dirname, "..", "codeLanguages.ts"),
      "utf8",
    );

    expect(source).toContain('import("@codemirror/lang-python")');

    // there is NO static import of a grammar package: that would fetch all
    // of them on every page load
    expect(source).not.toMatch(/from "@codemirror\/lang-/);
  });

  it("AC-112 the library's package.json gains no dependency: the grammars are the app's", async () => {
    const libraryPackage = JSON.parse(
      readFileSync(
        join(__dirname, "..", "..", "packages", "excalidraw", "package.json"),
        "utf8",
      ),
    );

    const appPackage = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    );

    const libraryDependencies = Object.keys(libraryPackage.dependencies ?? {});
    const appDependencies = Object.keys(appPackage.dependencies ?? {});

    for (const grammar of [
      "@codemirror/lang-cpp",
      "@codemirror/lang-java",
      "@codemirror/lang-javascript",
      "@codemirror/lang-python",
      "@codemirror/lang-rust",
    ]) {
      // the APP has it ...
      expect(appDependencies).toContain(grammar);

      // ... and the published LIBRARY has none of them: the library reaches
      // the grammars through its registry, so it never grows a grammar
      // dependency (D-84).
      expect(libraryDependencies).not.toContain(grammar);
    }
  });
});
