import { useCallback, useEffect, useRef } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { PanelCapture } from "@excalidraw/excalidraw";
import type {
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  createPresenterChannel,
  getPresenterCamera,
  isPresenterFileWithinLimit,
  isPresenterSupported,
  presenterFileTooLargeMessage,
  PRESENTER_STALE_MS,
} from "./presenterChannel";

import type { PresenterPointer } from "./presenterChannel";

/**
 * ~25fps. Drawing updates are coalesced down to this rate so that the editor's
 * `onChange` hot path never does more than a couple of ref writes, and the
 * projector still feels live while we sketch.
 */
export const PRESENTER_PUBLISH_INTERVAL_MS = 40;

/**
 * Idle keep-alive. The editor deliberately stops publishing while nothing
 * changes (that is what keeps the `onChange` hot path cheap), but the presenter
 * treats "no message for PRESENTER_UNRESPONSIVE_MS" as a dead editor — so
 * without this it would show "Editor not responding" a few seconds after you
 * stop drawing, with the editor perfectly alive.
 *
 * Only runs while a presenter is actually connected.
 */
export const PRESENTER_KEEPALIVE_INTERVAL_MS = 1500;

/**
 * Pointer updates are coalesced separately from the scene and slightly faster
 * (~33fps): the laser trail is drawn from these points, so it needs a denser
 * stream than a 25fps scene mirror to read as a smooth stroke — but it still
 * has to stay cheap, because this fires on every single `pointermove`.
 */
export const PRESENTER_POINTER_INTERVAL_MS = 30;

/**
 * Editor-side half of the presenter mirror.
 *
 * `publishScene()` is called from `App.tsx`'s `onChange` and is intentionally
 * cheap: it stores the latest snapshot in a ref and (only when a presenter is
 * actually listening) schedules a throttled post.
 */
