import { useMemo, useRef, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";

import { useAtomValue } from "../app-jotai";

import {
  DEFAULT_SETUP_CHOICE,
  EDITOR_CHOICES,
  LANGUAGE_GROUPS,
  SETUP_CMD_NAME,
  buildSetupOffer,
  type EditorSetupChoice,
  type SetupEditor,
  type SetupGroup,
} from "./editorSetup";
import {
  closeEditorSetup,
  editorSetupOpenAtom,
  readSavedChoice,
  saveChoice,
} from "./editorSetupState";

/** the saved choice, if it still means something: anything else is the default */
export const choiceFromStorage = (): EditorSetupChoice => {
  const saved = readSavedChoice() as Partial<EditorSetupChoice> | null;

  if (!saved || typeof saved !== "object") {
    return DEFAULT_SETUP_CHOICE;
  }

  const editor = EDITOR_CHOICES.some((entry) => entry.id === saved.editor)
    ? (saved.editor as SetupEditor)
    : DEFAULT_SETUP_CHOICE.editor;
  const groups = Array.isArray(saved.groups)
    ? LANGUAGE_GROUPS.map((group) => group.id).filter((id) =>
        (saved.groups as unknown[]).includes(id),
      )
    : DEFAULT_SETUP_CHOICE.groups;

  return {
    editor,
    profile:
      typeof saved.profile === "string"
        ? saved.profile
        : DEFAULT_SETUP_CHOICE.profile,
    groups,
  };
};

/** copies a text: the clipboard when the page may use it, else the selection of the field it is shown in */
const copyText = async (
  text: string,
  field: HTMLTextAreaElement | null,
): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // the clipboard refused (a page that is not secure, or no permission): the selection is tried
  }

  if (field) {
    field.focus();
    field.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }

  return false;
};

/** hands the text over as a file the browser saves */
const downloadText = (text: string, name: string): boolean => {
  try {
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/octet-stream" }),
    );
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);

    return true;
  } catch {
    return false;
  }
};

const sectionTitle = {
  margin: "0 0 6px",
  fontSize: 14,
  fontWeight: 600,
} as const;

const wayRow = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  alignItems: "center",
} as const;

const linkButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  minHeight: 40,
  borderRadius: 8,
  border: "1px solid var(--color-primary, #6965db)",
  color: "var(--color-primary, #6965db)",
  textDecoration: "none",
  fontWeight: 600,
  boxSizing: "border-box",
} as const;

const hint = { opacity: 0.8, fontSize: 13, lineHeight: 1.4 } as const;

/**
 * "Set up my editor" (D-518, D-364).
 *
 * A web page cannot install a program. The dialog offers the teacher the three
 * ways the browser can START the setup - a link, a downloaded `.cmd`, a command
 * to copy - and a checklist of what to set up. The setup itself shows its plan
 * in its own window, and nothing is installed until the teacher presses Set up
 * there.
 */
