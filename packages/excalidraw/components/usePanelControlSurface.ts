import { useCallback, useEffect, useRef, useState } from "react";

import {
  PANEL_MOD_ALT,
  PANEL_MOD_CTRL,
  PANEL_MOD_SHIFT,
  PANEL_MOVE_INTERVAL_MS,
  isReleaseChord,
  panelKeyEvent,
  panelTextEvents,
  panelWheelNotches,
} from "../scene/panelControl";
import { panelPointInView, panelPointToWindow } from "../scene/panelMirror";

import type { PanelInputEvent } from "../scene/panelControl";
import type { PanelMirrorRegion } from "../scene/panelMirror";

/**
 * The **surface** of the control: what the teacher does over the view of the
 * editor's window, turned into events for it (D-323, D-324).
 *
 * It is the view's own box that is read - the box is what the teacher points
 * into, whatever the canvas's zoom and whatever the size of the panel - and a
 * place in it goes through the region that is shown to become a place in the
 * whole window.
 *
 * The rules this keeps:
 *
 *  - **nothing is sent unless Control is on**;
 *  - **the keys go only when the view has the keyboard** - after the teacher
 *    clicked it - so the canvas keeps its own shortcuts while the teacher looks
 *    at the canvas, and the chord that gives the keyboard back is never sent;
 *  - a press **captures the pointer**, so a drag that leaves the view still
 *    ends at the view's edge and is not lost;
 *  - a move is sent at most {@link PANEL_MOVE_INTERVAL_MS} apart, and the last
 *    one always arrives.
 */
export interface PanelControlSurfaceOptions {
  /** the panel's id */
  panelId: string;
  /** is Control on? */
  enabled: boolean;
  /** the region the view shows, or null for the whole window */
  region: PanelMirrorRegion | null;
  /** the view's own box */
  boxRef: { readonly current: HTMLElement | null };
  /**
   * The picture's own size, when it is known.
   *
   * With no region the picture is fitted into the box without being stretched,
   * so it can have bars beside it or over and under it: the bars are not the
   * editor's window, and a press in one of them is not sent (D-324). A region's
   * view has the region's own shape, so it has none.
   */
  picture?: { width: number; height: number } | null;
  /** an event for the editor's window */
  onInput?: (panelId: string, event: PanelInputEvent) => void;
  /** the keyboard goes back to the canvas */
  onRelease?: () => void;
}

const BUTTONS = ["left", "middle", "right"] as const;

