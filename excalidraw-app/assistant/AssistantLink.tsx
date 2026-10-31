import { useEffect, useRef } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { useApp } from "@excalidraw/excalidraw/components/App";
import { createMcpClient } from "@excalidraw/excalidraw/mcp/client";
import {
  DEFAULT_MCP_HOST,
  DEFAULT_MCP_PORT,
} from "@excalidraw/excalidraw/mcp/protocol";
import { runMcpTool } from "@excalidraw/excalidraw/mcp/runner";

import type { McpClient } from "@excalidraw/excalidraw/mcp/client";

import type { McpApp } from "@excalidraw/excalidraw/mcp/common";
import type { McpRunContext } from "@excalidraw/excalidraw/mcp/runner";

import { appJotaiStore, useAtomValue } from "../app-jotai";

import {
  keepDeletedPage,
  listDeletedPages,
  restoreDeletedPage,
} from "../pages/pageTrash";

import { createAppTools } from "./appTools";

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
 * What only the app can do for the page tools: the store of deleted pages, which
 * keeps a page in the browser's storage so it can come back after a reload (D-280).
 */
const pageHooks = (apiRef: {
  current: ReturnType<typeof useExcalidrawAPI>;
}): NonNullable<McpRunContext["hooks"]> => ({
  keepDeletedPage: async (pageId) => {
    const api = apiRef.current;

    if (api) {
      await keepDeletedPage(api, api.getAppState().pages ?? [], pageId);
    }
  },
  listDeletedPages: async () =>
    (await listDeletedPages()).map((entry) => ({
      id: entry.id,
      name: entry.page.name,
      deletedAt: entry.deletedAt,
      elements: entry.elements.length,
    })),
  restoreDeletedPage: async (id) => {
    const api = apiRef.current;
    const entry = (await listDeletedPages()).find((each) => each.id === id);

    if (!api || !entry) {
      return null;
    }

    const pageId = await restoreDeletedPage(api, entry);
    const pages = api.getAppState().pages ?? [];
    const index = pages.findIndex((page) => page.id === pageId);

    return { page: index + 1, id: pageId, name: entry.page.name };
  },
});

/**
 * Keeps the link to the assistant's server while the app is open and the person
 * has paired (D-397). It draws nothing.
 */
export const AssistantLink = () => {
  const app = useApp() as unknown as McpApp;
  const api = useExcalidrawAPI();
  const apiRef = useRef(api);

  apiRef.current = api;
  // the tools that need what only the app has: its stickers, tables and code cards
  const appToolsRef = useRef(createAppTools(() => apiRef.current));
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
          hooks: pageHooks(apiRef),
          appTools: appToolsRef.current,
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
