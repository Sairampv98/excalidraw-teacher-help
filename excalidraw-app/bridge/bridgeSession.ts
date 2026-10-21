import type { PanelBridgeStatus } from "@excalidraw/excalidraw";

import {
  createBridgeClient,
  describeBridgeState,
} from "../../packages/vscode-bridge/bridge/src/client";
import { bridgeUrl as defaultBridgeUrl } from "../../packages/vscode-bridge/bridge/src/protocol";

import type {
  BridgeClient,
  BridgeClientState,
  BridgeClientStatus,
  WebSocketConstructor,
} from "../../packages/vscode-bridge/bridge/src/client";
import type { BridgeMessage } from "../../packages/vscode-bridge/bridge/src/protocol";

/**
 * The app's side of the **VS Code bridge**.
 *
 * The browser half of the protocol already exists and is shared with the
 * extension's own tests: `packages/vscode-bridge/bridge/src/client.ts`. This
 * module is the app's thin wrapper around it. It owns three things:
 *
 * - the **URL**, which comes from the build-time `VITE_APP_BRIDGE_URL` and
 *   never carries the token (D-50);
 * - the **token**, which is a secret: it is held in memory for the session
 *   only, it is never written to disk and it never travels in a URL (D-50);
 * - the **state**, in the three shapes the panel can show: not connected,
 *   connected, rejected (D-52).
 */

/** Where the app connects when the build says nothing else. */
export const DEFAULT_BRIDGE_URL = defaultBridgeUrl();

/**
 * The URL the app connects to.
 *
 * The token is NOT part of it: a URL ends up in the browser's history, in a
 * proxy log and in a `Referer` header. The token is negotiated in the first
 * frame instead (D-50).
 */
export const bridgeUrl = (): string =>
  import.meta.env.VITE_APP_BRIDGE_URL || DEFAULT_BRIDGE_URL;

/** The state of the connection, as the panel shows it. */
export type BridgeSessionState = {
  /** where the connection stands */
  status: BridgeClientStatus;
  /** the panel's own three states */
  connection: PanelBridgeStatus;
  /** a sentence for the state. Never empty. */
  message: string;
  /** how many times the client has tried to connect */
  attempt: number;
};

/** The state of a session that has never connected. */
export const INITIAL_BRIDGE_SESSION_STATE: BridgeSessionState = {
  status: "idle",
  connection: "not-connected",
  message: "Not connected to the Excalidraw Bridge.",
  attempt: 0,
};

/**
 * The client's status, as the panel's three states.
 *
 * `reconnecting` is the state the client reaches when a connection was
 * refused — a wrong token, or no extension at all. That is what the teacher
 * has to act on, so it is the panel's `rejected` (D-52).
 */
export const bridgeConnection = (
  status: BridgeClientStatus,
): PanelBridgeStatus => {
  switch (status) {
    case "connected":
      return "connected";
    case "reconnecting":
      return "rejected";
    default:
      return "not-connected";
  }
};

export interface BridgeSessionOptions {
  /** the URL. Defaults to the build-time one. */
  url?: string;
  /** the websocket implementation. For the tests. */
  WebSocketImpl?: WebSocketConstructor;
  /** the connection state changed */
  onStateChange?: (state: BridgeSessionState) => void;
  /** a message arrived */
  onMessage?: (message: BridgeMessage) => void;
}

export interface BridgeSession {
  /** the token held in memory. Never persisted, never in a URL. */
  getToken: () => string;
  /** hold a token in memory. Does not connect. */
  setToken: (token: string) => void;
  /** connect with the token held in memory */
  connect: () => void;
  /** read the token from the clipboard, hold it and connect */
  pasteToken: () => Promise<string | null>;
  /** the current state */
  getState: () => BridgeSessionState;
  /** ask the extension to run a program */
  startRun: (command: string, args: string[], cwd?: string) => boolean;
  /** close the connection and stop reconnecting */
  disconnect: () => void;
}

/** The sentence the panel shows when the clipboard cannot be read. */
export const CLIPBOARD_ERROR =
  "The clipboard could not be read - paste the token into the field instead.";

/**
 * The app's bridge session.
 *
 * The token lives in this closure and nowhere else: it is never written to
 * `localStorage`, never put in the URL and never put in the document (the
 * panel's payload is saved with the document, so the token must not be in it).
 */
export const createBridgeSession = (
  options: BridgeSessionOptions = {},
): BridgeSession => {
  const url = options.url ?? bridgeUrl();

  let token = "";
  let client: BridgeClient | null = null;
  let error: string | null = null;

  const state = (): BridgeSessionState => {
    const clientState: BridgeClientState = client?.getState() ?? {
      status: "idle",
      attempt: 0,
      message: "",
    };

    return {
      status: clientState.status,
      connection: bridgeConnection(clientState.status),
      message: error ?? describeBridgeState(clientState),
      attempt: clientState.attempt,
    };
  };

  const publish = () => {
    options.onStateChange?.(state());
  };

  const open = () => {
    if (!token) {
      return;
    }

    client?.disconnect();

    client = createBridgeClient({
      url,
      token,
      WebSocketImpl: options.WebSocketImpl,
      onStateChange: publish,
      onMessage: (message) => options.onMessage?.(message),
    });

    client.connect();
  };

  return {
    getToken: () => token,

    setToken: (next: string) => {
      token = next;
      error = null;
      publish();
    },

    connect: () => {
      error = null;
      open();
    },

    pasteToken: async () => {
      let text: string | null = null;

      try {
        text = await navigator.clipboard.readText();
      } catch {
        text = null;
      }

      const pasted = (text ?? "").trim();

      if (!pasted) {
        error = CLIPBOARD_ERROR;
        publish();
        return null;
      }

      token = pasted;
      error = null;
      open();
      publish();

      return pasted;
    },

    getState: state,

    startRun: (command: string, args: string[], cwd?: string) => {
      if (!client) {
        return false;
      }

      const message: BridgeMessage =
        cwd === undefined
          ? { v: 1, type: "run:start", command, args }
          : { v: 1, type: "run:start", command, args, cwd };

      return client.send(message);
    },

    disconnect: () => {
      client?.disconnect();
      client = null;
      publish();
    },
  };
};
