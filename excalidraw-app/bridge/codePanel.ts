import { isPanelElement, newElementWith } from "@excalidraw/element";
import {
  emptyCodePanelState,
  readCodePanelState,
  withCodePanelState,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { CodePanelState } from "@excalidraw/excalidraw";

import type { BridgeMessage } from "../../packages/vscode-bridge/bridge/src/protocol";

/**
 * The code panel's live state, on the app's side.
 *
 * The **library** draws the panel; the **app** owns the bridge. This module is
 * where the two meet: it turns the bridge's messages into the plain data the
 * panel's payload carries, and it writes that data back into the element.
 *
 * The state rides inside the element's payload, so it is saved with the
 * document and travels with a `postMessage` to the presenter (D-46). The
 * **token is not in it**: the payload is saved, and the token is a secret
 * (D-50).
 */

/**
 * How many lines of output and of console the panel keeps.
 *
 * The payload is saved with the document, so an unbounded log would make the
 * document grow without end. The tail is what the teacher is looking at.
 */
export const MAX_PANEL_LINES = 200;

/** The state a code panel starts with: no bridge, no editor, no output. */
export const initialCodePanelState = (): CodePanelState =>
  emptyCodePanelState();

const keepTail = <T>(lines: T[]): T[] =>
  lines.length > MAX_PANEL_LINES
    ? lines.slice(lines.length - MAX_PANEL_LINES)
    : lines;

/**
 * The panel's state after a message from the bridge.
 *
 * A message the panel does not care about leaves the state alone — the state
 * is never rebuilt from scratch, so the mirrored text survives a message the
 * panel has no use for.
 */
export const reduceCodePanelState = (
  state: CodePanelState,
  message: BridgeMessage,
): CodePanelState => {
  switch (message.type) {
    case "editor:content":
      return {
        ...state,
        editor: {
          uri: message.uri,
          language: message.language,
          text: message.text,
          selection: message.selection ?? null,
          version: message.version,
        },
      };

    case "bridge:hello":
      return {
        ...state,
        console: keepTail([
          ...state.console,
          {
            level: "info",
            text: `Connected to ${message.workspace || "the editor"} (bridge ${
              message.version
            }).`,
          },
        ]),
      };

    case "run:started":
      return {
        ...state,
        run: {
          runId: message.runId,
          command: message.command,
          state: "running",
          exitCode: null,
        },
        console: keepTail([
          ...state.console,
          { level: "info", text: `Run started: ${message.command}` },
        ]),
      };

    case "run:output":
      return {
        ...state,
        output: keepTail([
          ...state.output,
          { stream: message.stream, text: message.text },
        ]),
      };

    case "run:exit":
      return {
        ...state,
        run: {
          ...state.run,
          state: "exited",
          exitCode: message.code,
        },
        console: keepTail([
          ...state.console,
          {
            level:
              message.code === 0 || message.code === null ? "info" : "error",
            text:
              message.code === null
                ? "Run stopped."
                : `Run finished with code ${message.code}.`,
          },
        ]),
      };

    default:
      return state;
  }
};

/**
 * The elements, with every bridge-backed code panel carrying the given state.
 *
 * The **same array** comes back when nothing changed, so the caller can tell
 * "there is nothing to do" from "the scene changed" without comparing the
 * elements one by one.
 */
export const applyCodePanelState = (
  elements: readonly ExcalidrawElement[],
  state: CodePanelState,
): readonly ExcalidrawElement[] => {
  let changed = false;

  const next = elements.map((element) => {
    if (
      !isPanelElement(element) ||
      element.panelKind !== "code" ||
      element.panel.source.type !== "bridge"
    ) {
      return element;
    }

    if (readCodePanelState(element.panel) === state) {
      return element;
    }

    changed = true;

    return newElementWith(element, {
      panel: withCodePanelState(element.panel, state),
    });
  });

  return changed ? next : elements;
};
