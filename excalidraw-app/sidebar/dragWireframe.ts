/**
 * The **loading wireframe** (D-98).
 *
 * A video takes a moment to be read and stored, so the canvas shows a
 * wireframe rectangle of the player at the drop point while that happens, and
 * the real panel replaces it. The wireframe is the app's own overlay, it is
 * removed when the insert finishes **or fails**, and it is never left behind.
 *
 * Its size is the panel's **fallback** size: the video's own size is not known
 * until it has been read, and a wireframe that guesses is still honest about
 * where the player will land.
 */

/** the class the app's stylesheet gives the wireframe */
const WIREFRAME_CLASS = "app-video-wireframe";

let wireframe: HTMLDivElement | null = null;

/**
 * Puts the wireframe on the canvas, centred on the release point.
 *
 * The size is in **screen** pixels: the panel is drawn at the canvas's zoom,
 * so the wireframe has to be scaled by it too or it would not stand where the
 * player will land.
 */
export const showVideoWireframe = ({
  clientX,
  clientY,
  width,
  height,
}: {
  /** the release point, in screen pixels */
  clientX: number;
  clientY: number;
  /** the player's width on the screen, in screen pixels */
  width: number;
  /** the player's height on the screen, in screen pixels */
  height: number;
}) => {
  hideVideoWireframe();

  const element = document.createElement("div");

  element.className = WIREFRAME_CLASS;
  element.dataset.testid = "video-wireframe";
  element.setAttribute("role", "status");
  element.textContent = "Loading the video...";

  element.style.left = `${clientX - width / 2}px`;
  element.style.top = `${clientY - height / 2}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;

  document.body.appendChild(element);

  wireframe = element;
};

/** takes the wireframe off the canvas */
export const hideVideoWireframe = () => {
  wireframe?.remove();
  wireframe = null;
};

/** whether the wireframe is on the canvas right now */
export const videoWireframeShown = () => wireframe !== null;
