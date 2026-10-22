import { useCallback, useEffect, useRef, useState } from "react";

import clsx from "clsx";

import {
  CaptureUpdateAction,
  Excalidraw,
  setPanelCapture,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";

import { EVENT, THEME } from "@excalidraw/common";
import { isInitializedImageElement, isPanelElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import { STORAGE_KEYS } from "../app_constants";
import { registerMediaStore } from "../data/mediaStore";
import { useHandleAppTheme } from "../useHandleAppTheme";

import {
  createPresenterChannel,
  createPresenterId,
  isPresenterFileWithinLimit,
  isPresenterSupported,
  pointerCollaborators,
  presenterFileTooLargeMessage,
  PRESENTER_HEARTBEAT_MS,
  PRESENTER_WINDOW_NAME,
  resolvePresenterCamera,
} from "./presenterChannel";

import type {
  PresenterCamera,
  PresenterMessage,
  PresenterPointer,
  PresenterScene,
} from "./presenterChannel";

/** no updates for this long -> the editor window is probably gone */
const PRESENTER_UNRESPONSIVE_MS = 4000;

/** how long the "drag me to display 2" hint stays up */
const PRESENTER_HINT_TIMEOUT_MS = 9000;

/** retry a file request after this long (image may still be uploading) */
const FILE_REQUEST_RETRY_MS = 4000;

/** how often the presenter's canvas is re-measured while it settles on mount */
const MEASURE_SETTLE_MS = 120;

type PresenterStatus = "waiting" | "live" | "stale" | "unsupported";

/**
 * Read-only mirror of the editor window, meant to be dragged onto a second
 * display and run fullscreen while you draw on the first one.
 *
 * Everything chrome-like is hidden via CSS (`.excalidraw-app--presenter`), so
 * the projector only ever shows canvas.
 */
export const PresenterView = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const { editorTheme, setAppTheme } = useHandleAppTheme();

  const [status, setStatus] = useState<PresenterStatus>("waiting");
  const [showHint, setShowHint] = useState(true);
  const [pagesEnabled, setPagesEnabled] = useState(false);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(excalidrawAPI);
  apiRef.current = excalidrawAPI;

  const channelRef = useRef<BroadcastChannel | null>(null);
  const presenterIdRef = useRef(createPresenterId());
  const knownFilesRef = useRef(new Set<FileId>());
  const requestedFilesRef = useRef(new Set<FileId>());
  const pendingSceneRef = useRef<PresenterScene | null>(null);
  const lastSceneRef = useRef<PresenterScene | null>(null);
  const lastMessageAtRef = useRef(0);

  /**
   * This window's *measured* canvas size, in css px.
   *
   * `api.getAppState().width` is unusable for this: on a freshly mounted
   * presenter it still holds the size persisted by the editor session, and only
   * becomes correct once Excalidraw's own resize pass lands a frame or two
   * later. Scaling the mirrored zoom by that stale value is what made the
   * projector look magnified relative to the editor.
   */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef({ width: 0, height: 0 });
  const [viewportVersion, setViewportVersion] = useState(0);

  /**
   * Reads the live canvas box and bumps `viewportVersion` when it changed.
   *
   * Called from several places on purpose: the canvas is first laid out at a
   * placeholder size and only settles a frame or two later, and neither that
   * settle nor a later window resize is guaranteed to produce a
   * `ResizeObserver` callback on the host (the host itself is `100%` wide and
   * never changes size, so only the *canvas inside* moves).
   */
  const measureViewport = useCallback(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const canvas = host.querySelector("canvas");
    const rect = canvas?.getBoundingClientRect();
    const next = {
      width: Math.round(rect?.width || host.clientWidth || 0),
      height: Math.round(rect?.height || host.clientHeight || 0),
    };

    const previous = viewportRef.current;

    if (next.width === previous.width && next.height === previous.height) {
      return;
    }

    viewportRef.current = next;
    setViewportVersion((version) => version + 1);
  }, []);

  const post = useCallback((message: PresenterMessage) => {
    try {
      channelRef.current?.postMessage(message);
    } catch (error) {
      console.error("presenter: failed to post message", error);
    }
  }, []);

  const sendHello = useCallback(() => {
    post({ type: "presenter:hello", presenterId: presenterIdRef.current });
  }, [post]);

  const sendBye = useCallback(() => {
    post({ type: "presenter:bye", presenterId: presenterIdRef.current });
  }, [post]);

  const applyScene = useCallback(
    (scene: PresenterScene) => {
      const api = apiRef.current;

      // editor may still be mounting — replay as soon as the api shows up
      if (!api || api.isDestroyed) {
        pendingSceneRef.current = scene;
        return;
      }

      const { camera } = scene;
      lastSceneRef.current = scene;

      setPagesEnabled(camera.pagesEnabled);

      // the camera is derived from *our* measured viewport, never from the size
      // Excalidraw happens to report (see `viewportRef`)
      measureViewport();
      const resolved = resolvePresenterCamera(camera, viewportRef.current);

      api.updateScene({
        elements: scene.elements as readonly OrderedExcalidrawElement[],
        appState: {
          viewBackgroundColor: camera.viewBackgroundColor,
          gridModeEnabled: camera.gridModeEnabled,
          gridSize: camera.gridSize,
          isLoading: false,
          pages: camera.pages,
          currentPageId: camera.currentPageId,
          ...resolved,
        },
        // the projector must never pollute (or be able to undo) editor history
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [measureViewport],
  );

  /**
   * Pushes only the camera. Used when *our* viewport changed size (window
   * resize, projector resolution change) — the elements are untouched, but the
   * zoom has to be re-derived so both windows keep showing the same slice of
   * the page.
   */
  const applyCamera = useCallback(
    (camera: PresenterCamera) => {
      const api = apiRef.current;

      measureViewport();

      if (!api || api.isDestroyed || !viewportRef.current.width) {
        return;
      }

      const { scrollX, scrollY, zoom } = resolvePresenterCamera(
        camera,
        viewportRef.current,
      );

      api.updateScene({
        appState: { scrollX, scrollY, zoom },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [measureViewport],
  );

  /**
   * Draws the editor's laser on the projector.
   *
   * The trail is not an element, so there is nothing to mirror through the
   * scene — instead we publish one synthetic collaborator and let the library's
   * own `LaserTrails` build the stroke. That also means button-up ends the
   * trail and the stroke decays on its own, exactly like the local one.
   */
  const applyPointer = useCallback((pointer: PresenterPointer) => {
    const api = apiRef.current;

    if (!api || api.isDestroyed) {
      return;
    }

    api.updateScene({
      collaborators: pointerCollaborators(pointer),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  const requestMissingFiles = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      if (!channelRef.current) {
        return;
      }

      const missing: FileId[] = [];

      const ask = (fileId: FileId) => {
        if (
          knownFilesRef.current.has(fileId) ||
          requestedFilesRef.current.has(fileId)
        ) {
          return;
        }
        requestedFilesRef.current.add(fileId);
        missing.push(fileId);
      };

      for (const element of elements) {
        // an image element's own file
        if (isInitializedImageElement(element)) {
          ask(element.fileId);
          continue;
        }

        // a **panel's** file — a video panel's video. It is a file in the
        // document's own store, and the presenter asks for it exactly as it
        // asks for an image (D-58).
        if (isPanelElement(element) && element.panel.source.type === "file") {
          ask(element.panel.source.fileId);
        }
      }

      if (!missing.length) {
        return;
      }

      post({
        type: "presenter:files-request",
        presenterId: presenterIdRef.current,
        fileIds: missing,
      });

      // images may still be uploading in the editor — ask again later
      setTimeout(() => {
        for (const fileId of missing) {
          requestedFilesRef.current.delete(fileId);
        }
      }, FILE_REQUEST_RETRY_MS);
    },
    [post],
  );

  const handleMessage = useCallback(
    (message: PresenterMessage) => {
      lastMessageAtRef.current = Date.now();

      switch (message.type) {
        case "presenter:scene": {
          applyScene(message.scene);
          requestMissingFiles(message.scene.elements);
          break;
        }
        case "presenter:pointer": {
          applyPointer(message.pointer);
          break;
        }
        case "presenter:live-view": {
          // The live view's **descriptor** (D-101). The presenter is a second
          // JavaScript context, so the registry that holds the descriptor is
          // empty here - and the editor hands it over. The picture does not
          // travel: the panel plays the same stream, in a plain `<img>`.
          setPanelCapture(message.panelId, message.capture);
          break;
        }
        case "presenter:files": {
          const api = apiRef.current;
          if (!api || api.isDestroyed || !message.files.length) {
            break;
          }

          // the size guard: a file that is too big is **refused with a clear
          // error**, never added half-way (D-58)
          const accepted = message.files.filter((file) => {
            if (isPresenterFileWithinLimit(file)) {
              return true;
            }

            console.error(`presenter: ${presenterFileTooLargeMessage(file)}`);

            return false;
          });

          if (!accepted.length) {
            break;
          }

          api.addFiles(accepted);
          for (const file of accepted) {
            knownFilesRef.current.add(file.id);
            requestedFilesRef.current.delete(file.id);
          }
          break;
        }
        default:
          break;
      }
    },
    [applyPointer, applyScene, requestMissingFiles],
  );

  // ---------------------------------------------------------------------------
  // the media store (D-96)
  //
  // The presenter is a **second window of the same origin**, so it has the
  // same IndexedDB as the editor: a media-backed panel is resolved **here**,
  // from the same store, and its bytes never travel the channel at all.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    registerMediaStore();
  }, []);

  // ---------------------------------------------------------------------------
  // channel lifecycle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // index.html sets this to "_excalidraw" — rename so that re-triggering the
    // menu item focuses this window instead of spawning another one
    window.name = PRESENTER_WINDOW_NAME;
    document.title = "Excalidraw — Presenter view";

    if (!isPresenterSupported()) {
      setStatus("unsupported");
      return;
    }

    channelRef.current = createPresenterChannel(handleMessage);
    const channel = channelRef.current;
    sendHello();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        sendHello();
      }
    };

    window.addEventListener(EVENT.UNLOAD, sendBye);
    window.addEventListener(EVENT.BEFORE_UNLOAD, sendBye);
    window.addEventListener(EVENT.FOCUS, onVisibilityChange);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, onVisibilityChange);

    return () => {
      sendBye();
      window.removeEventListener(EVENT.UNLOAD, sendBye);
      window.removeEventListener(EVENT.BEFORE_UNLOAD, sendBye);
      window.removeEventListener(EVENT.FOCUS, onVisibilityChange);
      document.removeEventListener(EVENT.VISIBILITY_CHANGE, onVisibilityChange);
      channelRef.current = null;
      channel?.close();
    };
  }, [handleMessage, sendBye, sendHello]);

  // ---------------------------------------------------------------------------
  // follow the editor's theme live (it persists to localStorage)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const nextTheme = event.newValue;
      if (event.key !== STORAGE_KEYS.LOCAL_STORAGE_THEME || !nextTheme) {
        return;
      }
      if (
        nextTheme === THEME.LIGHT ||
        nextTheme === THEME.DARK ||
        nextTheme === "system"
      ) {
        setAppTheme(nextTheme);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setAppTheme]);

  // ---------------------------------------------------------------------------
  // re-announce ourselves while the editor is silent (e.g. it hot-reloaded)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastMessageAtRef.current > PRESENTER_HEARTBEAT_MS) {
        sendHello();
      }
    }, PRESENTER_HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [sendHello]);

  // ---------------------------------------------------------------------------
  // replay the scene that arrived before the editor api was ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const pendingScene = pendingSceneRef.current;
    if (excalidrawAPI && !excalidrawAPI.isDestroyed && pendingScene) {
      pendingSceneRef.current = null;
      applyScene(pendingScene);
    }
  }, [applyScene, excalidrawAPI]);

  // ---------------------------------------------------------------------------
  // measure our own viewport
  //
  // The canvas is inside the host, so once it exists its rect is the exact
  // css-px area the mirrored zoom has to fit into. Before it exists we fall
  // back to the host box, which is the same size (presenter chrome is hidden).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    measureViewport();

    // long-term signals: the host being resized, and the window itself
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => measureViewport());
    observer?.observe(host);
    window.addEventListener(EVENT.RESIZE, measureViewport);

    // The canvas is first laid out at a placeholder size and only settles to
    // the real window size a frame or two later. Because the host is `100%`
    // wide it does not resize along with it, so no observer ever fires for
    // that settle. Poll briefly, and stop as soon as two consecutive reads
    // agree — bounded work, and it also covers the canvas being re-created.
    let settledReads = 0;
    const poll = window.setInterval(() => {
      const before = viewportRef.current;
      measureViewport();
      settledReads =
        before.width === viewportRef.current.width &&
        before.height === viewportRef.current.height
          ? settledReads + 1
          : 0;

      if (settledReads >= 3) {
        window.clearInterval(poll);
      }
    }, MEASURE_SETTLE_MS);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener(EVENT.RESIZE, measureViewport);
      observer?.disconnect();
    };
  }, [measureViewport]);

  // ---------------------------------------------------------------------------
  // re-derive the camera whenever our viewport size changes
  //
  // Also re-runs when `pagesEnabled` flips: turning the pages system on makes
  // `App` re-frame the view once, which would otherwise discard the camera we
  // just mirrored until the next scene message arrived.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const scene = lastSceneRef.current;

    if (!scene) {
      return;
    }

    applyCamera(scene.camera);
  }, [applyCamera, pagesEnabled, viewportVersion]);

  // ---------------------------------------------------------------------------
  // connection status
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastMessageAtRef.current;
      setStatus((prev) => {
        const next: PresenterStatus =
          lastMessageAtRef.current === 0
            ? "waiting"
            : elapsed > PRESENTER_UNRESPONSIVE_MS
            ? "stale"
            : "live";
        return prev === next ? prev : next;
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // presenter window shortcuts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const toggleFullscreen = () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggleFullscreen();
      } else if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        setShowHint((prev) => !prev);
      }
    };

    window.addEventListener(EVENT.KEYDOWN, onKeyDown);
    return () => window.removeEventListener(EVENT.KEYDOWN, onKeyDown);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(
      () => setShowHint(false),
      PRESENTER_HINT_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, []);

  const onDoubleClick = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div
      className={clsx("excalidraw-app", "excalidraw-app--presenter", {
        "theme--dark": editorTheme === THEME.DARK,
      })}
      onDoubleClick={onDoubleClick}
    >
      <div className="excalidraw-app__presenter-canvas" ref={hostRef}>
        <Excalidraw
          viewModeEnabled
          handleKeyboardGlobally
          detectScroll={false}
          autoFocus
          theme={editorTheme}
          pagesEnabled={pagesEnabled}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
        />
      </div>

      {status === "waiting" && (
        <div className="presenter-notice presenter-notice--waiting">
          <div className="presenter-notice__title">Presenter view</div>
          <div className="presenter-notice__body">
            Waiting for the editor…
            <br />
            Open this from the editor menu: <kbd>☰</kbd> →{" "}
            <strong>Presenter view</strong>
          </div>
        </div>
      )}

      {status === "stale" && (
        <div className="presenter-notice presenter-notice--stale">
          Editor not responding — is it still open?
        </div>
      )}

      {status === "unsupported" && (
        <div className="presenter-notice presenter-notice--stale">
          This browser doesn&apos;t support BroadcastChannel.
        </div>
      )}

      {showHint && status !== "unsupported" && (
        <div className="presenter-hint">
          <strong>F</strong> fullscreen · <strong>H</strong> hide hint ·
          double-click to toggle fullscreen
        </div>
      )}
    </div>
  );
};
