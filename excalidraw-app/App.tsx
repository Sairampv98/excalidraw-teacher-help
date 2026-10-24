import {
  Excalidraw,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
  useExcalidrawStateValue,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  THEME,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  ExcalLogo,
  ExportImageIcon,
  presentationIcon,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import { isPanelElement, isPosterPanelElement } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import { syncInvalidIndices } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type { PanelScreenshotChoice } from "@excalidraw/excalidraw";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  ExcalidrawImageElement,
  ExcalidrawPanelElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { insertCodePanel } from "./bridge/insertCodePanel";
import { useBridgePanel } from "./bridge/useBridgePanel";
import { useOcr, imageNaturalSize } from "./bridge/useOcr";
import { useScreenshot } from "./bridge/useScreenshot";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { EdgeDocks } from "./dock/EdgeDocks";
import { useEdgeDocksEnabled } from "./dock/dockTypes";
import PageBar from "./components/PageBar";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";
import { isPresenterWindow } from "./presenter/presenterChannel";
import { openPresenterView } from "./presenter/openPresenterView";
import { PresenterView } from "./presenter/PresenterView";
import { usePresenterBroadcaster } from "./presenter/usePresenterBroadcaster";

import "./index.scss";

import { AppSidebar } from "./components/AppSidebar";
import { usePageAutoFit, useSidebarWidth } from "./sidebar/useSidebarLayout";
import { handleCodePaste } from "./sidebar/insertIntoScene";
import { ReformatChooser } from "./sidebar/ReformatChooser";
import { CropModal, posterNaturalSize } from "./components/cropModal";

import type { CollabAPI } from "./collab/Collab";

import type { CropRect } from "./components/cropModal";
polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  // the document — its page list and its content — is persisted through the
  // document store (D-6). The legacy localStorage snapshot is only read when
  // the store has never been written (the migration path).
  const storedDocument = await LocalData.loadDocument();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements:
      storedDocument?.elements ??
      restoreElements(localDataState?.elements, null, {
        repairBindings: true,
        deleteInvisibleElements: true,
      }),
    appState: restoreAppState(
      {
        ...localDataState?.appState,
        ...(storedDocument
          ? {
              pages: storedDocument.pages,
              currentPageId: storedDocument.currentPageId,
            }
          : {}),
      },
      null,
    ),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  // mirrors the scene into the presenter window (second display), if open
  // `true` so the projector uses the same page + page-relative camera contract
  //
  // The live view's descriptor goes over the same channel (D-101): the
  // presenter is a second JavaScript context, so the registry that holds the
  // descriptor is empty there, and the editor hands it over.
  const { publishScene, publishPointer, publishLiveView } =
    usePresenterBroadcaster(true);

  // the VS Code bridge: the app's side of the connection, and the code panel
  // it feeds (D-51)
  const { bridge, requestOcr, ocrState, panelDraft, panelRun, panelCaptions } =
    useBridgePanel(excalidrawAPI, publishLiveView);

  // the OCR capability: the read happens in the bridge's Node process, and the
  // app puts the text back on the canvas (D-59)
  const {
    read: readOcr,
    imageOfPanel,
    message: ocrMessage,
    busy: ocrBusy,
    cancel: cancelOcr,
    rememberCrop: rememberPanelCrop,
    cropFor,
    engines: ocrEngines,
    engineFor,
    pickedEngineFor,
    selectEngine,
  } = useOcr({
    api: excalidrawAPI,
    requestOcr,
    engineState: ocrState,
    // the ladder (D-137): with the bridge the fastest engine there is goes
    // first, without it the rung that needs nothing but the browser does
    bridgeConnected: bridge.status === "connected",
  });

  // the screenshot of a panel: the app takes the picture and puts it on the
  // canvas (D-102, D-104)
  const {
    capture: captureScreenshot,
    choose: chooseScreenshot,
    place: placeScreenshot,
  } = useScreenshot({ api: excalidrawAPI, readOcr });

  /**
   * The **crop** of each panel's picture, in the picture's own pixels (D-137).
   *
   * The crop and the read are **one** action: the teacher crops the panel
   * once, and every read of that panel reads the region they cropped - the
   * read takes the cropped region, and not the whole picture.
   *
   * The crop is remembered by the OCR hook, next to the engine the teacher
   * picked for the same panel.
   */

  /**
   * Reads an **ordinary image** element the teacher picked (D-105).
   *
   * The owner asked for the OCR of a screenshot to be offered for "regular
   * images aswell": a screenshot pasted in by hand is an ordinary image
   * element, and it deserves the same choice — the same read, the same
   * per-line text over the picture.
   */
  const readImage = useCallback(
    async ({ element }: { element: NonDeleted<ExcalidrawImageElement> }) => {
      const current = excalidrawAPI;

      if (!current || !element.fileId) {
        return;
      }

      const file = current.getFiles()[element.fileId];

      if (!file) {
        return;
      }

      // the picture's own size, in its pixels: the OCR's lines come back in
      // them, and the element carries only its size on the canvas (D-59)
      const natural = await imageNaturalSize(file.dataURL);

      await readOcr({
        image: {
          dataURL: file.dataURL,
          width: natural.width || element.width,
          height: natural.height || element.height,
        },
        placement: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        },
        pageId: element.pageId,
        strokeColor: current.getAppState().currentItemStrokeColor,
      });
    },
    [excalidrawAPI, readOcr],
  );

  /**
   * Reads the **panel** the teacher picked: its poster, or the frame the
   * video is showing right now (D-59).
   *
   * The whole picture is the region of interest — the teacher did not pick a
   * part of it.
   */
  const readPanel = useCallback(
    async (panelId: string) => {
      const current = excalidrawAPI;

      if (!current) {
        return;
      }

      const panel = current
        .getSceneElements()
        .find((element) => element.id === panelId);

      if (!panel || !isPanelElement(panel)) {
        return;
      }

      const image = imageOfPanel(panel);

      if (!image) {
        return;
      }

      /**
       * The **crop** the teacher took for this panel, if they took one (D-137).
       *
       * The crop and the read are one action: the read takes the cropped
       * region, and not the whole picture, so the teacher reads the part they
       * marked and not the whole poster.
       */
      const crop = cropFor(panelId);

      await readOcr({
        image,
        panelId,
        ...(crop
          ? {
              region: {
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
              },
            }
          : {}),
        placement: {
          x: panel.x,
          y: panel.y,
          width: panel.width,
          height: panel.height,
        },
        pageId: panel.pageId,
        strokeColor: current.getAppState().currentItemStrokeColor,
        // the engine the teacher chose **for this panel** (D-118) - and when
        // they chose none, the ladder chooses (D-137)
        ...(pickedEngineFor(panelId)
          ? { engine: pickedEngineFor(panelId)! }
          : {}),
      });
    },
    [excalidrawAPI, cropFor, imageOfPanel, pickedEngineFor, readOcr],
  );

  /**
   * Reads the **crop** the teacher picked in the crop dialog (D-59).
   *
   * The region travels with the request, so the bridge reads only that part
   * of the picture — the crop is the one OCR lever that costs nothing and buys
   * the most.
   *
   * The crop is **remembered** for the panel (D-137): the read of that panel
   * takes the region the teacher cropped, so the crop and the read are one
   * action and not two.
   */
  const readCrop = useCallback(
    async (panel: ExcalidrawPanelElement, crop: CropRect) => {
      const current = excalidrawAPI;

      if (!current) {
        return;
      }

      const file = panel.posterFileId
        ? current.getFiles()[panel.posterFileId]
        : null;

      if (!file) {
        return;
      }

      const natural = posterNaturalSize(panel);

      // the crop is the panel's crop from now on (D-137)
      rememberPanelCrop(panel.id, {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
      });

      await readOcr({
        image: {
          dataURL: file.dataURL,
          width: natural.width,
          height: natural.height,
        },
        region: {
          x: crop.x,
          y: crop.y,
          width: crop.width,
          height: crop.height,
        },
        placement: {
          x: panel.x,
          y: panel.y,
          width: panel.width,
          height: panel.height,
        },
        pageId: panel.pageId,
        strokeColor: current.getAppState().currentItemStrokeColor,
      });
    },
    [excalidrawAPI, readOcr, rememberPanelCrop],
  );

  /**
   * The host's **screenshot** controls (D-102, D-103).
   *
   * The library draws the button, the choice strip and the wireframe; the app
   * takes the picture and puts it on the canvas. The object is memoised, so the
   * panel overlay does not re-render on every frame of a stroke.
   */
  const panelScreenshot = useMemo(
    () => ({
      onCapture: (panelId: string) => {
        void captureScreenshot(panelId);
      },
      onChoice: (panelId: string, choice: PanelScreenshotChoice) => {
        void chooseScreenshot(panelId, choice);
      },
      onPlace: (panelId: string, at: { x: number; y: number }) => {
        placeScreenshot(panelId, at);
      },
    }),
    [captureScreenshot, chooseScreenshot, placeScreenshot],
  );

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  // draggable / auto-hiding edge docks for the toolbar + properties panel
  const { enabled: edgeDocksEnabled, toggle: toggleEdgeDocks } =
    useEdgeDocksEnabled();

  // user-resizable sidebar + the "refit the page when the space changes" toggle
  const {
    width: sidebarWidth,
    dragging: sidebarDragging,
    onPointerDown: onSidebarResizePointerDown,
    resetWidth: resetSidebarWidth,
  } = useSidebarWidth();
  const pageAutoFit = usePageAutoFit();

  /**
   * The room the **sidebar** takes away from the canvas (D-121).
   *
   * The sidebar is overlaid on the editor container, so the canvas's own
   * controls - the page bar, the toolbar's right end - used to land
   * **underneath** it (the owner's exact report). The library reserves the
   * sidebar's width inside its own layer; this is the same reservation, said
   * to the app's own chrome, which lives outside the library's container.
   *
   * It tracks the sidebar being opened and closed, because the reservation is
   * the sidebar's **actual** width.
   */
  const openSidebar = useExcalidrawStateValue("openSidebar");
  const canvasReservedWidth = openSidebar ? sidebarWidth : 0;

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, loadImages]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // no-op unless a presenter window is actually connected
    publishScene(elements, appState);

    // the crop of a poster panel is app-level new UI (D-68): the library's
    // crop action puts the panel into crop mode, and this is where the app
    // notices and opens its own modal. The panel is never cropped in place —
    // the modal leaves it untouched and produces a new image element.
    const croppingId = appState.croppingElementId;

    if (croppingId) {
      const croppingElement = elements.find(
        (element) => element.id === croppingId,
      );

      if (croppingElement && isPosterPanelElement(croppingElement)) {
        setPanelCropId(croppingId);
      }
    }

    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  // the selection the user asked to reformat ("Reformat as..." in the canvas
  // context menu) — the app owns the chooser and the reformats behind it
  const [reformatElements, setReformatElements] = useState<
    readonly NonDeletedExcalidrawElement[] | null
  >(null);

  // the poster panel the user asked to crop — the crop of a poster is
  // app-level new UI (D-68), because the library's crop is an **in-place**
  // crop of an image element and a panel has to be left untouched.
  const [panelCropId, setPanelCropId] = useState<string | null>(null);

  const handleReformatSelection = useCallback(
    ({
      selectedElements,
    }: {
      selectedElements: readonly NonDeletedExcalidrawElement[];
    }) => {
      setReformatElements(selectedElements);
    },
    [],
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const ExcalidrawPlusCommand = {
    label: "Excalidraw+",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: ["plus", "cloud", "server"],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };
  const ExcalidrawPlusAppCommand = {
    label: "Sign up",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: [
      "excalidraw",
      "plus",
      "cloud",
      "server",
      "signin",
      "login",
      "signup",
    ],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_APP
        }?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };

  // the poster panel being cropped, with the poster's own pixels — the crop
  // rectangle is in the poster's native resolution, not in the panel's
  // on-canvas size (D-68)
  const panelCrop =
    panelCropId && excalidrawAPI
      ? (() => {
          const panel = excalidrawAPI
            .getSceneElements()
            .find(
              (element) =>
                element.id === panelCropId && isPosterPanelElement(element),
            );

          if (!panel || !isPanelElement(panel) || !panel.posterFileId) {
            return null;
          }

          const file = excalidrawAPI.getFiles()[panel.posterFileId];

          return file ? { panel, dataURL: file.dataURL } : null;
        })()
      : null;

  const closePanelCrop = () => {
    setPanelCropId(null);
    excalidrawAPI?.updateScene({
      appState: { croppingElementId: null },
    });
  };

  return (
    <div
      style={{
        height: "100%",
        // the room the sidebar takes away from the canvas (D-121): the app's
        // own chrome - the page bar - is laid out beside the sidebar, never
        // under it
        ["--canvas-reserved-width" as any]: `${canvasReservedWidth}px`,
      }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        // collaboration and the presenter mirror both ride on pointer updates,
        // so this fans out instead of handing the prop to collab alone — the
        // laser trail is drawn from these, not from the scene
        onPointerUpdate={(payload) => {
          collabAPI?.onPointerUpdate?.(payload);
          publishPointer({
            x: payload.pointer.x,
            y: payload.pointer.y,
            tool: payload.pointer.tool,
            button: payload.button,
          });
        }}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            // "File > Insert document..." — adds another `.excalidraw` file's
            // content to the canvas that is already open (D-35)
            insertDocument: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        // the armed code paste is decided here, in the library's own paste
        // path — the context menu's Paste never fires a DOM paste event, so a
        // listener would only ever have seen the keyboard paste
        onPaste={handleCodePaste}
        onReformatSelection={handleReformatSelection}
        // the bridge field of a code panel: the token, and the state of the
        // connection (D-52)
        panelBridge={bridge}
        // the teacher's own text in the code panel, and the Run control that
        // sends it to the extension (D-123, D-124)
        panelDraft={panelDraft}
        panelRun={panelRun}
        // the captions of a YouTube video: the bridge reads them, because a
        // browser cannot, and the tier that answered comes back with them
        // (D-129)
        panelCaptions={panelCaptions}
        // the OCR option of a panel: the read happens in the bridge's Node
        // process, and the app puts the text back on the canvas (D-59)
        panelOcr={{
          message: ocrMessage,
          busy: ocrBusy,
          onOcr: (panelId) => {
            void readPanel(panelId);
          },
          // a read that takes time says so while it takes it, and it can be
          // stopped (D-138)
          onCancel: cancelOcr,
          // the engine picker: the teacher chooses the engine **in the
          // panel**, and the choice is per panel (D-118)
          engines: ocrEngines,
          engineFor,
          onSelectEngine: selectEngine,
        }}
        // the screenshot of a panel: the button, the choice strip and the
        // wireframe are the library's, and the picture is the app's (D-102)
        panelScreenshot={panelScreenshot}
        // the OCR of an ordinary image: the same read the panel's OCR uses
        // (D-105)
        onOcrImage={readImage}
        theme={editorTheme}
        pagesEnabled={true}
        sidebarWidth={sidebarWidth}
        renderTopRightUI={(isMobile) => {
          if (isMobile) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              {collabError.message && <CollabError collabError={collabError} />}
              <ToolButton
                type="button"
                icon={ExportImageIcon}
                onClick={() =>
                  excalidrawAPI?.updateScene({
                    appState: { openDialog: { name: "imageExport" } },
                  })
                }
                title={t("buttons.export")}
                aria-label={t("buttons.export")}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.scrollToContent(element.link, { animate: true });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          theme={appTheme}
          setTheme={(theme) => setAppTheme(theme)}
          refresh={() => forceRefresh((prev) => !prev)}
          onInsertCodePanel={() => {
            if (excalidrawAPI) {
              insertCodePanel(excalidrawAPI);
            }
          }}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {reformatElements && (
          <ReformatChooser
            elements={reformatElements}
            onClose={() => setReformatElements(null)}
          />
        )}
        {panelCrop && (
          <CropModal
            panel={panelCrop.panel}
            dataURL={panelCrop.dataURL}
            pageId={excalidrawAPI?.getAppState().currentPageId ?? "page-1"}
            onClose={closePanelCrop}
            onOcr={(crop) => {
              void readCrop(panelCrop.panel, crop);
            }}
            ocrMessage={ocrMessage}
            ocrBusy={ocrBusy}
            onApply={(element) => {
              // a NEW element has no fractional index yet, and the scene
              // validates the indices before it syncs them - so the host app
              // has to sync them itself (see `insertCodePanel`)
              excalidrawAPI?.updateScene({
                elements: syncInvalidIndices([
                  ...excalidrawAPI.getSceneElements(),
                  element,
                ]),
              });
              closePanelCrop();
            }}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        {/* draggable / auto-hiding edge docks (toolbar + properties panel) */}
        {edgeDocksEnabled && <EdgeDocks />}

        {/* pages system: page chips + add page + export all pages */}
        <PageBar />

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar
          width={sidebarWidth}
          dragging={sidebarDragging}
          onResizePointerDown={onSidebarResizePointerDown}
          onResetWidth={resetSidebarWidth}
          autoFitEnabled={pageAutoFit.enabled}
          onToggleAutoFit={pageAutoFit.toggle}
        />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: edgeDocksEnabled
                ? "Edge docks: disable"
                : "Edge docks: enable",
              category: DEFAULT_CATEGORIES.editor,
              predicate: true,
              icon: presentationIcon,
              keywords: [
                "dock",
                "edge",
                "toolbar",
                "properties",
                "auto",
                "hide",
                "panel",
                "float",
              ],
              perform: () => {
                toggleEdgeDocks();
              },
            },
            {
              label: "Presenter view",
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: presentationIcon,
              keywords: [
                "present",
                "presenter",
                "projector",
                "second",
                "screen",
                "display",
                "mirror",
                "audience",
                "fullscreen",
              ],
              perform: () => {
                openPresenterView();
              },
            },
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              ...CommandPalette.defaultItems.toggleTheme,
              perform: () => {
                setAppTheme(
                  editorTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK,
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  // second-display mirror of the editor — same origin, no editors, no chrome
  if (isPresenterWindow()) {
    return (
      <TopErrorBoundary>
        <Provider store={appJotaiStore}>
          <ExcalidrawAPIProvider>
            <PresenterView />
          </ExcalidrawAPIProvider>
        </Provider>
      </TopErrorBoundary>
    );
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