export const EditorSetupDialog = ({ onClose }: { onClose: () => void }) => {
  const [choice, setChoice] = useState<EditorSetupChoice>(choiceFromStorage);
  const [message, setMessage] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const origin = window.location.origin;
  const offer = useMemo(
    () => buildSetupOffer(choice, origin),
    [choice, origin],
  );

  const change = (next: EditorSetupChoice) => {
    setChoice(next);
    setMessage("");
    saveChoice(next);
  };

  const toggleGroup = (id: SetupGroup, on: boolean) =>
    change({
      ...choice,
      groups: on
        ? [...choice.groups, id]
        : choice.groups.filter((group) => group !== id),
    });

  const usable = offer.ok;

  return (
    <Dialog
      title="Set up my editor"
      onCloseRequest={onClose}
      size="regular"
      className="editor-setup-dialog"
    >
      <div
        data-testid="editor-setup"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxHeight: "68vh",
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        <div style={hint}>
          Sets up VS Code or VSCodium on this Windows computer for the board:
          the editor (installed for you alone when it is missing, no
          administrator), a profile of its own, the bridge extension, and the
          language support you tick.{" "}
          <strong>Nothing is installed until you press Set up</strong> in the
          window that opens.
        </div>

        {/* two columns where there is room, one where there is not: the buttons below stay in view on a 1280 x 720 screen */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "10px 24px",
          }}
        >
          <fieldset
            style={{ border: 0, margin: 0, padding: 0 }}
            data-testid="editor-setup-editor"
          >
            <legend style={sectionTitle}>1. Which editor</legend>
            {EDITOR_CHOICES.map((entry) => (
              <label
                key={entry.id}
                style={{
                  display: "block",
                  padding: "3px 0",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="editor-setup-editor"
                  value={entry.id}
                  checked={choice.editor === entry.id}
                  onChange={() => change({ ...choice, editor: entry.id })}
                />{" "}
                <strong>{entry.label}</strong>
                <span style={{ ...hint, display: "block", marginLeft: 22 }}>
                  {entry.hint}
                </span>
              </label>
            ))}
          </fieldset>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <fieldset
              style={{ border: 0, margin: 0, padding: 0 }}
              data-testid="editor-setup-languages"
            >
              <legend style={sectionTitle}>2. Language support to add</legend>
              {LANGUAGE_GROUPS.map((group) => (
                <label
                  key={group.id}
                  style={{
                    display: "block",
                    padding: "3px 0",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={choice.groups.includes(group.id)}
                    onChange={(event) =>
                      toggleGroup(group.id, event.target.checked)
                    }
                  />{" "}
                  {group.label}
                </label>
              ))}
            </fieldset>

            <div>
              <label style={sectionTitle} htmlFor="editor-setup-profile">
                3. Profile name
              </label>
              <input
                id="editor-setup-profile"
                data-testid="editor-setup-profile"
                type="text"
                value={choice.profile}
                maxLength={40}
                onChange={(event) =>
                  change({ ...choice, profile: event.target.value })
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "6px 8px",
                }}
                aria-describedby="editor-setup-profile-hint"
              />
              <div id="editor-setup-profile-hint" style={hint}>
                The editor gets a profile of this name, so your own settings
                stay as they are.
              </div>
            </div>
          </div>
        </div>

        {offer.ok ? null : (
          <div
            role="alert"
            data-testid="editor-setup-problem"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-danger, #c92a2a)",
              fontSize: 13,
            }}
          >
            {offer.reason}
          </div>
        )}

        <div>
          <div style={sectionTitle}>4. Start the setup (pick one)</div>
          <div style={{ ...hint, marginBottom: 8 }}>
            A web page cannot install anything by itself. These three ways each
            open the same small setup window on this computer, where you press
            Set up. Do the first or the second once; after that the third is
            enough.
          </div>

          <div
            data-testid="editor-setup-ways"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={wayRow}>
              <FilledButton
                variant="filled"
                disabled={!usable}
                onClick={() => {
                  if (!offer.ok) {
                    return;
                  }

                  setMessage(
                    downloadText(offer.cmd, SETUP_CMD_NAME)
                      ? `${SETUP_CMD_NAME} was saved. Double-click it in your Downloads folder and answer Run.`
                      : "The browser could not save the file. Copy the PowerShell command instead.",
                  );
                }}
              >
                Download {SETUP_CMD_NAME}
              </FilledButton>
              <div style={hint}>
                <strong>Easiest.</strong> Saves a small file. Double-click it in
                your Downloads folder and answer Run. The setup window opens.
              </div>
            </div>

            <div style={wayRow}>
              <FilledButton
                variant="outlined"
                disabled={!usable}
                onClick={async () => {
                  if (!offer.ok) {
                    return;
                  }

                  const copied = await copyText(
                    offer.command,
                    fieldRef.current,
                  );

                  setMessage(
                    copied
                      ? "Copied. Press the Windows key, type powershell, press Enter, right-click in the window to paste, and press Enter."
                      : "The browser would not copy it. The command is selected below: press Ctrl+C, then paste it into PowerShell.",
                  );

                  if (!copied) {
                    fieldRef.current?.focus();
                    fieldRef.current?.select();
                  }
                }}
              >
                Copy the PowerShell command
              </FilledButton>
              <div style={hint}>
                The same thing without a file. Press the Windows key, type
                powershell, press Enter, right-click in the window to paste, and
                press Enter.
              </div>
            </div>

            <div style={wayRow}>
              {offer.ok ? (
                <a
                  href={offer.link}
                  data-testid="editor-setup-link"
                  onClick={() =>
                    setMessage(
                      "Your browser asks whether to open Windows PowerShell: choose Open. If nothing happens, the setup is not on this computer yet: use the file or the command once.",
                    )
                  }
                  style={linkButton}
                >
                  Open the setup window
                </a>
              ) : (
                <span
                  data-testid="editor-setup-link-off"
                  aria-disabled="true"
                  style={{ ...linkButton, opacity: 0.55 }}
                >
                  Open the setup window
                </span>
              )}
              <div style={hint}>
                Only after the file or the command has been used once on this
                computer. Your browser asks "Open Windows PowerShell?": choose
                Open. It saves the download and the paste.
              </div>
            </div>
          </div>

          <textarea
            ref={fieldRef}
            data-testid="editor-setup-command"
            readOnly
            rows={3}
            aria-label="The PowerShell command"
            value={offer.ok ? offer.command : ""}
            placeholder={
              usable ? "" : "Fix the problem above to get the command."
            }
            onFocus={(event) => event.currentTarget.select()}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 10,
              fontFamily: "Cascadia, Consolas, monospace",
              fontSize: 12,
              resize: "vertical",
            }}
          />
        </div>

        <div style={hint}>
          After the setup, use the editor window that opens on the profile.
          Leave the token field empty and press Connect: the editor asks you
          once whether to allow the board. An old board bridge that VS Code or
          VSCodium already has is updated too (an old one cannot answer the
          board, and it shows only part of the editor's window on a screen that
          is scaled).
        </div>

        {/* always in view, however small the window: what just happened, and Close */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 0 2px",
            background: "var(--island-bg-color, #fff)",
            borderTop: "1px solid var(--default-border-color, #ddd)",
          }}
        >
          <div role="status" data-testid="editor-setup-message" style={hint}>
            {message}
          </div>
          <FilledButton variant="outlined" onClick={onClose}>
            Close
          </FilledButton>
        </div>
      </div>
    </Dialog>
  );
};

/** shows the dialog while it is asked for (the main menu, or the mirror panel's "VS Code not found") */
export const EditorSetupHost = () => {
  const open = useAtomValue(editorSetupOpenAtom);

  return open ? <EditorSetupDialog onClose={closeEditorSetup} /> : null;
};
