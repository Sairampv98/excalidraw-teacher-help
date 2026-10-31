import { useEffect, useRef } from "react";

import { useApp } from "@excalidraw/excalidraw/components/App";
import { createMcpClient } from "@excalidraw/excalidraw/mcp/client";
import {
  DEFAULT_MCP_HOST,
  DEFAULT_MCP_PORT,
} from "@excalidraw/excalidraw/mcp/protocol";
import { runMcpTool } from "@excalidraw/excalidraw/mcp/runner";

import type { McpClient } from "@excalidraw/excalidraw/mcp/client";

import type { McpApp } from "@excalidraw/excalidraw/mcp/common";

import { appJotaiStore, useAtomValue } from "../app-jotai";

import {
  assistantAllowAtom,
  assistantCodeAtom,
  assistantConnectionAtom,
  assistantEnabledAtom,
  recordAssistantActivity,
} from "./assistantState";

export const ASSISTANT_APP_NAME = "Excalidraw classroom";
const FEATURES = ["canvas"];

/** the server's address: the build's, or the fixed loopback port */
export const assistantUrl = (): string =>
  import.meta.env.VITE_APP_MCP_URL ||
  `ws://${DEFAULT_MCP_HOST}:${DEFAULT_MCP_PORT}`;

/** how many elements a change touched, for the toast and the activity list */
export const describeAssistantChange = (
  tool: string,
  result: unknown,
): string => {
  const r = (result ?? {}) as Record<string, unknown>;
  const count = Array.isArray(r.created)
    ? r.created.length
    : Array.isArray(r.changed)
    ? r.changed.length
    : Array.isArray(r.deleted)
    ? r.deleted.length
    : typeof r.elements === "number"
    ? r.elements
    : null;

  return count === null
    ? tool
    : `${tool}: ${count} element${count === 1 ? "" : "s"}`;
};

/**
 * Keeps the link to the assistant's server while the app is open and the person
 * has paired (D-397). It draws nothing.
 */
export const AssistantLink = () => {
  const app = useApp() as unknown as McpApp;
  const code = useAtomValue(assistantCodeAtom);
  const enabled = useAtomValue(assistantEnabledAtom);
  const allow = useAtomValue(assistantAllowAtom);
  const allowRef = useRef(allow);
  const clientRef = useRef<McpClient | null>(null);

  allowRef.current = allow;

  useEffect(() => {
    if (!enabled || !code) {
      appJotaiStore.set(assistantConnectionAtom, {
        status: "idle",
        message: "Not connected to an assistant.",
        attempt: 0,
      });
      return;
    }

    const client = createMcpClient({
      url: assistantUrl(),
      getCode: () => code,
      getState: () => ({
        allowChanges: allowRef.current,
        app: ASSISTANT_APP_NAME,
        features: FEATURES,
      }),
      onStateChange: (state) =>
        appJotaiStore.set(assistantConnectionAtom, state),
      onCall: async (tool, args) => {
        const outcome = await runMcpTool(app, tool, args, {
          allowChanges: allowRef.current,
          app: ASSISTANT_APP_NAME,
          features: FEATURES,
        });

        if (outcome.ok) {
          const text = describeAssistantChange(tool, outcome.result);

          recordAssistantActivity({ tool, ok: true, text });

          if (
            /^(create|update|delete|set)_/.test(tool) &&
            typeof app.setToast === "function"
          ) {
            app.setToast({ message: `Assistant: ${text}`, duration: 2500 });
          }
        } else {
          recordAssistantActivity({
            tool,
            ok: false,
            text: `${outcome.error.code}: ${outcome.error.message}`,
          });
        }

        return outcome;
      },
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
    };
  }, [app, code, enabled]);

  // the server is told when Allow changes is turned on or off
  useEffect(() => {
    clientRef.current?.pushState();
  }, [allow]);

  return null;
};
