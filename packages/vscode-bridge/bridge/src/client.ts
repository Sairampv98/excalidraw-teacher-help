import {
  encodeBridgeMessage,
  parseBridgeMessage,
  type BridgeMessage,
} from "./protocol";

/**
 * The browser side of the bridge.
 *
 * It uses the browser's OWN `WebSocket` - there is no dependency here, and
 * there is none needed: the app is a web page.
 *
 * The important behaviour is the one the panel depends on: when there is no
 * bridge, the client says so. It never reports "connected" without a server
 * that has accepted the token, and it never leaves the panel with nothing to
 * show (D-52, AC-61).
 */

export type BridgeClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface BridgeClientState {
  /** Where the connection stands right now. */
  status: BridgeClientStatus;
  /** How many times the client has tried to connect. */
  attempt: number;
  /** A sentence the panel can show. Never empty. */
  message: string;
}

/** The part of the browser `WebSocket` the client uses. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: any) => void) | null;
  onmessage: ((event: { data: any }) => void) | null;
  onclose: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface BridgeClientOptions {
  /** The websocket URL. It must NOT carry the token - see below. */
  url: string;
  /** The per-session token. It travels in the FIRST frame, never in the URL. */
  token: string;
  /** Called for every legal message the bridge sends. */
  onMessage?: (message: BridgeMessage) => void;
  /** Called whenever the connection state changes. */
  onStateChange?: (state: BridgeClientState) => void;
  /** Overridable for the tests. Defaults to the global `WebSocket`. */
  WebSocketImpl?: WebSocketConstructor;
  /** The first reconnect delay. It grows up to `maxRetryDelayMs`. */
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface BridgeClient {
  /** Open the connection. Safe to call twice. */
  connect: () => void;
  /** Close the connection and stop reconnecting. */
  disconnect: () => void;
  /** The current state. */
  getState: () => BridgeClientState;
  /** The last `editor:content` message, or null when there has been none. */
  getLastContent: () => Extract<
    BridgeMessage,
    { type: "editor:content" }
  > | null;
  /** Send a message to the bridge. Returns false when it is not connected. */
  send: (message: BridgeMessage) => boolean;
}

const MESSAGES: Record<BridgeClientStatus, string> = {
  idle: "Not connected to the Excalidraw Bridge.",
  connecting: "Connecting to the Excalidraw Bridge…",
  connected: "Connected to the Excalidraw Bridge.",
  reconnecting:
    "Not connected to the Excalidraw Bridge - is the extension running in VS Code or VSCodium?",
  closed: "Disconnected from the Excalidraw Bridge.",
};

/**
 * The token must never travel in the URL (D-50, D-67): a URL ends up in the
 * browser's history, in a proxy log and in a `Referer` header.
 *
 * The bridge protocol has no URL parameters at all, so a query string is a
 * mistake, and this throws rather than quietly sending the token on the wire.
 */
export function assertNoSecretsInUrl(url: string): void {
  if (url.includes("?") || url.includes("#")) {
    throw new Error(
      `the bridge URL must not carry a query string or a fragment - the token is negotiated in the first frame (got "${url}")`,
    );
  }
  if (/token|secret|password|key=/i.test(url)) {
    throw new Error(
      "the bridge URL must not carry the token - it is negotiated in the first frame",
    );
  }
}

/** A sentence the panel can show for a state. Never empty. */
export function describeBridgeState(state: BridgeClientState): string {
  return state.message || MESSAGES[state.status];
}

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  assertNoSecretsInUrl(options.url);

  const WebSocketImpl =
    options.WebSocketImpl ??
    (globalThis.WebSocket as unknown as WebSocketConstructor);
  const baseDelay = options.retryDelayMs ?? 500;
  const maxDelay = options.maxRetryDelayMs ?? 5000;

  let socket: WebSocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closedByUs = false;
  let attempt = 0;
  let lastContent: Extract<BridgeMessage, { type: "editor:content" }> | null =
    null;

  let state: BridgeClientState = {
    status: "idle",
    attempt: 0,
    message: MESSAGES.idle,
  };

  const setState = (status: BridgeClientStatus, message?: string) => {
    state = { status, attempt, message: message ?? MESSAGES[status] };
    options.onStateChange?.(state);
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closedByUs) {
      return;
    }
    attempt += 1;
    setState("reconnecting");
    const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
  };

  const open = () => {
    if (closedByUs) {
      return;
    }
    setState("connecting");
    let next: WebSocketLike;
    try {
      next = new WebSocketImpl(options.url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;

    next.onopen = () => {
      // The token goes out as the FIRST frame, in band. It is never in the
      // URL and never on a command line.
      try {
        next.send(
          encodeBridgeMessage({
            v: 1,
            type: "bridge:auth",
            token: options.token,
          }),
        );
      } catch {
        // the close handler takes it from here
      }
    };

    next.onmessage = (event: { data: any }) => {
      const parsed = parseBridgeMessage(String(event.data));
      if (!parsed) {
        return;
      }
      if (parsed.type === "bridge:hello") {
        attempt = 0;
        setState("connected");
      }
      if (parsed.type === "editor:content") {
        lastContent = parsed;
      }
      options.onMessage?.(parsed);
    };

    next.onerror = () => {
      // The close event always follows; the reconnect is scheduled there.
    };

    next.onclose = () => {
      socket = null;
      if (closedByUs) {
        setState("closed");
        return;
      }
      scheduleReconnect();
    };
  };

  return {
    connect: () => {
      closedByUs = false;
      if (socket) {
        return;
      }
      open();
    },
    disconnect: () => {
      closedByUs = true;
      clearTimer();
      if (socket) {
        try {
          socket.close();
        } catch {
          // already gone
        }
        socket = null;
      }
      setState("closed");
    },
    getState: () => state,
    getLastContent: () => lastContent,
    send: (message: BridgeMessage) => {
      if (!socket || socket.readyState !== 1) {
        return false;
      }
      socket.send(encodeBridgeMessage(message));
      return true;
    },
  };
}
