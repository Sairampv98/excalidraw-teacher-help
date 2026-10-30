/**
 * The live **YouTube** surface of a panel (D-352).
 *
 * A YouTube panel is an iframe of YouTube's own player: a foreign document,
 * which cannot be drawn into a canvas, so a host cannot take a frame out of it
 * the way it takes one from a `<video>`. What the host can do is ask the
 * browser for the picture of the tab and cut the iframe's part out of it - and
 * for that it needs to know **where the iframe is**. This module keeps the way
 * back to it.
 *
 * The registry is a module-level map on purpose, like the video surface's: the
 * DOM element is not scene data and must not travel in the payload (D-46).
 */

/** the mounted iframe of every YouTube panel, by panel id */
const youtubeSurfaces = new Map<string, HTMLIFrameElement>();

/** Remembers the iframe the overlay mounted for a panel. */
export const registerYoutubeSurface = (
  panelId: string,
  frame: HTMLIFrameElement,
): void => {
  youtubeSurfaces.set(panelId, frame);
};

/** Forgets the iframe of a panel that is no longer on the screen. */
export const unregisterYoutubeSurface = (panelId: string): void => {
  youtubeSurfaces.delete(panelId);
};

/** The iframe of a YouTube panel, or null when the panel is not mounted. */
export const getYoutubeSurface = (panelId: string): HTMLIFrameElement | null =>
  youtubeSurfaces.get(panelId) ?? null;
