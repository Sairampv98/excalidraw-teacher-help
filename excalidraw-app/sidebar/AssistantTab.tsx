import { useState } from "react";

import { useAtomValue } from "../app-jotai";
import {
  assistantActivityAtom,
  assistantAllowAtom,
  assistantConnectionAtom,
  assistantEnabledAtom,
  disconnectAssistant,
  pairAssistant,
  setAssistantAllow,
} from "../assistant/assistantState";
import { normalizePairingCode } from "../assistant/pairingCode";

import "./AssistantTab.scss";

/** the line that adds the server to an assistant that is run from a terminal */
const ADD_COMMAND =
  'claude mcp add excalidraw -- node "<this project>\\packages\\mcp-server\\dist\\index.js"';

/**
 * The Assistant tab (D-398, D-399): where the person pairs the whiteboard with
 * the AI assistant that is working with it, says whether the assistant may change
 * the board, and sees what it has done.
 */
export const AssistantTab = () => {
  const connection = useAtomValue(assistantConnectionAtom);
  const enabled = useAtomValue(assistantEnabledAtom);
  const allow = useAtomValue(assistantAllowAtom);
  const activity = useAtomValue(assistantActivityAtom);
  const [typed, setTyped] = useState("");

  const connect = () => {
    const code = normalizePairingCode(typed);

    if (code) {
      pairAssistant(code);
      setTyped("");
    }
  };

  return (
    <div className="assistant-tab" data-testid="assistant-tab">
      <div className="assistant-tab__body">
        <p className="assistant-tab__intro">
          An AI assistant can draw on and edit this whiteboard while you work.
          It runs a small server on this computer; you connect to it here.
        </p>

        <p
          className="assistant-tab__status"
          data-testid="assistant-status"
          data-status={connection.status}
        >
          {connection.message}
        </p>

        <label className="assistant-tab__field">
          <span>Pairing code</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            placeholder="ABCD-2345"
            value={typed}
            data-testid="assistant-code-input"
            onChange={(event) => setTyped(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (event.key === "Enter") {
                connect();
              }
            }}
          />
        </label>
        <p className="assistant-tab__hint">
          Ask the assistant for it - its <em>status</em> tool tells the code.
          You type it once; it is remembered on this computer.
        </p>

        <div className="assistant-tab__buttons">
          <button
            type="button"
            data-testid="assistant-connect"
            disabled={!normalizePairingCode(typed)}
            onClick={connect}
          >
            Connect
          </button>
          <button
            type="button"
            data-testid="assistant-disconnect"
            disabled={!enabled}
            onClick={disconnectAssistant}
          >
            Disconnect
          </button>
        </div>

        <label className="assistant-tab__switch">
          <input
            type="checkbox"
            checked={allow}
            data-testid="assistant-allow"
            onChange={(event) => setAssistantAllow(event.target.checked)}
          />
          <span>Allow changes</span>
        </label>
        <p className="assistant-tab__hint">
          {allow
            ? "The assistant may draw, edit and delete. Ctrl+Z undoes what it does."
            : "The assistant can look at the board but cannot change it."}
        </p>

        <h4 className="assistant-tab__heading">What it did</h4>
        {activity.length ? (
          <ul
            className="assistant-tab__activity"
            data-testid="assistant-activity"
          >
            {[...activity].reverse().map((entry) => (
              <li key={entry.id} data-ok={entry.ok ? "true" : "false"}>
                {entry.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="assistant-tab__hint">Nothing yet.</p>
        )}

        <h4 className="assistant-tab__heading">Set it up</h4>
        <p className="assistant-tab__hint">
          Build the server once with <code>yarn build:mcp</code>, then add it to
          your assistant. For Claude Code:
        </p>
        <pre className="assistant-tab__command" data-testid="assistant-setup">
          {ADD_COMMAND}
        </pre>
      </div>
    </div>
  );
};
