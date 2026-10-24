/**
 * What is **mirrored** of the editor's window, and the mode that moves it
 * (D-143).
 *
 * What is mirrored is a **choice**, and a choice can be changed as often as
 * the teacher changes their mind - so the region is a **setting**, not a
 * one-shot: the teacher can set it again and again, and the last one stands.
 *
 * The **whole window** is the default. A panel with no region set mirrors the
 * whole window - the same picture a screenshot gives - and the teacher's own
 * control, **change what is mirrored**, shows that whole window so they can
 * see what they are choosing.
 *
 * The region is measured in **fractions of the whole window**: 0 to 1 on each
 * axis. A region in fractions is the same region whatever size the window is,
 * so a window that is resized does not move the region out from under the
 * teacher.
 */

/** A part of the editor's window, in fractions of the window. */
export interface PanelMirrorRegion {
  /** the region's left edge, as a fraction of the window's width */
  x: number;
  /** the region's top edge, as a fraction of the window's height */
  y: number;
  /** the region's width, as a fraction of the window's width */
  width: number;
  /** the region's height, as a fraction of the window's height */
  height: number;
}

/**
 * What a panel mirrors, and whether the mirrored part follows the pointer.
 *
 * It is the **panel's own** setting: it is saved with the document, and it is
 * the panel's own - two panels can mirror two different parts of the editor's
 * window.
 */
export interface PanelMirror {
  /** the region that is mirrored, or `null` for the **whole** window */
  region: PanelMirrorRegion | null;
  /**
   * Whether the region **follows the pointer** inside the panel.
   *
   * It is a **mode**: it is off until the teacher turns it on, and they can
   * turn it off again.
   */
  follow: boolean;
}

/**
 * The region of the **whole** window: what is mirrored when the teacher has
 * chosen nothing.
 */
export const WHOLE_WINDOW: PanelMirrorRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

/** The mirror as it stands before anybody has chosen anything. */
export const INITIAL_PANEL_MIRROR: PanelMirror = {
  region: null,
  follow: false,
};

/**
 * A region's own number, rounded.
 *
 * The region's numbers are **places**, not calculations: they are compared,
 * saved with the document and sent over the bridge - so they are rounded to
 * six decimals, and a place that is the same place stays the same place.
 */
export const roundMirrorPlace = (value: number): number =>
  Math.round(value * 1e6) / 1e6;

/**
 * The region as it will be used: inside the window, and with an area.
 *
 * A region that reaches outside the window is pulled back inside it, and a
 * region with no area is **no region** - the whole window, which is the
 * default (D-143).
 */
export const normalizePanelMirrorRegion = (
  value: unknown,
): PanelMirrorRegion | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<PanelMirrorRegion>;

  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) {
    return null;
  }

  const width = roundMirrorPlace(Math.min(Math.max(candidate.width, 0), 1));
  const height = roundMirrorPlace(Math.min(Math.max(candidate.height, 0), 1));

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: roundMirrorPlace(Math.min(Math.max(candidate.x, 0), 1 - width)),
    y: roundMirrorPlace(Math.min(Math.max(candidate.y, 0), 1 - height)),
    width,
    height,
  };
};

/** Are two regions the same region? */
export const isSamePanelMirrorRegion = (
  a: PanelMirrorRegion | null | undefined,
  b: PanelMirrorRegion | null | undefined,
): boolean => {
  if (!a || !b) {
    return !a && !b;
  }

  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
};

/** The picture the region is a part of: the whole window's own size. */
export interface PanelMirrorPicture {
  /** the picture's own width, in its own pixels */
  width: number;
  /** the picture's own height, in its own pixels */
  height: number;
}

/**
 * The **window** the region is shown through.
 *
 * The panel shows one part of the editor's window, and the part it shows is
 * the region - so the picture is drawn **whole** behind a window that shows
 * only the region, and the window is cut out of the picture with the region's
 * own numbers.
 *
 * The numbers are percentages of the **window**, so the browser does the
 * arithmetic: the picture is `1 / region.width` times as wide as the window,
 * and it is pushed left by the region's own left edge.
 */
