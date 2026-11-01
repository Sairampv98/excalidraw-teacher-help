/**
 * What the app keeps about the assistant link (D-398, D-399): the pairing code
 * the person typed, whether the link is on, whether the assistant may change the
 * scene, the state of the connection, and what the assistant has done lately.
 *
 * The code and the two switches are the person's choices and are remembered in
 * the browser's own storage, read defensively - storage can be blocked, and the
 * app works without it. Nothing here is sent anywhere but to the server on this
 * machine.
 */

import type { McpClientState } from "@excalidraw/excalidraw/mcp/client";

import { appJotaiStore, atom } from "../app-jotai";

export const ASSISTANT_CODE_KEY = "excalidraw-mcp-code";
export const ASSISTANT_ENABLED_KEY = "excalidraw-mcp-enabled";
export const ASSISTANT_ALLOW_KEY = "excalidraw-mcp-allow";
export const ASSISTANT_INTERNET_KEY = "excalidraw-mcp-internet";

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // the choice still holds for this session
  }
};

export const assistantCodeAtom = atom<string>(read(ASSISTANT_CODE_KEY) ?? "");

/** the link is on: the person paired once and has not turned it off */
export const assistantEnabledAtom = atom<boolean>(
  read(ASSISTANT_ENABLED_KEY) === "1",
);

/** the assistant may change the scene; on until the person says otherwise */
export const assistantAllowAtom = atom<boolean>(
  read(ASSISTANT_ALLOW_KEY) !== "0",
);

/** the assistant may fetch from the internet: off until the person says (D-410) */
export const assistantInternetAtom = atom<boolean>(
  read(ASSISTANT_INTERNET_KEY) === "1",
);

export const assistantConnectionAtom = atom<McpClientState>({
  status: "idle",
  message: "Not connected to an assistant.",
  attempt: 0,
});

export type AssistantActivity = {
  id: number;
  at: number;
  tool: string;
  ok: boolean;
  text: string;
};

export const assistantActivityAtom = atom<AssistantActivity[]>([]);

const ACTIVITY_LIMIT = 30;
let activityCounter = 0;

export const recordAssistantActivity = (
  entry: Omit<AssistantActivity, "id" | "at">,
) => {
  appJotaiStore.set(assistantActivityAtom, (current) =>
    [...current, { ...entry, id: ++activityCounter, at: Date.now() }].slice(
      -ACTIVITY_LIMIT,
    ),
  );
};

/** the code as the person typed it, and the link turned on with it */
export const pairAssistant = (code: string) => {
  write(ASSISTANT_CODE_KEY, code);
  write(ASSISTANT_ENABLED_KEY, "1");
  appJotaiStore.set(assistantCodeAtom, code);
  appJotaiStore.set(assistantEnabledAtom, true);
};

export const disconnectAssistant = () => {
  write(ASSISTANT_ENABLED_KEY, "0");
  appJotaiStore.set(assistantEnabledAtom, false);
};

export const setAssistantInternet = (allow: boolean) => {
  write(ASSISTANT_INTERNET_KEY, allow ? "1" : "0");
  appJotaiStore.set(assistantInternetAtom, allow);
};

export const setAssistantAllow = (allow: boolean) => {
  write(ASSISTANT_ALLOW_KEY, allow ? "1" : "0");
  appJotaiStore.set(assistantAllowAtom, allow);
};
