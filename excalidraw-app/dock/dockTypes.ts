import { useCallback, useState } from "react";

/**
 * Edge-docking for the editor chrome.
 *
 * The stock Excalidraw panels (tool dock + selected-shape properties) live in
 * the top-left cluster and are pinned there. This lets them be dragged
 * anywhere, snapped to a screen edge, collapsed into a slim pill, and
 * auto-hidden while you draw — Android edge-panel behaviour.
 */

export type DockId = "toolbar" | "properties";

export type DockEdge = "left" | "right" | "top" | "bottom";

/** `open` = panel visible, `pill` = collapsed to the edge handle */
export type DockPhase = "open" | "pill";

export type DockSnapshot = {
  /** viewport px of the panel's top-left corner while open */
  x: number;
  y: number;
  edge: DockEdge | null;
  phase: DockPhase;
  /** false until the user has dragged it somewhere */
  placed: boolean;
};

export type DockDefinition = {
  id: DockId;
  selector: string;
  label: string;
  /** edge used when the dock auto-hides without having been snapped */
  fallbackEdge: DockEdge;
};

export const DOCK_DEFINITIONS: readonly DockDefinition[] = [
  {
    id: "toolbar",
    selector: ".App-toolbar",
    label: "Tools",
    fallbackEdge: "bottom",
  },
  {
    id: "properties",
    selector: ".selected-shape-actions-container",
    label: "Properties",
    fallbackEdge: "left",
  },
];

export const DOCK_STORAGE_KEY = "excalidraw-edge-docks-v1";

/** idle time before open docks collapse into pills */
export const DOCK_AUTO_HIDE_MS = 3500;

/** how close a dock's pointer may get to its edge before it pops back out */
export const DOCK_REVEAL_PX = 26;

/** pointer-up distance to an edge that triggers snapping */
export const DOCK_SNAP_PX = 140;

export const DOCK_EDGE_GAP = 6;

export const DOCK_TARGET_Z_INDEX = 70;
export const DOCK_OVERLAY_Z_INDEX = 80;
/** selection outline sits just under the move button, over the panel */
export const DOCK_RING_Z_INDEX = 75;

/** edge length of the dedicated move button */
export const DOCK_MOVE_BUTTON_SIZE = 28;

export const readDockSnapshots = (): Partial<Record<DockId, DockSnapshot>> => {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<Record<DockId, DockSnapshot>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const writeDockSnapshots = (
  snapshots: Partial<Record<DockId, DockSnapshot>>,
) => {
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // private mode / quota — positions simply won't persist
  }
};

export const DOCKS_ENABLED_STORAGE_KEY = "excalidraw-edge-docks-enabled";

/** master switch, persisted across sessions */
export const useEdgeDocksEnabled = () => {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return localStorage.getItem(DOCKS_ENABLED_STORAGE_KEY) !== "false";
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DOCKS_ENABLED_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { enabled, toggle };
};
