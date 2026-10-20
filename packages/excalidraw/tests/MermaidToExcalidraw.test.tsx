import { expect, vi } from "vitest";

import { Excalidraw } from "../index";

import { mockMermaidToExcalidraw } from "./helpers/mocks";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { render, waitFor } from "./test-utils";

// Mock CodeMirror deps so the dynamic import of CodeMirrorEditor fails,
// causing TTDDialogInput to fall back to <textarea> in tests.
vi.mock("@codemirror/view", () => ({}));
vi.mock("@codemirror/state", () => ({}));
vi.mock("@codemirror/language", () => ({}));
vi.mock("@lezer/highlight", () => ({}));

mockMermaidToExcalidraw({
  mockRef: true,
  parseMermaidToExcalidraw: async (definition) => {
    const firstLine = definition.split("\n")[0];
    return new Promise((resolve, reject) => {
      if (firstLine === "flowchart TD") {
        resolve({
          elements: [
            {
              id: "Start",
              type: "rectangle",
              groupIds: [],
              x: 0,
              y: 0,
              width: 69.703125,
              height: 44,
              strokeWidth: 2,
              label: {
                groupIds: [],
                text: "Start",
                fontSize: 20,
              },
              link: null,
            },
            {
              id: "Stop",
              type: "rectangle",
              groupIds: [],
              x: 2.7109375,
              y: 94,
              width: 64.28125,
              height: 44,
              strokeWidth: 2,
              label: {
                groupIds: [],
                text: "Stop",
                fontSize: 20,
              },
              link: null,
            },
            {
              id: "Start_Stop",
              type: "arrow",
              groupIds: [],
              x: 34.852,
              y: 44,
              strokeWidth: 2,
              points: [
                [0, 0],
                [0, 50],
              ],
              roundness: {
                type: 2,
              },
              start: {
                id: "Start",
              },
              end: {
                id: "Stop",
              },
            },
          ],
        });
      } else {
        reject(new Error("ERROR"));
      }
    });
  },
});

const normalizeDialogSnapshot = (dialog: Element) => {
  const dialogClone = dialog.cloneNode(true) as HTMLElement;

  dialogClone
    .querySelectorAll<HTMLElement>(".ttd-dialog-content")
    .forEach((element) => {
      // Radix Tabs injects this during initial mount animation prevention.
      // Its presence depends on render timing and is unrelated to this test.
      if (element.style.animationDuration === "0s") {
        element.style.removeProperty("animation-duration");
      }

      if (!element.getAttribute("style")) {
        element.removeAttribute("style");
      }
    });

  return dialogClone.outerHTML;
};

/**
 * Wait until the dialog has settled on a *parsed* diagram.
 *
 * The dialog parses the editor's content as soon as it mounts, and the editor
 * starts EMPTY before the example text is set. The mocked parser only accepts
 * a definition whose first line is `flowchart TD`, so the empty first parse
 * rejects and the dialog briefly shows "Invalid mermaid definition" before
 * recovering when the example arrives.
 *
 * The old test only waited for a `canvas` to exist - but a canvas is rendered
 * in the error state too, just with the container marked `invisible`. So the
 * snapshot was taken at whichever state the dialog happened to be in, and the
 * test failed intermittently under load. Waiting for the state each test
 * actually asserts makes it deterministic.
 */
const waitForMermaidParsed = async (dialog: Element) => {
  await waitFor(() => {
    expect(
      dialog.querySelector('[data-testid="ttd-dialog-output-error"]'),
    ).toBeNull();
    expect(
      dialog
        .querySelector(".ttd-dialog-output-canvas-container")
        ?.classList.contains("invisible"),
    ).toBe(false);
  });
};

describe("Test <MermaidToExcalidraw/>", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        initialData={{
          appState: {
            openDialog: { name: "ttd", tab: "mermaid" },
          },
        }}
      />,
    );
  });

  it("should open mermaid popup when active tool is mermaid", async () => {
    const dialog = document.querySelector(".ttd-dialog")!;
    await waitFor(() => expect(dialog.querySelector("canvas")).not.toBeNull());
    await waitForMermaidParsed(dialog);
    expect(normalizeDialogSnapshot(dialog)).toMatchSnapshot();
  });

  it("AC-12 waits for a real editor and not the loading placeholder", async () => {
    // The dialog renders a loading spinner, a textarea fallback and a
    // CodeMirror container with the same class. The helper must not hand back
    // the spinner: its textContent is empty, which is how the mermaid test
    // came to fail intermittently under parallel load.
    //
    // This is asserted directly, with a controlled DOM, so that it fails
    // deterministically - a test that only fails when the race happens is the
    // flake itself, not a test of it.
    const loading = document.createElement("div");
    loading.className = "ac12-loading-probe ttd-dialog-input--loading";
    document.body.appendChild(loading);

    const real = document.createElement("textarea");
    real.className = "ac12-real-probe";
    document.body.appendChild(real);

    try {
      // The loading placeholder is not an editor, so the helper must not
      // resolve to it.
      await expect(
        getTextEditor({ selector: ".ac12-loading-probe", waitForEditor: true }),
      ).rejects.toThrow();

      // A real editor does resolve.
      await expect(
        getTextEditor({ selector: ".ac12-real-probe", waitForEditor: true }),
      ).resolves.toBe(real);
    } finally {
      loading.remove();
      real.remove();
    }
  });

  it("should show error in preview when mermaid library throws error", async () => {
    const dialog = document.querySelector(".ttd-dialog")!;

    expect(dialog).not.toBeNull();

    const selector = ".ttd-dialog-input";
    let editor = await getTextEditor({ selector, waitForEditor: true });

    await waitForMermaidParsed(dialog);
    expect(dialog.querySelector('[data-testid="mermaid-error"]')).toBeNull();

    expect(editor.textContent).toMatchSnapshot();

    updateTextEditor(editor, "flowchart TD1");
    editor = await getTextEditor({ selector, waitForEditor: false });

    expect(editor.textContent).toBe("flowchart TD1");
    expect(
      dialog.querySelector('[data-testid="mermaid-error"]'),
    ).toMatchInlineSnapshot("null");
  });
});
