import { Fragment, useCallback, useEffect, useReducer, useRef } from "react";

import clsx from "clsx";

import { useExcalidrawStateValue } from "@excalidraw/excalidraw";

import "./edge-docks.scss";

import {
  DOCK_AUTO_HIDE_MS,
  DOCK_DEFINITIONS,
  DOCK_EDGE_GAP,
  DOCK_MOVE_BUTTON_SIZE,
  DOCK_OVERLAY_Z_INDEX,
  DOCK_REVEAL_PX,
  DOCK_RING_Z_INDEX,
  DOCK_SNAP_PX,
  DOCK_TARGET_Z_INDEX,
  readDockSnapshots,
  useEdgeDocksEnabled,
  writeDockSnapshots,
} from "./dockTypes";

import type { DockDefinition, DockEdge, DockId } from "./dockTypes";

type Rect = { x: number; y: number; w: number; h: number };

type DockRuntime = {
  def: DockDefinition;
  el: HTMLElement | null;
  rect: Rect;
  edge: DockEdge | null;
  phase: "open" | "pill";
  dragging: boolean;
  selected: boolean;
  /** the properties panel is always mounted but renders nothing until a shape is selected */
  empty: boolean;
  placed: boolean;
  /**
   * Last time *this* dock was used. Docks idle independently, so collapsing the
   * toolbar does not drag the properties panel down with it.
   */
  lastUsedAt: number;
};

/**
 * How far each dock's pill is tinted toward the canvas background. The toolbar
 * sits further back (darker) than the properties panel so the two pills stay
 * tellable apart at a glance.
 */
const DOCK_PILL_TINT: Record<DockId, number> = {
  toolbar: 0.62,
  properties: 0.3,
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
};

/**
 * Pill background: the island colour blended toward the canvas background, so
 * the pills pick up whatever canvas colour the user has chosen instead of
 * sitting on top of it as an opaque grey slab.
 */
const getPillBackground = (
  backgroundColor: string | undefined,
  tint: number,
): string | undefined => {
  const rgb = backgroundColor ? hexToRgb(backgroundColor) : null;
  if (!rgb) {
    // canvas background is transparent — let CSS handle it
    return undefined;
  }
  // `tint` is the share of the island colour to keep; the rest comes from the
  // canvas. 0 = pure canvas colour, 1 = pure island colour.
  return `color-mix(in srgb, var(--island-bg-color) ${Math.round(
    tint * 100,
  )}%, ${backgroundColor})`;
};

/** pointer travel, in px, before a press on the move button turns into a drag */
const DRAG_THRESHOLD_PX = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** keeps at least EDGE_GAP visible on both sides */
const clampToViewport = (rect: Rect): Rect => ({
  ...rect,
  x: clamp(
    rect.x,
    DOCK_EDGE_GAP,
    Math.max(DOCK_EDGE_GAP, window.innerWidth - rect.w - DOCK_EDGE_GAP),
  ),
  y: clamp(
    rect.y,
    DOCK_EDGE_GAP,
    Math.max(DOCK_EDGE_GAP, window.innerHeight - rect.h - DOCK_EDGE_GAP),
  ),
});

/**
 * Measures the visible panel.
 *
 * The Excalidraw panels are sized by an absolutely positioned island *inside*
 * the container, so the container itself measures 0x0 even while the panel is
 * fully rendered. Measuring the container alone is what made the properties
 * panel look permanently invisible — fall back to the island when the
 * container collapses.
 */
const measurePanel = (el: HTMLElement): Rect => {
  const bounds = el.getBoundingClientRect();

  if (bounds.width > 0 && bounds.height > 0) {
    return { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height };
  }

  const inner =
    el.querySelector<HTMLElement>(".Island") ??
    (el.firstElementChild as HTMLElement | null);

  if (inner) {
    const rect = inner.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    }
  }

  return { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height };
};

/** nothing to show: no children rendered (properties panel, nothing selected) */
const isPanelEmpty = (el: HTMLElement) => el.childElementCount === 0;

/** edges sorted by how far the panel currently is from them */
const candidateEdges = (rect: Rect): DockEdge[] => {
  const distances: Array<[DockEdge, number]> = [
    ["left", rect.x],
    ["right", window.innerWidth - (rect.x + rect.w)],
    ["top", rect.y],
    ["bottom", window.innerHeight - (rect.y + rect.h)],
  ];

  return distances.sort((a, b) => a[1] - b[1]).map(([edge]) => edge);
};

