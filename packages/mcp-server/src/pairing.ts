/**
 * The pairing code (D-398).
 *
 * The assistant's client starts this server, and the page is somewhere else: the
 * page has to prove it is the person's own page, and the person has to know the
 * server is the one they started. The code is the whole of that: the server makes
 * one the first time it runs and keeps it in the person's own folder, the
 * `status` tool tells the assistant what it is, the person types it once in the
 * app's Assistant panel, and the page presents it in its first frame.
 *
 * It is never in a URL and never on a command line, and it is compared in
 * constant time.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** no 0, O, 1, I or L: the code is read aloud and typed */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const PAIRING_CODE_LENGTH = 8;

/** the folder the server keeps its own files in */
export const configDirectory = (env: NodeJS.ProcessEnv = process.env) =>
  env.EXCALIDRAW_MCP_HOME || join(homedir(), ".excalidraw-mcp");

export const makePairingCode = (): string => {
  let code = "";

  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
};

/** a code as the person typed it: upper case, with spaces and dashes taken out */
export const normalizePairingCode = (value: string) =>
  value.toUpperCase().replace(/[\s-]/g, "");

export const isPairingCode = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === PAIRING_CODE_LENGTH &&
  [...value].every((char) => ALPHABET.includes(char));

/** whether two codes are the same, without the time telling how far they agree */
export const pairingCodesMatch = (given: string, expected: string): boolean => {
  const a = createHash("sha256").update(normalizePairingCode(given)).digest();
  const b = createHash("sha256").update(expected).digest();

  return timingSafeEqual(a, b);
};

/** the code that is kept, or a new one that is kept from now on */
export const readOrCreatePairingCode = (
  directory = configDirectory(),
): string => {
  const file = join(directory, "pairing.json");

  try {
    const stored = JSON.parse(readFileSync(file, "utf8"));

    if (isPairingCode(stored?.code)) {
      return stored.code;
    }
  } catch {
    // no file yet, or one that is not ours: a new code is made below
  }

  const code = makePairingCode();

  mkdirSync(directory, { recursive: true });
  writeFileSync(file, JSON.stringify({ code }, null, 2), { mode: 0o600 });

  return code;
};
