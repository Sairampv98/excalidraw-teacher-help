import {
  BRIDGE_CLOSE_UNAUTHORIZED,
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
  /** the extension answered, and did not accept the token (D-333) */
  | "refused"
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
  /**
   * The per-session token. It travels in the FIRST frame, never in the URL.
   *
   * An empty token means the page has none, and the first frame is
   * `bridge:pair` instead (D-518): the editor asks the teacher whether to allow
   * this page.
   */
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
  refused:
    'VS Code did not accept this token - it may have a new one. In VS Code run "Excalidraw Bridge: Copy the session token", then press Paste here.',
  closed: "Disconnected from the Excalidraw Bridge.",
};

/** What the panel says while the teacher is being asked in the editor (D-518). */
export const PAIRING_WAITING =
  "Waiting for you in VS Code: choose Allow to let the whiteboard connect.";

/** What the panel says when the pairing was not allowed (D-518). */
export const PAIRING_REFUSED =
  "VS Code did not allow the whiteboard. Press Connect and choose Allow in VS Code, or paste the session token instead.";

/**
 * What the panel says when the extension in the editor is from before the
 * pairing (D-518): it cannot ask the teacher, and it says so by closing with
 * "the first frame must be bridge:auth". Its picture of the window may also be
 * cut off - the old helper does not know the screen's scale.
 */
export const PAIRING_OLD_EXTENSION =
  'The bridge extension in VS Code is an old version and cannot ask you to allow the board. Press "Set up my editor" to update it, or paste the session token instead.';

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
    const pairing = options.token === "";

    setState("connecting", pairing ? PAIRING_WAITING : undefined);
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
          encodeBridgeMessage(
            pairing
              ? { v: 1, type: "bridge:pair" }
              : { v: 1, type: "bridge:auth", token: options.token },
          ),
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

    next.onclose = (event: { code?: number; reason?: string } | undefined) => {
      socket = null;
      if (closedByUs) {
        setState("closed");
        return;
      }
      // An extension from before the pairing does not know the pair request. Measured against the real 0.2.0: it
      // closes with 1007 "not a bridge message" (a message it cannot read); a still older one with 1008 "the first
      // frame must be bridge:auth". Asking again gets the same answer, so it is said once, with what to do.
      if (
        pairing &&
        (event?.code === 1007 ||
          /must be bridge:auth|not a bridge message/.test(event?.reason ?? ""))
      ) {
        clearTimer();
        setState("refused", PAIRING_OLD_EXTENSION);
        return;
      }
      if (event?.code === BRIDGE_CLOSE_UNAUTHORIZED) {
        // The extension is THERE, and it did not accept the token: asking
        // again with the same one gets the same answer. The panel says what to
        // do, and a new token starts a new connection (D-333).
        clearTimer();
        setState("refused", pairing ? PAIRING_REFUSED : undefined);
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
