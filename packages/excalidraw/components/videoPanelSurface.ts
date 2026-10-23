/**
 * The live **video** surface of a panel.
 *
 * A video panel is a real `<video>` element in the page — it is interactive, so
 * it cannot be painted onto the canvas (the same reason an animated image
 * cannot). The overlay mounts it; this module keeps the way back to it, so the
 * **lock transition** can freeze the frame the teacher is looking at.
 *
 * The registry is a module-level map on purpose: the DOM element is not scene
 * data, it cannot be serialised, and it must not travel in the payload
 * (D-46). It is keyed by the panel's element id, which is stable across a
 * page switch and a reload.
 */

/** the mounted `<video>` of every live video panel, by panel id */
const videoSurfaces = new Map<string, HTMLVideoElement>();

/**
 * Remembers the `<video>` the overlay mounted for a panel.
 *
 * The overlay calls this when the surface is mounted and `unregister…` when it
 * goes away, so the map never holds a surface of a panel that is not on the
 * screen.
 */
export const registerVideoSurface = (
  panelId: string,
  video: HTMLVideoElement,
): void => {
  videoSurfaces.set(panelId, video);
};

/** Forgets the `<video>` of a panel that is no longer on the screen. */
export const unregisterVideoSurface = (panelId: string): void => {
  videoSurfaces.delete(panelId);
};

/** The `<video>` of a panel, or null when the panel is not mounted. */
export const getVideoSurface = (panelId: string): HTMLVideoElement | null =>
  videoSurfaces.get(panelId) ?? null;

/**
 * A frame of a video, at the video's **own** size.
 *
 * The size is the video's **intrinsic** size — `videoWidth` × `videoHeight`,
 * the size the video itself has — and never the size the panel happens to be
 * shown at on the canvas. A panel shown at 400×300 whose video is 1920×1080
 * must produce a 1920×1080 poster; a poster taken from the on-canvas size is a
 * thumbnail, and a thumbnail is not a poster (the poster rule of
 * `scene/lockPanel.ts`).
 *
 * `null` when the frame cannot be taken yet: the video has not told the
 * browser its size (`videoWidth` is 0 until the metadata is in), or the canvas
 * is not available. The caller then leaves the panel live and says why.
 */
export const captureVideoFrame = (
  video: HTMLVideoElement,
): { dataURL: string; width: number; height: number } | null => {
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    return null;
  }

  const canvas = document.createElement("canvas");

  // the intrinsic size, not the displayed size
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);

  return { dataURL: canvas.toDataURL("image/png"), width, height };
};

/**
 * A frame of a video, taken **after** the video was paused (D-102).
 *
 * The owner asked for the paused frame: "for video that should pause the video".
 * So the pause comes **first**, and the frame is drawn after it - a frame
 * drawn while the video is still running is a frame of a moment the teacher
 * never saw.
 *
 * The pause is the video's own: `pause()` is the only way to hold a frame, and
 * it is what the teacher would have done with the space bar.
 *
 * `null` when the frame cannot be taken - the same rule as
 * `captureVideoFrame`: the caller then leaves the panel live and says why.
 */
export const capturePausedVideoFrame = (
  video: HTMLVideoElement,
): { dataURL: string; width: number; height: number } | null => {
  video.pause();

  return captureVideoFrame(video);
};
