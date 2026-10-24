import { randomBytes } from "node:crypto";

import {
  isPresenterCommand,
  type PresenterCommand,
} from "../../bridge/src/protocol";

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The **input panel** - the controls the teacher uses, on their **real**
 * screen (D-145).
 *
 * The owner approved it in one line: *"yes work on the virtual display+input
 * panel"*. The idea is that **the screen the students see and the controls the
 * teacher uses are different surfaces**: the presenter's window goes on the
 * virtual display, and the teacher drives it from a small page beside their
 * notes and their IDE.
 *
 * This module is that page, and the route that serves it. The rules it keeps:
 *
 *  - **it is served on 127.0.0.1 only**, by the extension's own HTTP server -
 *    the same server that carries the capture stream. There is no second port
 *    and no second process.
 *  - **the session token is never in a URL, and never in the page**. The page
 *    is authorised by a **capability**: a single-purpose, per-session secret
 *    of its own, exactly like the stream's (D-86). The panel therefore cannot
 *    become a way to reach the bridge without the token - it never sees the
 *    token at all, and it cannot open the bridge's websocket.
 *  - **the panel can only ask for the presenter's own controls**, and they go
 *    onto the **bridge** - the same way the presenter's window asks for them,
 *    so there is one way to drive a presentation. A command that is not on the
 *    list is refused, so the panel can never run anything on the teacher's
 *    machine that the bridge does not already allow.
 *  - **the panel's own ACTIONS stay on the teacher's machine**. The one action
 *    there is - the editor's window moving onto the virtual display (D-147) -
 *    is the extension's own business, it never goes on the bridge, and the
 *    list of actions is closed.
 *  - **the panel does not take the teacher's keystrokes**. It installs no key
 *    handler at all, it never calls `focus()`, and its buttons do not take
 *    the focus when they are clicked: the teacher types in their own editor
 *    and the panel is a page beside it.
 *
 * This module imports nothing from `vscode`, so it can be driven by a test
 * without an editor.
 */

/** The path the panel is served at. The capability sits in the middle. */
export const PANEL_PATH_PREFIX = "/panel";

/** The page's own path. */
export const PANEL_PAGE_SUFFIX = "index.html";

/** The path of the panel's state. */
export const PANEL_STATE_SUFFIX = "state";

/** The path the panel's controls are posted to. */
export const PANEL_CONTROL_SUFFIX = "control";

/** How many bytes of randomness the capability has. */
export const PANEL_CAPABILITY_BYTES = 16;

/**
 * The biggest command the panel may send, in bytes.
 *
 * A command is a word. The bound is there so that a page on the internet
 * cannot make the extension read a body without end.
 */
export const PANEL_COMMAND_MAX_BYTES = 4096;

/** The route the panel answers on. */
const PANEL_ROUTE = new RegExp(
  `^${PANEL_PATH_PREFIX}/([^/]+)/(?:${PANEL_PAGE_SUFFIX}|${PANEL_STATE_SUFFIX}|${PANEL_CONTROL_SUFFIX})$`,
);

/** What the panel shows about the presenter's screen. */
export interface PanelState {
  /** the display the presenter's window is on */
  display: {
    device: string;
    name: string;
    width: number;
    height: number;
    x: number;
    y: number;
  } | null;
  /** is that display a virtual one? */
  virtual: boolean;
  /** the sentence the teacher reads. Never empty. */
  reason: string;
  /**
   * The click the teacher has to make, when there is one (D-146).
   *
   * A virtual display driver that is installed but DETACHED is one click away
   * from being usable, and the panel shows that click instead of hiding it.
   */
  remedy?: string;
}

/**
 * The panel's own **actions** - the things it asks the extension to do on the
 * teacher's machine.
 *
 * An action is NOT a presenter's control: it never goes on the bridge, and it
 * never leaves the teacher's own machine. The list is closed - a page that
 * asks for anything else is refused.
 *
 * The editor's window moves only when the teacher presses the button
 * (D-148): their window is theirs, and nothing moves unless they ask.
 */
export type PanelAction = "move-editor-window" | "bring-back-editor-window";

/** Every action the panel may ask for. */
export const PANEL_ACTIONS: readonly PanelAction[] = [
  "move-editor-window",
  "bring-back-editor-window",
];

/**
 * Is this one of the panel's own actions?
 *
 * The list is the whole answer: an action that is not on it is refused, so a
 * page on the internet cannot make the extension do anything it does not
 * already do.
 */
export const isPanelAction = (value: unknown): value is PanelAction =>
  typeof value === "string" &&
  (PANEL_ACTIONS as readonly string[]).includes(value);

/** The state the panel shows when nothing is known yet. */
export const UNKNOWN_PANEL_STATE: PanelState = {
  display: null,
  virtual: false,
  reason:
    "the presenter's screen is not known yet - open the input panel again once the bridge is up",
};