const nearestEdge = (rect: Rect): DockEdge | null => {
  const distances: Array<[DockEdge, number]> = [
    ["left", rect.x],
    ["right", window.innerWidth - (rect.x + rect.w)],
    ["top", rect.y],
    ["bottom", window.innerHeight - (rect.y + rect.h)],
  ];

  let best: DockEdge | null = null;
  let bestDistance = DOCK_SNAP_PX;

  for (const [edge, distance] of distances) {
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edge;
    }
  }

  return best;
};

const snapToEdge = (rect: Rect, edge: DockEdge): Rect => {
  const clamped = clampToViewport(rect);

  switch (edge) {
    case "left":
      return { ...clamped, x: DOCK_EDGE_GAP };
    case "right":
      return { ...clamped, x: window.innerWidth - clamped.w - DOCK_EDGE_GAP };
    case "top":
      return { ...clamped, y: DOCK_EDGE_GAP };
    case "bottom":
      return { ...clamped, y: window.innerHeight - clamped.h - DOCK_EDGE_GAP };
    default:
      return clamped;
  }
};

/** pill geometry for a collapsed dock, along its edge */
const getPillStyle = (dock: DockRuntime): React.CSSProperties => {
  const { rect, edge } = dock;
  const isVertical = edge === "left" || edge === "right";

  if (isVertical) {
    const height = clamp(rect.h, 96, 260);
    return {
      width: 12,
      height,
      [edge === "left" ? "left" : "right"]: 0,
      top: clamp(
        rect.y + rect.h / 2 - height / 2,
        12,
        window.innerHeight - height - 12,
      ),
    };
  }

  const width = clamp(rect.w, 140, 420);
  return {
    width,
    height: 12,
    [edge === "top" ? "top" : "bottom"]: 0,
    left: clamp(
      rect.x + rect.w / 2 - width / 2,
      12,
      window.innerWidth - width - 12,
    ),
  };
};

/**
 * The dedicated move button. It sits just outside the panel's top corner,
 * flipping to the other side when there is no room, so it never lands off
 * screen regardless of where the panel has been dragged.
 */
const getMoveButtonStyle = (dock: DockRuntime): React.CSSProperties => {
  const { rect } = dock;
  const size = DOCK_MOVE_BUTTON_SIZE;
  const gap = 8;
  const maxX = Math.max(4, window.innerWidth - size - 4);
  const maxY = Math.max(4, window.innerHeight - size - 4);

  let x = rect.x + rect.w + gap;
  if (x + size > maxX) {
    x = rect.x - size - gap;
  }
  if (x < 4) {
    x = rect.x + rect.w - size;
  }

  return {
    width: size,
    height: size,
    left: clamp(x, 4, maxX),
    top: clamp(rect.y + gap, 4, maxY),
  };
};

/**
 * Sits immediately under the move button, on the same outer side of the panel,
 * so the two controls read as one cluster.
 */
const getCollapseButtonStyle = (dock: DockRuntime): React.CSSProperties => {
  const move = getMoveButtonStyle(dock);
  const size = DOCK_MOVE_BUTTON_SIZE;

  return {
    width: size,
    height: size,
    left: move.left,
    top: clamp(Number(move.top) + size + 4, 4, window.innerHeight - size - 4),
  };
};

/** selection outline drawn around the panel (the panel's own box may be 0x0) */
const getRingStyle = (dock: DockRuntime): React.CSSProperties => ({
  left: dock.rect.x - 4,
  top: dock.rect.y - 4,
  width: dock.rect.w + 8,
  height: dock.rect.h + 8,
});

/**
 * Applies the dock's position to the real Excalidraw panel. The panel is taken
 * out of flow with `position: fixed` but otherwise left completely untouched,
 * so all native behaviour (tools, colour pickers, sliders) keeps working.
 */
const applyToElement = (dock: DockRuntime) => {
  const { el, rect, phase, dragging } = dock;
  if (!el) {
    return;
  }

  el.style.position = "fixed";
  el.style.margin = "0";
  el.style.zIndex = String(DOCK_TARGET_Z_INDEX);
  el.style.left = `${Math.round(rect.x)}px`;
  el.style.top = `${Math.round(rect.y)}px`;

  el.classList.toggle("excalidraw-dock-target", true);
  el.classList.toggle("excalidraw-dock-target--dragging", dragging);
  el.classList.toggle("excalidraw-dock-target--pill", phase === "pill");
  el.classList.toggle("excalidraw-dock-target--empty", dock.empty);
};