export const usePresenterBroadcaster = (pagesEnabled = false) => {
  const excalidrawAPI = useExcalidrawAPI();

  // kept in a ref so the mount-once channel effect always reads current values
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(excalidrawAPI);
  apiRef.current = excalidrawAPI;

  const channelRef = useRef<BroadcastChannel | null>(null);
  const presentersRef = useRef<Map<string, number>>(new Map());
  // kept in a ref so the mount-once channel effect always reads the current value
  const pagesEnabledRef = useRef(pagesEnabled);
  pagesEnabledRef.current = pagesEnabled;
  const sceneRef = useRef<{
    elements: readonly OrderedExcalidrawElement[];
    appState: AppState;
  } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentAtRef = useRef(0);
  const pointerRef = useRef<PresenterPointer | null>(null);
  const pointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerSentAtRef = useRef(0);
  // the live view's descriptor, per panel id (D-101). The presenter is a
  // second JavaScript context, so the registry that holds the descriptor is
  // empty there: the editor hands it over, and the presenter writes it into
  // its own registry.
  const liveViewsRef = useRef<Map<string, PanelCapture>>(new Map());

  const hasPresenters = () => presentersRef.current.size > 0;

  const sendScene = useCallback(() => {
    const channel = channelRef.current;
    const api = apiRef.current;

    if (!channel || !api || api.isDestroyed) {
      return;
    }

    // a presenter may hand shake before the first onChange (e.g. while the
    // scene is still loading) — read straight from the editor in that case
    const scene = sceneRef.current ?? {
      elements: api.getSceneElementsIncludingDeleted(),
      appState: api.getAppState(),
    };

    try {
      channel.postMessage({
        type: "presenter:scene",
        scene: {
          elements: scene.elements,
          camera: getPresenterCamera(scene.appState, pagesEnabledRef.current),
        },
      });
      lastSentAtRef.current = Date.now();
    } catch (error) {
      // structured clone can throw on unexpectedly exotic elements — dropping a
      // single frame is better than breaking the editor
      console.error("presenter: failed to publish scene", error);
    }
  }, []);

  // leading edge when idle (instant mirror), trailing edge while drawing
  const scheduleSend = useCallback(() => {
    if (flushTimerRef.current !== null) {
      return;
    }

    if (Date.now() - lastSentAtRef.current >= PRESENTER_PUBLISH_INTERVAL_MS) {
      sendScene();
      return;
    }

    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      sendScene();
    }, PRESENTER_PUBLISH_INTERVAL_MS);
  }, [sendScene]);

  const sendPointer = useCallback(() => {
    const channel = channelRef.current;
    const pointer = pointerRef.current;

    pointerTimerRef.current = null;

    if (!channel || !pointer) {
      return;
    }

    try {
      channel.postMessage({ type: "presenter:pointer", pointer });
      lastPointerSentAtRef.current = Date.now();
    } catch (error) {
      // dropping one pointer sample is harmless; throwing would break the
      // editor's pointermove path
      console.error("presenter: failed to publish pointer", error);
    }
  }, []);

  // same leading/trailing throttle as the scene, on its own clock
  const schedulePointerSend = useCallback(() => {
    if (pointerTimerRef.current !== null) {
      return;
    }

    if (
      Date.now() - lastPointerSentAtRef.current >=
      PRESENTER_POINTER_INTERVAL_MS
    ) {
      sendPointer();
      return;
    }

    pointerTimerRef.current = setTimeout(
      sendPointer,
      PRESENTER_POINTER_INTERVAL_MS,
    );
  }, [sendPointer]);

  const sendFiles = useCallback((presenterId: string, fileIds: FileId[]) => {
    const channel = channelRef.current;
    const api = apiRef.current;

    if (!channel || !api || api.isDestroyed || !fileIds.length) {
      return;
    }

    const files = api.getFiles();
    const payload = fileIds
      .map((fileId) => files[fileId])
      .filter((file) => file != null);

    if (!payload.length) {
      return;
    }

    // the size guard: a video is big, and the channel posts the whole file in
    // one frame. A file that is too big is **refused with a clear error**, not
    // dropped silently (D-58).
    const sendable = payload.filter((file) => {
      if (isPresenterFileWithinLimit(file)) {
        return true;
      }

      console.error(`presenter: ${presenterFileTooLargeMessage(file)}`);

      return false;
    });

    if (!sendable.length) {
      return;
    }

    try {
      channel.postMessage({
        type: "presenter:files",
        presenterId,
        files: sendable,
      });
    } catch (error) {
      console.error("presenter: failed to send files", error);
    }
  }, []);

  /**
   * Hand the live view's **descriptor** to the presenter (D-101).
   *
   * The picture never travels: it is served as an MJPEG stream from the
   * extension, and the panel plays that stream in a plain `<img>`. What the
   * presenter cannot guess is the descriptor - the capture's state and the
   * stream's URL - because the registry that holds it lives in the editor's
   * own JavaScript context.
   */
  const sendLiveView = useCallback((panelId: string, capture: PanelCapture) => {
    const channel = channelRef.current;

    if (!channel) {
      return;
    }

    try {
      channel.postMessage({ type: "presenter:live-view", panelId, capture });
    } catch (error) {
      // the descriptor is small and plain, so this should never happen - but a
      // failed hand-over must not break the editor's capture path
      console.error("presenter: failed to publish the live view", error);
    }
  }, []);

  useEffect(() => {
    if (!isPresenterSupported()) {
      return;
    }

    const channel = createPresenterChannel((message) => {
      switch (message.type) {
        case "presenter:hello": {
          const now = Date.now();
          presentersRef.current.set(message.presenterId, now);

          // drop presenters that went away without a `bye` (closed tab, crash)
          for (const [presenterId, lastSeenAt] of presentersRef.current) {
            if (now - lastSeenAt > PRESENTER_STALE_MS) {
              presentersRef.current.delete(presenterId);
            }
          }

          // answer immediately so a freshly opened (or reloaded) presenter
          // window does not have to wait for the next edit
          sendScene();

          // and the live view's descriptor goes with it: a presenter that
          // connects after the bridge is already streaming would otherwise
          // show nothing until the next capture state (D-101)
          for (const [panelId, capture] of liveViewsRef.current) {
            sendLiveView(panelId, capture);
          }
          break;
        }
        case "presenter:bye": {
          presentersRef.current.delete(message.presenterId);
          break;
        }
        case "presenter:files-request": {
          sendFiles(message.presenterId, message.fileIds);
          break;
        }
        default:
          break;
      }
    });

    channelRef.current = channel;

    const keepAlive = setInterval(() => {
      if (hasPresenters()) {
        sendScene();
      }
    }, PRESENTER_KEEPALIVE_INTERVAL_MS);

    return () => {
      clearInterval(keepAlive);
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (pointerTimerRef.current !== null) {
        clearTimeout(pointerTimerRef.current);
        pointerTimerRef.current = null;
      }
      // swap in a fresh map instead of mutating through the ref, so a stale
      // in-flight publish can't resurrect a disconnected presenter
      presentersRef.current = new Map();
      sceneRef.current = null;
      liveViewsRef.current = new Map();
      channelRef.current = null;
      channel?.close();
    };
  }, [sendFiles, sendLiveView, sendScene]);

  const publishScene = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      sceneRef.current = { elements, appState };

      // no presenter connected -> nothing to mirror, skip all IPC
      if (!hasPresenters()) {
        return;
      }

      scheduleSend();
    },
    [scheduleSend],
  );

  /**
   * Called from `onPointerUpdate`, which fires on every pointer move. Kept
   * symmetric with `publishScene`: stash first, skip all IPC when nobody is
   * listening.
   */
  const publishPointer = useCallback(
    (pointer: PresenterPointer) => {
      pointerRef.current = pointer;

      if (!hasPresenters()) {
        return;
      }

      schedulePointerSend();
    },
    [schedulePointerSend],
  );

  /**
   * Publish the live view's **descriptor** for one panel (D-101).
   *
   * The bridge's capture is the source: the editor publishes the descriptor
   * into its own registry, and this hands the same descriptor to the
   * presenter, which writes it into its own.
   */
  const publishLiveView = useCallback(
    (panelId: string, capture: PanelCapture) => {
      liveViewsRef.current.set(panelId, capture);

      // no presenter connected -> nothing to mirror, skip all IPC
      if (!hasPresenters()) {
        return;
      }

      sendLiveView(panelId, capture);
    },
    [sendLiveView],
  );

  return { publishScene, publishPointer, publishLiveView, hasPresenters };
};