/**
 * The path of the panel's page, with the capability in it.
 *
 * The capability is NOT the session token: it authorises this one page and
 * nothing else, and it dies with the session.
 */
export const panelPath = (capability: string): string =>
  `${PANEL_PATH_PREFIX}/${capability}/${PANEL_PAGE_SUFFIX}`;

/**
 * Is this request from the loopback?
 *
 * The server binds to 127.0.0.1, so the answer is almost always yes - but a
 * request that arrived from anywhere else is refused, because the panel is
 * the teacher's own page and nobody else's.
 */
export const isLoopbackRequest = (req: IncomingMessage): boolean => {
  const address = req.socket?.remoteAddress ?? "";

  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
};

/**
 * The page.
 *
 * It is a plain page with plain buttons. There is no framework, no build step
 * and no dependency - the extension serves it as text.
 */
export const panelPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Excalidraw presenter - input panel</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0;
    padding: 16px;
    min-width: 320px;
  }
  h1 { font-size: 16px; margin: 0 0 4px; }
  #where { margin: 0 0 12px; opacity: 0.8; }
  #remedy {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-left: 3px solid rgba(128, 128, 128, 0.6);
  }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; }
  button {
    font: inherit;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(128, 128, 128, 0.6);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover { background: rgba(128, 128, 128, 0.15); }
  #status { margin-top: 12px; opacity: 0.8; min-height: 1.5em; }
</style>
</head>
<body>
<h1>Presenter controls</h1>
<p id="where">Looking for the presenter's screen...</p>
<p id="remedy" hidden></p>
<div class="controls">
  <button type="button" data-command="previous-page">Previous page</button>
  <button type="button" data-command="next-page">Next page</button>
  <button type="button" data-command="zoom-in">Zoom in</button>
  <button type="button" data-command="zoom-out">Zoom out</button>
  <button type="button" data-command="present">Present</button>
  <button type="button" data-command="stop">Stop</button>
</div>
<div class="controls">
  <button type="button" data-action="move-editor-window">Move this editor to the virtual display</button>
  <button type="button" data-action="bring-back-editor-window">Bring this editor back to this screen</button>
</div>
<p id="status"></p>
<script>
  // The panel NEVER listens for keys and NEVER takes the focus: the teacher
  // types in their own editor, and this page is beside it.
  //
  // The commands travel to the extension over this page's own loopback
  // route, and the extension puts them on the bridge - so the presenter is
  // driven the same way it is driven from its own window.
  //
  // An ACTION is the panel's own business on the teacher's machine - the
  // editor's window moving onto the virtual display (D-147). It never goes on
  // the bridge.
  var status = document.getElementById("status");

  var send = function (body, done) {
    fetch("./control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (response) {
        return response.json().then(function (answer) {
          return { ok: response.ok, body: answer };
        });
      })
      .then(function (answer) {
        status.textContent = answer.ok ? done(answer.body) : answer.body.reason;
      })
      .catch(function (error) {
        status.textContent = "the presenter did not answer: " + error.message;
      });
  };

  Array.prototype.forEach.call(
    document.querySelectorAll("button[data-command]"),
    function (button) {
      // The button does not take the focus when it is clicked: the teacher's
      // own window keeps the keyboard, and the panel stays out of the way.
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      button.addEventListener("click", function () {
        send(
          { command: button.getAttribute("data-command") },
          function (answer) {
            return answer.command + " was sent to the presenter";
          },
        );
      });
    },
  );

  Array.prototype.forEach.call(
    document.querySelectorAll("button[data-action]"),
    function (button) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      button.addEventListener("click", function () {
        send(
          { action: button.getAttribute("data-action") },
          function (answer) {
            return answer.action + " was asked for";
          },
        );
      });
    },
  );

  fetch("./state")
    .then(function (response) {
      return response.json();
    })
    .then(function (state) {
      document.getElementById("where").textContent = state.reason;

      // The remedy, when there is one: a virtual display that is installed
      // but detached is one click away, and the panel says which click
      // (D-146).
      var remedy = document.getElementById("remedy");

      remedy.textContent = state.remedy || "";
      remedy.hidden = !state.remedy;
    })
    .catch(function () {
      document.getElementById("where").textContent =
        "the presenter's screen is not known yet";
    });
