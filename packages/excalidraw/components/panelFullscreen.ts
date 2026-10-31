/**
 * Shows the panel the button is in full screen, or leaves full screen (D-271).
 *
 * The browser's own full screen is used on the panel's element: only that
 * element is shown, the canvas is not, and Esc leaves.
 *
 * It is shared by the code editor and the VS Code mirror, so the two panels go
 * full screen the same way.
 */
export const toggleFullscreen = (button: HTMLElement) => {
  if (document.fullscreenElement) {
    void document.exitFullscreen?.();
    return;
  }

  void button
    .closest<HTMLElement>(".excalidraw__panel")
    ?.requestFullscreen?.()
    ?.catch(() => {
      // full screen was refused: the panel stays as it is
    });
};
