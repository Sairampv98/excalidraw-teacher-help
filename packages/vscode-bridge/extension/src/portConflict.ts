/**
 * What the extension says when it cannot take the bridge's port.
 *
 * The port is FIXED (D-67), so with two editors running only one of them
 * holds it - and the app reaches that one, not necessarily the one the
 * teacher has their file open in. Losing that race silently is what made
 * this take an hour to see, so the message says what is wrong and what to
 * do (D-77).
 *
 * This module imports nothing from `vscode`, so the message can be tested
 * without an editor - the same reason `config.ts` keeps the port and the
 * token rules out of the editor's API.
 */

/** Is this the "the port is already taken" failure? */
export const isPortInUse = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;

  return (
    code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(text)
  );
};

/**
 * The message the teacher reads when the bridge cannot start.
 *
 * It names the port, says that another editor most likely holds it, and
 * gives the two ways out: close that editor, or give this one a different
 * port and point the app at it.
 */
export const portConflictMessage = (port: number, error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);

  if (isPortInUse(error)) {
    return (
      `Excalidraw Bridge: another editor already has port ${port}. ` +
      `Close that editor, or give this one a different port ` +
      `(excalidraw-bridge.port) and point the app at it with VITE_APP_BRIDGE_URL.`
    );
  }

  return `Excalidraw Bridge: could not listen on port ${port} - ${text}`;
};
