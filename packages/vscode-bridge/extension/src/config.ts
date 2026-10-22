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

/**
 * How many frames a second the window capture takes.
 *
 * The frame rate is a **setting** (`excalidraw-bridge.captureFps`), because
 * the right number depends on the machine and on the lesson: six a second is
 * enough to read by, and it is what the capture was measured at (5.8 frames
 * a second end to end through the helper, the raw capture itself costing
 * about 12 ms a frame).
 *
 * A number that is not a number, or one outside the range, falls back to the
 * default rather than to something that would hammer the machine.
 */
export const DEFAULT_CAPTURE_FPS = 6;

export function resolveCaptureFps(configured?: number): number {
  if (
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured >= 1 &&
    configured <= 30
  ) {
    return Math.floor(configured);
  }

  return DEFAULT_CAPTURE_FPS;
}
