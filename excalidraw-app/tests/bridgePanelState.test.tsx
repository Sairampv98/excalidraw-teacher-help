/**
 * The code panel must never claim a connection that is not there (D-133).
 *
 * The connection line rides in the panel's payload, and the payload is saved
 * with the document - so a document saved while the bridge was connected comes
 * back with the line "Connected to Visual Studio Code (my-todo-app, bridge
 * 0.1.0)." on a machine where nothing is connected. The panel is a **status**,
 * and a status is the truth now.
 *
 * These are the teeth: with the fix reverted they fail with the stale line
 * still showing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { newPanelElement } from "@excalidraw/element";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  codePanelContent,
  emptyCodePanelState,
  readCodePanelState,
} from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useBridgePanel } from "../bridge/useBridgePanel";

/**
 * A token that is **obviously** not a secret: the kit's secret scanner
 * exempts values that say they are a test, a fake or a placeholder.
 */
const TEST_TOKEN = "test-token-placeholder";

/** The line a document saved while the bridge was connected carries. */
const STALE_LINE =
  "Connected to Visual Studio Code (my-todo-app, bridge 0.1.0).";

/**
 * The socket the app opens, standing in for the browser's `WebSocket`.
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

/**
 * A code panel as a document **saved while the bridge was connected** carries
 * it: the connection says "connected", and the console holds the connection
 * line - the line that is a lie on a machine with no bridge.
 */
const savedWhileConnected = () =>
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
          text: "print('hello')",
          selection: null,
          version: 1,
        },
        console: [
          { level: "info", kind: "connection", text: STALE_LINE },
          { level: "info", text: "Run started: python main.py" },
        ],
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
  const panel = (element ??
    savedWhileConnected()) as unknown as ExcalidrawElement;

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

/** The panel's connection lines - the status, and not the log (D-75). */
const connectionLines = (state: { elements: ExcalidrawElement[] }) =>
  (panelState(state)?.console ?? [])
    .filter((line) => line.kind === "connection")
    .map((line) => line.text);

/** The editor, with the app's bridge wiring. */
const Harness = ({
  api,
  panel,
}: {
  api: ExcalidrawImperativeAPI;
  panel: ExcalidrawElement;
}) => {
  const { bridge, panelDraft, panelRun } = useBridgePanel(api);

  return (
    <Excalidraw
      initialData={{
        elements: [panel],
        // the panel is selected, so its chrome - and with it the bridge field -
        // is on the screen
        appState: { selectedElementIds: { [panel.id]: true } },
      }}
      panelBridge={bridge}
      panelDraft={panelDraft}
      panelRun={panelRun}
    />
  );
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  // every test starts with a tab that remembers no token, so the app does
  // not connect by itself (D-111)
  sessionStorage.clear();
});

describe("the panel's connection is the truth, not the document's memory", () => {
  it("AC-172 a panel saved with a connection line shows not connected when the app starts with no bridge", async () => {
    const { api, state } = scene();

    await render(<Harness api={api} panel={state.elements[0]} />);

    await waitFor(() => {
      const current = panelState(state);

      // the panel does not claim a connection that is not there
      expect(current?.connection).toBe("not-connected");
      expect(current?.statusMessage).toContain("Not connected");
      expect(connectionLines(state)).toEqual([
        "Not connected to the Excalidraw Bridge.",
      ]);
      expect(
        current?.console.map((line) => line.text).join("\n"),
      ).not.toContain("Connected to Visual Studio Code");
    });

    // and the panel's own text survives: only the connection was written
    expect(panelState(state)?.editor.text).toBe("print('hello')");
    expect(panelState(state)?.console.map((line) => line.text)).toContain(
      "Run started: python main.py",
    );
  });

  it("AC-172 the connection line is replaced, never duplicated", async () => {
    mockClipboard(TEST_TOKEN);

    const { api, state } = scene();

    await render(<Harness api={api} panel={state.elements[0]} />);

    // jsdom has no layout, so the editor's viewport is 0x0 and nothing would
    // be visible
    API.setAppState({ width: 1000, height: 1000 });

    // the app starts with no bridge: the stale line is replaced by the truth
    await waitFor(() => {
      expect(connectionLines(state)).toEqual([
        "Not connected to the Excalidraw Bridge.",
      ]);
    });

    // the teacher pastes the token: the app opens the socket
    fireEvent.click(
      document.querySelector('[data-testid="panel-bridge-paste"]')!,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    const socket = lastSocket();

    socket.open();

    await waitFor(() => expect(socket.sent.length).toBe(1));

    // the extension says hello: the panel says which editor it is (D-76)
    act(() => {
      socket.receive({
        v: 1,
        type: "bridge:hello",
        version: "0.1.0",
        workspace: "my-todo-app",
        appName: "Visual Studio Code",
      });
    });

    // the line is REPLACED: one line, and it is the new one
    await waitFor(() => {
      expect(connectionLines(state)).toEqual([
        "Connected to Visual Studio Code (my-todo-app, bridge 0.1.0).",
      ]);
    });

    // the connection drops: the line is replaced again, and never doubled
    act(() => {
      socket.refuse();
    });

    await waitFor(() => {
      const lines = connectionLines(state);

      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain("Connected to Visual Studio Code");
      expect(panelState(state)?.connection).not.toBe("connected");
    });
  });
});