export interface PanelMirrorCrop {
  /** the window's own aspect ratio, as `width / height` */
  aspectRatio: string;
  /** the picture's width, as a percentage of the window's width */
  pictureWidth: string;
  /** the picture's height, as a percentage of the window's height */
  pictureHeight: string;
  /** how far the picture is pushed left, as a percentage of the window's width */
  pictureLeft: string;
  /** how far the picture is pushed up, as a percentage of the window's height */
  pictureTop: string;
  /**
   * The window's own size, in pixels.
   *
   * It is `null` when the panel's own area has not been measured yet - and the
   * window then takes its size from its aspect ratio alone.
   */
  windowWidth: number | null;
  windowHeight: number | null;
}

/**
 * The crop that shows the region and nothing else.
 *
 * `null` when there is no region - the whole window is mirrored then, and the
 * picture is shown as it is (D-143).
 *
 * The window's own shape is the **region's** shape in the picture's own
 * pixels, so the picture is never stretched: the region is shown at the shape
 * the teacher cropped, and the panel's own shape decides whether there is room
 * around it.
 *
 * The window is **fitted** into the panel's area: it is as big as it can be
 * without stretching the region, so a region that is wider than the panel's
 * area is shown in full, with room around it.
 */
export const panelMirrorCrop = (
  region: PanelMirrorRegion | null,
  picture: PanelMirrorPicture | null,
  /** the panel's own area, in pixels */
  area?: { width: number; height: number } | null,
): PanelMirrorCrop | null => {
  if (!region || !picture || !picture.width || !picture.height) {
    return null;
  }

  const regionWidth = region.width * picture.width;
  const regionHeight = region.height * picture.height;

  if (regionWidth <= 0 || regionHeight <= 0) {
    return null;
  }

  const aspect = regionWidth / regionHeight;

  let windowWidth: number | null = null;
  let windowHeight: number | null = null;

  if (area && area.width > 0 && area.height > 0) {
    // the window is as big as it can be without stretching the region
    windowWidth = Math.min(area.width, area.height * aspect);
    windowHeight = Math.min(area.height, area.width / aspect);
  }

  return {
    aspectRatio: `${regionWidth} / ${regionHeight}`,
    pictureWidth: `${100 / region.width}%`,
    pictureHeight: `${100 / region.height}%`,
    pictureLeft: `${(-region.x / region.width) * 100}%`,
    pictureTop: `${(-region.y / region.height) * 100}%`,
    windowWidth,
    windowHeight,
  };
};

/**
 * The region that follows the pointer (D-143).
 *
 * The region keeps its **size** and moves so that its middle is under the
 * pointer - so the teacher points at the part of the editor they are talking
 * about, and the panel shows it.
 *
 * The pointer's place is measured in the **window** the region is shown
 * through, so the pointer is read in the region's own terms: the middle of
 * the window is the middle of the region, and the edges are the edges.
 */
/**
 * The region that follows the pointer (D-143).
 *
 * The region keeps its **size** and moves so that its middle is under the
 * pointer - so the teacher points at the part of the editor they are talking
 * about, and the panel shows it.
 *
 * The pointer's place is measured in the **window** the region is shown
 * through, so the pointer is read in the region's own terms: the middle of
 * the window is the middle of the region, and the edges are the edges.
 */
export const panelMirrorRegionAtPointer = (
  region: PanelMirrorRegion,
  pointer: { x: number; y: number },
  window: { left: number; top: number; width: number; height: number },
): PanelMirrorRegion => {
  const withinX =
    window.width > 0
      ? Math.min(Math.max((pointer.x - window.left) / window.width, 0), 1)
      : 0.5;

  const withinY =
    window.height > 0
      ? Math.min(Math.max((pointer.y - window.top) / window.height, 0), 1)
      : 0.5;

  const centreX = region.x + withinX * region.width;
  const centreY = region.y + withinY * region.height;

  return {
    x: roundMirrorPlace(
      Math.min(Math.max(centreX - region.width / 2, 0), 1 - region.width),
    ),
    y: roundMirrorPlace(
      Math.min(Math.max(centreY - region.height / 2, 0), 1 - region.height),
    ),
    width: roundMirrorPlace(region.width),
    height: roundMirrorPlace(region.height),
  };
};

