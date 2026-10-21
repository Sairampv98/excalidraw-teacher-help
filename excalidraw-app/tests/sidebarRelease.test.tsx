import { fireEvent, render, waitFor } from "@testing-library/react";
import { Excalidraw } from "@excalidraw/excalidraw";

import { AppSidebar } from "../components/AppSidebar";
import { installSidebarRelease } from "../sidebar/sidebarRelease";

/**
 * The sidebar is an overlay on the canvas, so it takes the pointer and the
 * keyboard while it is open. The owner's rule is that the canvas has the
 * interaction once the user works on it: the sidebar gives the wheel and the
 * keyboard up, and takes them back when the pointer comes back over it.
 */
describe("the sidebar releases the canvas", () => {
  /**
   * The editor as the app renders it: the container, the canvas it draws on
   * and the sidebar island over it. jsdom has no layout, so the boxes are
   * stubbed — the same way the other app tests stub them.
   */
  const buildEditor = () => {
    const container = document.createElement("div");
    container.className = "excalidraw";
    container.tabIndex = 0;

    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    container.appendChild(canvas);

    const sidebar = document.createElement("div");
    sidebar.className = "sidebar";
    sidebar.getBoundingClientRect = () =>
      ({
        left: 900,
        top: 0,
        right: 1200,
        bottom: 600,
        width: 300,
        height: 600,
        x: 900,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);

    const button = document.createElement("button");
    sidebar.appendChild(button);

    container.appendChild(sidebar);
    document.body.appendChild(container);

    return { container, canvas, sidebar, button };
  };

  it("AC-79 after a click on the canvas the sidebar holds neither the focus nor the wheel", () => {
    const { container, canvas, sidebar, button } = buildEditor();

    const uninstall = installSidebarRelease();

    try {
      // a control inside the sidebar holds the keyboard
      button.focus();

      expect(document.activeElement).toBe(button);

      // the click on the canvas
      fireEvent.pointerDown(canvas);

      // the sidebar no longer takes the pointer, so the wheel and the clicks
      // in the strip it covers reach the canvas
      expect(sidebar.style.pointerEvents).toBe("none");

      // and no control inside it keeps the keyboard
      expect(sidebar.contains(document.activeElement)).toBe(false);

      // the canvas has it
      expect(document.activeElement).toBe(container);

      // the pointer comes back over the sidebar: it takes the pointer back
      document.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 1100,
          clientY: 100,
        }),
      );

      expect(sidebar.style.pointerEvents).toBe("");
    } finally {
      uninstall();
      container.remove();
    }
  });

  it("the app's sidebar installs the release", async () => {
    render(
      <Excalidraw>
        <AppSidebar
          width={302}
          dragging={false}
          onResizePointerDown={() => {}}
          onResetWidth={() => {}}
          autoFitEnabled={false}
          onToggleAutoFit={() => {}}
        />
      </Excalidraw>,
    );

    // the app pins the sidebar open on load
    await waitFor(() =>
      expect(document.querySelector(".sidebar")).toBeTruthy(),
    );

    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;

    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.interactive",
    )!;

    expect(canvas).toBeTruthy();

    // the click on the canvas
    fireEvent.pointerDown(canvas);

    // the sidebar gives the pointer up. (jsdom has no viewport, so the
    // library closes the sidebar on the same click — the element the release
    // was applied to is the one the assertions read.)
    expect(sidebar.style.pointerEvents).toBe("none");
  });
});
