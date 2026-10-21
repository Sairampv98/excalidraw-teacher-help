/**
 * The app's side of the VS Code bridge: the session, the token, and the state
 * the code panel shows.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { newPanelElement } from "@excalidraw/element";
import { validateFractionalIndices } from "@excalidraw/element";
import { Excalidraw } from "@excalidraw/excalidraw";
import { codePanelContent, emptyCodePanelState } from "@excalidraw/excalidraw";
import { readCodePanelState } from "@excalidraw/excalidraw";
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
import { insertCodePanel } from "../bridge/insertCodePanel";
import { useBridgePanel } from "../bridge/useBridgePanel";

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
 * The app's scene, and the API the hook writes into.
 *
 * The hook needs an API; this one keeps the elements in a variable, so the
 * test can look at what the app wrote into the document.
 */
const scene = () => {
  const panel = codePanelElement() as unknown as ExcalidrawElement;

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
});