/** The modifiers of a pointer event, as a mask. */
const pointerModifiers = (event: {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): number =>
  (event.ctrlKey ? PANEL_MOD_CTRL : 0) |
  (event.shiftKey ? PANEL_MOD_SHIFT : 0) |
  (event.altKey ? PANEL_MOD_ALT : 0);

export const usePanelControlSurface = (options: PanelControlSurfaceOptions) => {
  const { enabled, boxRef } = options;

  /** the latest of everything, so a handler made earlier reads it as it is now */
  const latest = useRef(options);

  latest.current = options;

  /** does the view hold the keyboard? */
  const [engaged, setEngaged] = useState(false);

  /** how many buttons are down: a follow stands still while one is */
  const pressed = useRef(0);

  const lastMove = useRef(0);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMove = useRef<PanelInputEvent | null>(null);

  const send = useCallback((event: PanelInputEvent) => {
    latest.current.onInput?.(latest.current.panelId, event);
  }, []);

  /**
   * A place of the pointer as a place in the whole window (D-324).
   *
   * `strict` is for a press and for the wheel: a place outside the view of the
   * window - in a bar beside the picture - is no place, and nothing is sent. A
   * move or a release outside is held on the view's edge, so a drag that leaves
   * the view still ends at it.
   */
  const place = useCallback(
    (point: { clientX: number; clientY: number }, strict = false) => {
      const box = latest.current.boxRef.current;

      if (!box) {
        return null;
      }

      const rect = box.getBoundingClientRect();
      const { region, picture } = latest.current;
      let view = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      if (!region && picture && picture.width > 0 && picture.height > 0) {
        // the whole window is fitted into the box without being stretched
        const scale = Math.min(
          rect.width / picture.width,
          rect.height / picture.height,
        );
        const width = picture.width * scale;
        const height = picture.height * scale;

        view = {
          left: rect.left + (rect.width - width) / 2,
          top: rect.top + (rect.height - height) / 2,
          width,
          height,
        };
      }

      if (
        strict &&
        (point.clientX < view.left ||
          point.clientX > view.left + view.width ||
          point.clientY < view.top ||
          point.clientY > view.top + view.height)
      ) {
        return null;
      }

      return panelPointToWindow(
        region,
        panelPointInView(view, { x: point.clientX, y: point.clientY }),
      );
    },
    [],
  );

  const flushMove = useCallback(() => {
    moveTimer.current = null;

    const move = pendingMove.current;

    pendingMove.current = null;

    if (move) {
      lastMove.current = Date.now();
      send(move);
    }
  }, [send]);

  const dropMove = useCallback(() => {
    if (moveTimer.current !== null) {
      clearTimeout(moveTimer.current);
      moveTimer.current = null;
    }

    pendingMove.current = null;
  }, []);

  // Control off, or the panel gone: nothing is left waiting to be sent
  useEffect(() => {
    if (!enabled) {
      dropMove();
      pressed.current = 0;
      setEngaged(false);
    }

    return dropMove;
  }, [enabled, dropMove]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const button = BUTTONS[event.button];

    if (!latest.current.enabled || !button) {
      return;
    }

    const at = place(event, true);

    if (!at) {
      return;
    }

    // the view is the editor's now: no text is selected in it, no picture is
    // dragged out of it, and the canvas does not see the press
    event.preventDefault();
    event.stopPropagation();

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // a pointer that is gone cannot be captured, and the press still counts
    }

    // the view takes the keyboard: the teacher clicked it
    event.currentTarget.focus({ preventScroll: true });

    dropMove();
    pressed.current += 1;

    send({
      kind: "pointer",
      action: "down",
      ...at,
      button,
      mods: pointerModifiers(event),
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!latest.current.enabled) {
      return;
    }

    const at = place(event);

    if (!at) {
      return;
    }

    pendingMove.current = {
      kind: "pointer",
      action: "move",
      ...at,
      mods: pointerModifiers(event),
    };

    const wait = PANEL_MOVE_INTERVAL_MS - (Date.now() - lastMove.current);

    if (wait <= 0) {
      if (moveTimer.current !== null) {
        clearTimeout(moveTimer.current);
      }

      flushMove();
    } else if (moveTimer.current === null) {
      // the last move always arrives
      moveTimer.current = setTimeout(flushMove, wait);
    }
  };

  const release = (event: React.PointerEvent<HTMLElement>) => {
    const button = BUTTONS[event.button];

    if (!latest.current.enabled || !button) {
      return;
    }

    const at = place(event);

    if (!at) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // nothing to release
    }

    dropMove();
    pressed.current = Math.max(0, pressed.current - 1);

    send({
      kind: "pointer",
      action: "up",
      ...at,
      button,
      mods: pointerModifiers(event),
    });
  };

  const onKey =
    (action: "down" | "up") => (event: React.KeyboardEvent<HTMLElement>) => {
      if (!latest.current.enabled) {
        return;
      }

      // the view has the keyboard: the canvas does not hear a key of it
      event.stopPropagation();

      if (isReleaseChord(event.nativeEvent)) {
        // the one chord that is never sent: it gives the keyboard back
        event.preventDefault();

        if (action === "down") {
          event.currentTarget.blur();
          latest.current.onRelease?.();
        }

        return;
      }

      const key = panelKeyEvent(event.nativeEvent, action);

      if (key) {
        event.preventDefault();
        send(key);

        return;
      }

      // A printed character whose key is not in the table (a layout's own
      // key) goes as text - once, when it goes down.
      if (
        action === "down" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        [...event.key].length === 1
      ) {
        const [text] = panelTextEvents(event.key);

        if (text) {
          event.preventDefault();
          send(text);
        }
      }
    };

  const onCompositionEnd = (event: React.CompositionEvent<HTMLElement>) => {
    if (!latest.current.enabled) {
      return;
    }

    // what an input method committed goes as text
    for (const text of panelTextEvents(event.data)) {
      send(text);
    }
  };

  // The wheel needs a listener that may prevent the default, and React's is
  // passive - so it is added to the box itself. It goes into the editor's
  // window, and neither the page nor the canvas scrolls or zooms for it.
  useEffect(() => {
    const box = boxRef.current;

    if (!box || !enabled) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const at = place(event, true);

      if (!at) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      send({
        kind: "wheel",
        ...at,
        ...panelWheelNotches(event),
        mods: pointerModifiers(event),
      });
    };

    box.addEventListener("wheel", onWheel, { passive: false });

    return () => box.removeEventListener("wheel", onWheel);
  }, [boxRef, enabled, place, send]);

  return {
    /** does the view hold the keyboard? */
    engaged: enabled && engaged,
    /** is a button down? */
    isPressed: () => pressed.current > 0,
    /** the handlers of the view's box */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
        // a press that was taken away ends where it is
        if (!latest.current.enabled || pressed.current === 0) {
          return;
        }

        const at = place(event);

        dropMove();
        pressed.current = 0;

        if (at) {
          send({
            kind: "pointer",
            action: "up",
            ...at,
            button: "left",
            mods: pointerModifiers(event),
          });
        }
      },
      onKeyDown: onKey("down"),
      onKeyUp: onKey("up"),
      onCompositionEnd,
      onFocus: () => setEngaged(true),
      onBlur: () => setEngaged(false),
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
        if (latest.current.enabled) {
          event.preventDefault();
        }
      },
    },
  };
};
