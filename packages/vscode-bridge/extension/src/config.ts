import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRIDGE_URL_ENV_VAR,
  DEFAULT_BRIDGE_PORT,
} from "../../bridge/src/protocol";

/**
 * Where the bridge's port and token come from.
 *
 * The port is FIXED (D-67): the app finds the bridge the way it finds the
 * collaboration server - a build-time `VITE_APP_*` variable - and the
 * extension reads the SAME variable out of the workspace it has open, so the
 * two cannot drift apart. It is never a random free port, and the app never
 * scans for it.
 *
 * The token is negotiated in band, in the first frame. It is never in a URL
 * and never on a command line.
 *
 * This module deliberately imports nothing from `vscode`, so the rules can be
 * tested without an editor.
 */

/** The env files the port is read from, in the order they are read. */
export const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.development",
];

/** Read one variable out of the workspace's env files. */
export function readEnvValue(
  workspaceRoot: string | undefined,
  key: string,
): string | undefined {
  if (!workspaceRoot) {
    return undefined;
  }
  for (const file of ENV_FILES) {
    const path = join(workspaceRoot, file);
    if (!existsSync(path)) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || match[1] !== key) {
        continue;
      }
      return match[2].trim().replace(/^["']/, "").replace(/["']$/, "");
    }
  }
  return undefined;
}

/**
 * The fixed port.
 *
 * A setting wins, then the `VITE_APP_*` variable, then the shared default -
 * the same number the app side falls back to.
 */
export function resolvePort(
  workspaceRoot: string | undefined,
  configured?: number,
): number {
  if (
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }

  const url = readEnvValue(workspaceRoot, BRIDGE_URL_ENV_VAR);
  if (url) {
    try {
      const port = Number(new URL(url).port);
      if (Number.isFinite(port) && port > 0) {
        return port;
      }
    } catch {
      // not a URL - fall through to the next source
    }
  }

  const raw = readEnvValue(workspaceRoot, "VITE_APP_BRIDGE_PORT");
  if (raw) {
    const port = Number(raw);
    if (Number.isFinite(port) && port > 0) {
      return port;
    }
  }

  return DEFAULT_BRIDGE_PORT;
}

/**
 * The per-session token.
 *
 * A configured token is used as it is. Otherwise a random one is generated for
 * this session, and the teacher is shown it.
 */
export function resolveToken(configured?: string): {
  token: string;
  generated: boolean;
} {
  const trimmed = configured?.trim();
  if (trimmed) {
    return { token: trimmed, generated: false };
  }
  return { token: randomBytes(24).toString("hex"), generated: true };
}

/** The key the session token is kept under in the editor's secret storage. */
export const KEPT_SESSION_SLOT = "excalidraw-bridge.kept-session";

/** Whether a kept value is a token this extension made (48 hex characters). */
export const isStoredToken = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{48}$/.test(value);

/**
 * The token of this session, with the one the editor kept (D-333).
 *
 * The token used to be new every time the extension started, so a reload of the
 * editor gave the page a token it did not have: the page kept offering the old
 * one and the connection never came back by itself. A token the extension made
 * is now **kept in the editor's secret storage**, and a started extension uses
 * it again - so a reload of the editor or of the page reconnects by itself.
 *
 * A configured token still wins and is never kept (it is the teacher's own).
 * A kept value that is not a token of ours is not trusted: a new one is made.
 */
export function resolveSessionToken(
  configured?: string,
  stored?: string,
): { token: string; generated: boolean; reused: boolean } {
  const trimmed = configured?.trim();

  if (trimmed) {
    return { token: trimmed, generated: false, reused: false };
  }

  if (isStoredToken(stored)) {
    return { token: stored, generated: true, reused: true };
  }

  return {
    token: randomBytes(24).toString("hex"),
    generated: true,
    reused: false,
  };
}

/**
 * How many frames a second the window capture takes.
 *
 * The frame rate is a **setting** (`excalidraw-bridge.captureFps`), because
 * the right number depends on the machine and on the lesson: six a second is
 * enough to read by, and it is what the capture was measured at (5.8 frames
 * a second end to end through the helper, the raw capture itself costing
 * about 12 ms a frame).
 *
 * A number that is not a number, or less than one, falls back to the default.
 * A number above the most there is - sixty - is the most (D-363): it used to
 * fall back to the default too, so a teacher who asked for 48 got 12 and was
 * never told. The helper takes the frames as fast as the window can be drawn,
 * so a number above what the machine can do is the machine's best.
 */
export const DEFAULT_CAPTURE_FPS = 12;

/** the most frames a second that can be asked for */
export const MAX_CAPTURE_FPS = 60;

export function resolveCaptureFps(configured?: number): number {
  if (
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured >= 1
  ) {
    return Math.min(MAX_CAPTURE_FPS, Math.floor(configured));
  }

  return DEFAULT_CAPTURE_FPS;
}

/**
 * The Python the Python OCR engines run in.
 *
 * It is a **setting** (`excalidraw-bridge.pythonPath`), because the engines
 * that are Python live in a virtual environment the teacher chooses - the
 * `indra` and `paddle` engines run in a sidecar, and the sidecar is this
 * interpreter (D-90).
 *
 * An empty setting falls back to `python`, which is what a machine with the
 * engines on its PATH has.
 */
export const DEFAULT_PYTHON_PATH = "python";

export function resolvePythonPath(configured?: string): string {
  const trimmed = configured?.trim();

  return trimmed ? trimmed : DEFAULT_PYTHON_PATH;
}