const releaseElement = (dock: DockRuntime) => {
  const { el } = dock;
  if (!el) {
    return;
  }
  el.classList.remove(
    "excalidraw-dock-target",
    "excalidraw-dock-target--dragging",
    "excalidraw-dock-target--pill",
    "excalidraw-dock-target--empty",
  );
  el.style.position = "";
  el.style.margin = "";
  el.style.zIndex = "";
  el.style.left = "";
  el.style.top = "";
  dock.el = null;
  dock.selected = false;
  dock.empty = false;
};

const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <g fill="currentColor">
      <circle cx="4.6" cy="2.6" r="1.35" />
      <circle cx="9.4" cy="2.6" r="1.35" />
      <circle cx="4.6" cy="7" r="1.35" />
      <circle cx="9.4" cy="7" r="1.35" />
      <circle cx="4.6" cy="11.4" r="1.35" />
      <circle cx="9.4" cy="11.4" r="1.35" />
    </g>
  </svg>
);

/** the dedicated "collapse this panel into a pill" button */
const CollapseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const EdgeDocks = () => {
  const { enabled } = useEdgeDocksEnabled();
  // pills tint themselves against whatever canvas background the user picked
  const { viewBackgroundColor } =
    useExcalidrawStateValue(["viewBackgroundColor"]) ?? {};

  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);
  const rerender = useCallback(() => forceUpdate(), []);

  const docksRef = useRef<Map<DockId, DockRuntime>>(
    new Map(
      DOCK_DEFINITIONS.map((def) => [
        def.id,
        {
          def,
          el: null,
          rect: { x: 0, y: 0, w: 0, h: 0 },
          edge: null,
          phase: "open" as const,
          dragging: false,
          selected: false,
          empty: true,
          placed: false,
          lastUsedAt: Date.now(),
        },
      ]),
    ),
  );

  const moveButtonRefs = useRef<Map<DockId, HTMLButtonElement | null>>(
    new Map(),
  );

  const lastActivityRef = useRef(Date.now());
  const viewportRef = useRef({ w: 0, h: 0 });
  const pointerHeldRef = useRef(false);
  const pressRef = useRef<{
    id: DockId;
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  const docks = DOCK_DEFINITIONS.map((def) => docksRef.current.get(def.id)!);

  const persist = useCallback(() => {
    const snapshots: Record<string, unknown> = {};
    for (const [id, dock] of docksRef.current) {
      if (!dock.placed) {
        continue;
      }
      snapshots[id] = {
        x: dock.rect.x,
        y: dock.rect.y,
        edge: dock.edge,
        phase: dock.phase,
        placed: dock.placed,
      };
    }
    writeDockSnapshots(snapshots);
  }, []);

  const setSelected = useCallback(
    (id: DockId | null) => {
      let changed = false;
      for (const dock of docksRef.current.values()) {
        const next = dock.def.id === id;
        if (dock.selected !== next) {
          dock.selected = next;
          changed = true;
        }
      }
      if (changed) {
        rerender();
      }
    },
    [rerender],
  );

  // ---------------------------------------------------------------------------
  // attach to the live Excalidraw panels
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      for (const dock of docksRef.current.values()) {
        releaseElement(dock);
      }
      return;
    }

    const stored = readDockSnapshots();

    const sync = () => {
      let changed = false;

      const viewportChanged =
        viewportRef.current.w !== window.innerWidth ||
        viewportRef.current.h !== window.innerHeight;
      viewportRef.current = {
        w: window.innerWidth,
        h: window.innerHeight,
      };

      for (const dock of docksRef.current.values()) {
        const el = document.querySelector<HTMLElement>(dock.def.selector);

        // panel unmounted (e.g. properties panel with nothing selected)
        if (dock.el && (!el || el !== dock.el || !el.isConnected)) {
          releaseElement(dock);
          changed = true;
          continue;
        }

        if (!el) {
          continue;
        }

        let needsApply = false;

        if (!dock.el) {
          const measured = measurePanel(el);
          const saved = stored[dock.def.id];

          dock.el = el;
          dock.empty = isPanelEmpty(el);
          dock.placed = !!saved?.placed;

          if (saved?.placed) {
            dock.rect = clampToViewport({
              ...measured,
              x: saved.x,
              y: saved.y,
            });
            dock.edge = saved.edge ?? null;
            dock.phase = saved.phase ?? "open";
          } else {
            // detach in place: freeze the panel exactly where it already sits
            dock.rect = clampToViewport(measured);
            dock.edge = null;
            dock.phase = "open";
          }

          needsApply = true;
        } else {
          const measured = measurePanel(dock.el);
          const wasEmpty = dock.empty;
          dock.empty = isPanelEmpty(dock.el);

          // A temporarily empty panel (properties panel with nothing selected)
          // must not shrink the dock's footprint, or its move button would
          // vanish exactly when you most want to drag it somewhere.
          let sizeChanged = false;
          if (
            (measured.w > 0 || measured.h > 0) &&
            (measured.w !== dock.rect.w || measured.h !== dock.rect.h)
          ) {
            dock.rect = { ...dock.rect, w: measured.w, h: measured.h };
            sizeChanged = true;
          }

          const emptyChanged = wasEmpty !== dock.empty;

          // the panel grew (properties panel filling in) or the window
          // resized — pull it back on screen, re-snapping edge-docked panels
          if (
            !dock.dragging &&
            !dock.selected &&
            (sizeChanged || viewportChanged)
          ) {
            const next = dock.edge
              ? snapToEdge(dock.rect, dock.edge)
              : clampToViewport(dock.rect);
            if (next.x !== dock.rect.x || next.y !== dock.rect.y) {
              dock.rect = next;
              needsApply = true;
            }
          }

          needsApply = needsApply || sizeChanged || emptyChanged;
        }

        if (needsApply) {
          applyToElement(dock);
          changed = true;
        }
      }

      if (changed) {
        rerender();
      }
    };

    const dockMap = docksRef.current;

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", sync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      for (const dock of dockMap.values()) {
        releaseElement(dock);
      }
    };
  }, [enabled, rerender]);

  // ---------------------------------------------------------------------------
  // move button: press to select, drag to move, release to drop
  // ---------------------------------------------------------------------------
  const startPress = useCallback(
    (id: DockId, event: React.PointerEvent<HTMLElement>) => {
      const dock = docksRef.current.get(id);
      if (!dock) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

      // grab relative to the pill when collapsed, to the corner when open
      const anchorX =
        dock.phase === "pill" ? dock.rect.x + dock.rect.w / 2 : dock.rect.x;
      const anchorY =
        dock.phase === "pill" ? dock.rect.y + dock.rect.h / 2 : dock.rect.y;

      pressRef.current = {
        id,
        grabX: event.clientX - anchorX,
        grabY: event.clientY - anchorY,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };

      dock.phase = "open";
      lastActivityRef.current = Date.now();
      rerender();
    },
    [rerender],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press) {
        return;
      }
      const dock = docksRef.current.get(press.id);
      if (!dock) {
        return;
      }

      if (!press.dragging) {
        const travelled = Math.hypot(
          event.clientX - press.startX,
          event.clientY - press.startY,
        );
        if (travelled < DRAG_THRESHOLD_PX) {
          return;
        }
        press.dragging = true;
        dock.dragging = true;
        dock.selected = true;
      }

      lastActivityRef.current = Date.now();
      dock.rect = clampToViewport({
        ...dock.rect,
        x: event.clientX - press.grabX,
        y: event.clientY - press.grabY,
      });
      applyToElement(dock);
      rerender();
    };

    const onPointerUp = () => {
      const press = pressRef.current;
      if (!press) {
        return;
      }
      pressRef.current = null;

      const dock = docksRef.current.get(press.id);
      if (!dock) {
        return;
      }

      dock.dragging = false;

      // released without moving — treat it as a click on the button
      if (!press.dragging) {
        const next = !dock.selected;
        setSelected(next ? press.id : null);
        applyToElement(dock);
        persist();
        rerender();
        return;
      }

      dock.placed = true;

      const edge = nearestEdge(dock.rect);
      if (edge) {
        dock.edge = edge;
        dock.rect = snapToEdge(dock.rect, edge);
      } else {
        dock.edge = null;
      }

      applyToElement(dock);
      persist();
      rerender();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [persist, rerender, setSelected]);

  // ---------------------------------------------------------------------------
  // click away / Escape deselects the dock
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const deselect = (target: EventTarget | null) => {
      let changed = false;
      for (const dock of docksRef.current.values()) {
        if (!dock.selected) {
          continue;
        }
        // keep it selected while you are actually using the panel or its button
        if (target instanceof Node) {
          if (dock.el?.contains(target)) {
            continue;
          }
          if (moveButtonRefs.current.get(dock.def.id)?.contains(target)) {
            continue;
          }
        }
        dock.selected = false;
        changed = true;
      }
      if (changed) {
        rerender();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      // our own button press resolves as a click on pointerup, not a deselect
      if (pressRef.current) {
        return;
      }
      deselect(event.target);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        deselect(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, rerender]);

  // ---------------------------------------------------------------------------
  // auto-hide + edge reveal
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const touchActivity = () => {
      lastActivityRef.current = Date.now();
    };

    /**
     * Credit activity to a single dock rather than all of them: a click inside
     * the toolbar keeps the toolbar alive but still lets an untouched
     * properties panel collapse, and vice versa. Canvas interaction counts as
     * toolbar use — you are working through the tools.
     */
    const creditDock = (target: EventTarget | null, now: number) => {
      for (const dock of docksRef.current.values()) {
        if (
          target instanceof Node &&
          (dock.el?.contains(target) ||
            moveButtonRefs.current.get(dock.def.id)?.contains(target))
        ) {
          dock.lastUsedAt = now;
          return;
        }
      }

      const tools = docksRef.current.get("toolbar");
      if (tools) {
        tools.lastUsedAt = now;
      }
    };

    const onPointerDownActivity = (event: PointerEvent) => {
      pointerHeldRef.current = true;
      const now = Date.now();
      creditDock(event.target, now);
      lastActivityRef.current = now;
    };

    const onPointerUpActivity = () => {
      pointerHeldRef.current = false;
      const now = Date.now();
      for (const dock of docksRef.current.values()) {
        if (dock.selected || dock.dragging) {
          dock.lastUsedAt = now;
        }
      }
      lastActivityRef.current = now;
    };

    const onPointerMoveActivity = (event: PointerEvent) => {
      const now = Date.now();
      lastActivityRef.current = now;
      creditDock(event.target, now);

      // hovering (pen included) near a collapsed edge pops it back out
      for (const dock of docksRef.current.values()) {
        if (dock.phase !== "pill" || !dock.edge) {
          continue;
        }
        const nearEdge =
          (dock.edge === "left" && event.clientX <= DOCK_REVEAL_PX) ||
          (dock.edge === "right" &&
            event.clientX >= window.innerWidth - DOCK_REVEAL_PX) ||
          (dock.edge === "top" && event.clientY <= DOCK_REVEAL_PX) ||
          (dock.edge === "bottom" &&
            event.clientY >= window.innerHeight - DOCK_REVEAL_PX);

        if (nearEdge) {
          dock.phase = "open";
          dock.lastUsedAt = Date.now();
          applyToElement(dock);
          persist();
          rerender();
        }
      }
    };

    document.addEventListener("pointermove", onPointerMoveActivity, {
      passive: true,
    });
    document.addEventListener("pointerdown", onPointerDownActivity, {
      passive: true,
    });
    document.addEventListener("pointerup", onPointerUpActivity, {
      passive: true,
    });
    document.addEventListener("keydown", touchActivity, { passive: true });

    const interval = setInterval(() => {
      const now = Date.now();

      if (now - lastActivityRef.current < DOCK_AUTO_HIDE_MS) {
        return;
      }

      // never collapse out from under the user
      if (pressRef.current || pointerHeldRef.current) {
        return;
      }
      // a dialog owns the screen — leave the chrome alone
      if (document.querySelector(".excalidraw-modal-container")) {
        return;
      }

      let changed = false;

      for (const dock of docksRef.current.values()) {
        if (dock.phase !== "open") {
          continue;
        }
        // each dock carries its own idle clock, so collapsing one leaves the
        // other alone
        if (now - dock.lastUsedAt < DOCK_AUTO_HIDE_MS) {
          continue;
        }
        // a selected dock stays put until it is deselected
        if (dock.selected) {
          continue;
        }
        if (dock.el?.matches(":hover")) {
          continue;
        }
        if (dock.el?.contains(document.activeElement)) {
          continue;
        }
        // a panel that was never measured is simply not on screen
        if (!dock.rect.w || !dock.rect.h) {
          continue;
        }

        if (!dock.edge) {
          // pick the closest edge, but never stack two docks on the same one
          const taken = new Set(
            [...docksRef.current.values()]
              .filter((other) => other !== dock && other.edge)
              .map((other) => other.edge),
          );
          const candidates = candidateEdges(dock.rect);
          const free = candidates.find((edge) => !taken.has(edge));

          dock.edge = free ?? dock.def.fallbackEdge;
          dock.rect = snapToEdge(dock.rect, dock.edge);
          dock.placed = true;
        }
        dock.phase = "pill";
        dock.lastUsedAt = now;
        applyToElement(dock);
        changed = true;
      }

      if (changed) {
        persist();
        rerender();
      }
    }, 400);

    return () => {
      document.removeEventListener("pointermove", onPointerMoveActivity);
      document.removeEventListener("pointerdown", onPointerDownActivity);
      document.removeEventListener("pointerup", onPointerUpActivity);
      document.removeEventListener("keydown", touchActivity);
      clearInterval(interval);
    };
  }, [enabled, persist, rerender]);

  /** explicit "turn this panel into a pill" — only ever affects one dock */
  const collapseDock = useCallback(
    (id: DockId) => {
      const dock = docksRef.current.get(id);
      if (!dock || dock.phase !== "open" || !dock.el) {
        return;
      }

      if (!dock.edge) {
        dock.edge = dock.def.fallbackEdge;
        dock.rect = snapToEdge(dock.rect, dock.edge);
        dock.placed = true;
      }

      dock.phase = "pill";
      dock.selected = false;
      applyToElement(dock);
      persist();
      rerender();
    },
    [persist, rerender],
  );

  if (!enabled) {
    return null;
  }

  return (
    <div className="excalidraw-dock-layer">
      {docks.map((dock) => {
        if (!dock.el || !dock.rect.w || !dock.rect.h) {
          return null;
        }

        if (dock.phase === "pill") {
          return (
            <button
              key={dock.def.id}
              type="button"
              className={clsx(
                "excalidraw-dock-pill",
                `excalidraw-dock-pill--${dock.edge ?? "free"}`,
              )}
              style={{
                ...getPillStyle(dock),
                zIndex: DOCK_OVERLAY_Z_INDEX,
                ...(getPillBackground(
                  viewBackgroundColor,
                  DOCK_PILL_TINT[dock.def.id],
                )
                  ? {
                      backgroundColor: getPillBackground(
                        viewBackgroundColor,
                        DOCK_PILL_TINT[dock.def.id],
                      ),
                    }
                  : {}),
              }}
              title={`${dock.def.label} — drag out to restore, hover the edge to peek`}
              aria-label={`${dock.def.label} panel, collapsed`}
              onPointerDown={(event) => startPress(dock.def.id, event)}
            />
          );
        }

        return (
          <Fragment key={dock.def.id}>
            {dock.selected && (
              <div
                className="excalidraw-dock-ring"
                style={{ ...getRingStyle(dock), zIndex: DOCK_RING_Z_INDEX }}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              ref={(node) => {
                moveButtonRefs.current.set(dock.def.id, node);
              }}
              className={clsx("excalidraw-dock-move", {
                "excalidraw-dock-move--selected": dock.selected,
              })}
              style={{
                ...getMoveButtonStyle(dock),
                zIndex: DOCK_OVERLAY_Z_INDEX,
              }}
              title={`${dock.def.label} — click to select, drag to move, click away to deselect`}
              aria-label={`Move ${dock.def.label} panel`}
              aria-pressed={dock.selected}
              onPointerDown={(event) => startPress(dock.def.id, event)}
            >
              <GripIcon />
            </button>
            <button
              type="button"
              className="excalidraw-dock-collapse"
              style={{
                ...getCollapseButtonStyle(dock),
                zIndex: DOCK_OVERLAY_Z_INDEX,
              }}
              title={`Collapse ${dock.def.label} into a pill`}
              aria-label={`Collapse ${dock.def.label} panel`}
              onClick={(event) => {
                event.stopPropagation();
                collapseDock(dock.def.id);
              }}
            >
              <CollapseIcon />
            </button>
          </Fragment>
        );
      })}
    </div>
  );
};
