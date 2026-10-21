/**
 * The sidebar is an overlay on top of the canvas, so it takes the pointer: a
 * click, a drag and a wheel gesture that begin in the strip the sidebar covers
 * never reach the canvas. It also keeps the keyboard focus, so the arrow keys
 * and Delete go to the sidebar instead of the canvas.
 *
 * The rule the owner asked for: once the user works on the canvas, the canvas
 * has the interaction. The sidebar gives it up on a click on the canvas and
 * takes it back when the pointer comes back over it.
 */

/** the sidebar island the library renders — the overlay above the canvas */
const SIDEBAR_SELECTOR = ".sidebar";

/** the editor container: the sidebar and the canvas both live inside it */
const CONTAINER_SELECTOR = ".excalidraw";

/**
 * The release is in force.
 *
 * It cannot live on the sidebar element: React renders that element again
 * whenever the app state changes, and the release has to survive it.
 */
let released = false;

const sidebarElement = () =>
  document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

/**
 * Whether the pointerdown landed on the canvas.
 *
 * The interactive canvas is the one that receives pointer input (the static
 * canvas beside it is `pointer-events: none`), but any canvas inside the
 * editor counts: the user clicked on the drawing surface either way.
 */
const isCanvasPointer = (target: EventTarget | null) =>
  target instanceof HTMLCanvasElement && !!target.closest(CONTAINER_SELECTOR);

/**
 * Whether the pointer is over the sidebar.
 *
 * The rect, not `elementFromPoint`: an element with `pointer-events: none` is
 * never returned by `elementFromPoint`, so a released sidebar could never be
 * found again.
 */
const pointerIsOverSidebar = (
  sidebar: HTMLElement,
  x: number,
  y: number,
): boolean => {
  const rect = sidebar.getBoundingClientRect();

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

/**
 * The sidebar gives up the pointer to the canvas.
 */
const applyRelease = (sidebar: HTMLElement) => {
  if (sidebar.style.pointerEvents !== "none") {
    sidebar.style.pointerEvents = "none";
  }
};

/**
 * The sidebar gives up the pointer and the keyboard to the canvas.
 */
export const releaseSidebar = () => {
  const sidebar = sidebarElement();

  if (!sidebar) {
    return;
  }

  released = true;

  // the wheel, the click and the drag that begin in the strip the sidebar
  // covers now reach the canvas
  applyRelease(sidebar);

  // the keyboard: a control inside the sidebar must not keep the focus, or
  // the arrow keys and Delete go to it instead of the canvas
  const active = document.activeElement;

  if (active instanceof HTMLElement && sidebar.contains(active)) {
    active.blur();

    // the canvas keeps the keyboard — the editor container is the element the
    // editor listens on
    sidebar
      .closest<HTMLElement>(CONTAINER_SELECTOR)
      ?.focus({ preventScroll: true });
  }
};

/**
 * The sidebar takes the pointer back.
 */
export const restoreSidebar = () => {
  released = false;

  const sidebar = sidebarElement();

  if (!sidebar) {
    return;
  }

  // back to the stylesheet, which points the sidebar at the pointer
  if (sidebar.style.pointerEvents === "none") {
    sidebar.style.pointerEvents = "";
  }
};

/**
 * Installs the release. Returns the uninstall.
 */
export const installSidebarRelease = () => {
  const onPointerDown = (event: Event) => {
    if (!isCanvasPointer(event.target)) {
      return;
    }

    releaseSidebar();
  };

  const onPointerMove = (event: MouseEvent) => {
    const sidebar = sidebarElement();

    if (!sidebar || !released) {
      return;
    }

    if (pointerIsOverSidebar(sidebar, event.clientX, event.clientY)) {
      restoreSidebar();
      return;
    }

    // the sidebar element is rendered again when the app state changes, so
    // the release is applied to whatever is on the screen now
    applyRelease(sidebar);
  };

  // the capture phase: the sidebar has to be released before anything else
  // sees the pointer
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
  };
};