/**
 * The **picker**: the teacher's own control for what is mirrored (D-143).
 *
 * It shows the **whole** editor's window - the same picture a screenshot gives
 * - with the crop on it, so the teacher can see what they are choosing.
 *
 * The picker is a module-level store - never serialized, never inside an
 * element - owned by the **library**, in the same style as the pending
 * screenshot (D-102).
 */

/** The whole editor's window, as the picker shows it. */
export interface PanelMirrorPickerPicture extends PanelMirrorPicture {
  /**
   * Where the picture comes from.
   *
   * It is the extension's **snapshot** - one picture of the editor's whole
   * window, the very picture a screenshot gives - and not the live stream: the
   * picture comes from the teacher's own machine, and a second stream would
   * take the panel's own live view down with it.
   *
   * The capability in the URL is what authorises it (D-86), and an `<img>` is
   * what the browser allows across origins.
   */
  src: string;
}

/** The picker that is open. */
export interface PanelMirrorPicker {
  /** the panel the picker is for */
  panelId: string;
  /** the whole editor's window, as a picture */
  picture: PanelMirrorPickerPicture;
  /** the region being chosen, or `null` for the whole window */
  region: PanelMirrorRegion | null;
}

/** the pickers that are open, by the panel's id */
const pickers = new Map<string, PanelMirrorPicker>();

/** the panels that are watching. */
const listeners = new Set<() => void>();

const notify = () => {
  // a copy: a listener may unsubscribe while it is being called
  for (const listener of [...listeners]) {
    listener();
  }
};

/**
 * Open the picker for a panel.
 *
 * The picture is the **whole** editor's window: the teacher chooses a part of
 * what they can see (D-143).
 */
export const openPanelMirrorPicker = (
  panelId: string,
  picture: PanelMirrorPickerPicture,
  region: PanelMirrorRegion | null = null,
): void => {
  pickers.set(panelId, {
    panelId,
    picture,
    region: normalizePanelMirrorRegion(region),
  });

  notify();
};

/**
 * The region the teacher is choosing.
 *
 * It is the picker's own state: the choice is not made until the teacher says
 * so, and until then the panel keeps mirroring what it mirrored.
 */
export const setPanelMirrorPickerRegion = (
  panelId: string,
  region: PanelMirrorRegion | null,
): void => {
  const picker = pickers.get(panelId);

  if (!picker) {
    return;
  }

  pickers.set(panelId, {
    ...picker,
    region: normalizePanelMirrorRegion(region),
  });

  notify();
};

/** Close the picker, whatever the teacher decided in it. */
export const closePanelMirrorPicker = (panelId: string): void => {
  if (pickers.delete(panelId)) {
    notify();
  }
};

/**
 * The picker of a panel, or `null` when it has none.
 *
 * The object is the one that was published, so it keeps its identity until it
 * changes - which is what `useSyncExternalStore` needs to tell "the same
 * state" from "a new one".
 */
export const getPanelMirrorPicker = (
  panelId: string,
): PanelMirrorPicker | null => pickers.get(panelId) ?? null;

/**
 * The picker of **any** panel, or `null` when there is none.
 *
 * The picker stands for whichever choice is waiting to be made, and it does
 * not care which panel it is for - it cares that a choice is waiting.
 */
export const getAnyPanelMirrorPicker = (): PanelMirrorPicker | null => {
  for (const picker of pickers.values()) {
    return picker;
  }

  return null;
};

/** Watch the pickers. The returned function stops watching. */
export const subscribePanelMirrorPickers = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};