</script>
</body>
</html>
`;

export interface InputPanelOptions {
  /**
   * The port the server ended up on.
   *
   * It is a function because the port is only known once the server listens,
   * and the panel's URL is written when the teacher opens it - which is
   * always after that.
   */
  port: () => number;
  /** the loopback host. Never bind this to anything but 127.0.0.1. */
  host?: string;
  /**
   * A control was pressed.
   *
   * The extension puts it on the bridge as a `present:command`, so the
   * presenter is driven the one way there is.
   */
  onCommand: (command: PresenterCommand) => void;
  /**
   * An action of the panel's own was asked for.
   *
   * It is the teacher's own machine and never the bridge: the action list is
   * closed, and the extension does the one thing it knows how to do.
   */
  onAction?: (action: PanelAction) => void;
  /** what the panel shows about the presenter's screen */
  state?: () => PanelState;
}

export interface InputPanel {
  /**
   * A capability for the panel.
   *
   * It is **per session** and single-purpose: it authorises this page and
   * nothing else, and the caller revokes it when the session ends.
   */
  createCapability: () => string;
  /** the URL the teacher opens on their real screen */
  urlFor: (capability: string) => string;
  /** the capability stops working */
  revoke: (capability: string) => void;
  /**
   * Serve a request.
   *
   * It answers `true` when the request was for the panel - including a
   * request it refused with a 404 - and `false` when the request was for
   * something else entirely.
   */
  handle: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** close the panel */
  close: () => void;
}

/** Reads a request's body, with a bound on its size. */
const readBody = (req: IncomingMessage, limit: number): Promise<string> =>
  new Promise<string>((resolve) => {
    let body = "";
    let aborted = false;

    req.on("data", (chunk: Buffer | string) => {
      if (aborted) {
        return;
      }

      body += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      if (body.length > limit) {
        aborted = true;
        resolve("");
      }
    });

    req.on("end", () => {
      if (!aborted) {
        resolve(body);
      }
    });

    req.on("error", () => {
      if (!aborted) {
        aborted = true;
        resolve("");
      }
    });
  });

/** A plain text answer. */
const text = (
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
) => {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store, no-cache, must-revalidate",
  });
  res.end(body);
};

/**
 * The input panel.
 *
 * The page is served from the extension's own loopback server, behind a
 * capability, and the controls it sends are the presenter's own controls.
 */
export const createInputPanel = (options: InputPanelOptions): InputPanel => {
  const host = options.host ?? "127.0.0.1";
  const capabilities = new Set<string>();

  const createCapability = () => {
    // 32 hex characters: unguessable, single-purpose and per session
    const capability = randomBytes(PANEL_CAPABILITY_BYTES).toString("hex");
    capabilities.add(capability);
    return capability;
  };

  const urlFor = (capability: string) =>
    `http://${host}:${options.port()}${panelPath(capability)}`;

  const revoke = (capability: string) => {
    capabilities.delete(capability);
  };

  const handle = (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const match = PANEL_ROUTE.exec(path);

    if (!match) {
      return false;
    }

    // The panel is the teacher's own page and nobody else's: a request that
    // did not come from the loopback is refused like a request with no
    // capability at all.
    if (!isLoopbackRequest(req)) {
      text(res, 404, "not found\n");
      return true;
    }

    const capability = match[1] ?? "";

    if (!capabilities.has(capability)) {
      // The capability is the authorisation (D-86): a request that does not
      // carry a live one is refused, and it is a 404 so that the endpoint
      // does not say what it is.
      text(res, 404, "not found\n");
      return true;
    }

    const section = path.slice(path.lastIndexOf("/") + 1);

    if (section === PANEL_PAGE_SUFFIX) {
      text(res, 200, panelPage(), "text/html; charset=utf-8");
      return true;
    }

    if (section === PANEL_STATE_SUFFIX) {
      const state = options.state?.() ?? UNKNOWN_PANEL_STATE;
      text(res, 200, JSON.stringify(state), "application/json; charset=utf-8");
      return true;
    }

    // The control route: the panel's commands.
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      text(res, 405, "method not allowed\n");
      return true;
    }

    void readBody(req, PANEL_COMMAND_MAX_BYTES).then((body) => {
      if (!body) {
        text(
          res,
          400,
          JSON.stringify({
            ok: false,
            reason: "the command was too long to be a command",
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      let parsed: { command?: unknown; action?: unknown } | undefined;

      try {
        parsed = JSON.parse(body) as { command?: unknown; action?: unknown };
      } catch {
        parsed = undefined;
      }

      if (isPresenterCommand(parsed?.command)) {
        options.onCommand(parsed.command);

        text(
          res,
          200,
          JSON.stringify({ ok: true, command: parsed.command }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (isPanelAction(parsed?.action)) {
        // An ACTION is the panel's own business on the teacher's own machine:
        // the editor's window moving onto the virtual display (D-147). It
        // never goes on the bridge, and the list of actions is closed.
        options.onAction?.(parsed.action);

        text(
          res,
          200,
          JSON.stringify({ ok: true, action: parsed.action }),
          "application/json; charset=utf-8",
        );
        return;
      }

      // A command that is not one of the presenter's own controls is
      // refused: the panel can never run anything on the teacher's machine
      // that the bridge does not already allow.
      text(
        res,
        400,
        JSON.stringify({
          ok: false,
          reason: "that is not one of the presenter's controls",
        }),
        "application/json; charset=utf-8",
      );
    });

    return true;
  };

  const close = () => {
    capabilities.clear();
  };

  return { createCapability, urlFor, revoke, handle, close };
};
