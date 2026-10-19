import { useEffect, useRef } from "react";

import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import { useExcalidrawSetAppState } from "@excalidraw/excalidraw/components/App";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import { DocumentsTab } from "../sidebar/DocumentsTab";
import { FolderTab } from "../sidebar/FolderTab";
import { useAutoFitPageOnResize } from "../sidebar/useSidebarLayout";

const FOLDER_TAB = "folder";
const DOCUMENTS_TAB = "documents";
/** the one sidebar in this build; matches `DEFAULT_SIDEBAR.name` */
const SIDEBAR_NAME = "default";

const FolderIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

const DocumentIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M13 3v5h5M8.5 13h7M8.5 16.5h5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** page outline + inward arrow — "keep the whole page in view" */
const FitPageIcon = ({ active }: { active: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="3"
      y="4.5"
      width="18"
      height="15"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.6"
      opacity={active ? 1 : 0.55}
    />
    {active ? (
      <path
        d="M8 12h8M13 9l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M8 12h8M13 9l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2.5 2.5"
      />
    )}
  </svg>
);

type AppSidebarProps = {
  width: number;
  dragging: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResetWidth: () => void;
  autoFitEnabled: boolean;
  onToggleAutoFit: () => void;
};

export const AppSidebar = ({
  width,
  dragging,
  onResizePointerDown,
  onResetWidth,
  autoFitEnabled,
  onToggleAutoFit,
}: AppSidebarProps) => {
  const { openSidebar } = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  // Pinned by default: `openSidebar` holds the sidebar open *and* docked —
  // a null value is what collapses it to the rail. Doing this on mount (rather
  // than in the library's default app state, which is not ours to change)
  // means every load starts expanded. The ref keeps it to the first render, so
  // closing the sidebar afterwards is a choice we don't argue with.
  const pinnedOnLoad = useRef(false);

  useEffect(() => {
    if (pinnedOnLoad.current) {
      return;
    }
    pinnedOnLoad.current = true;

    if (openSidebar?.name !== SIDEBAR_NAME) {
      setAppState({ openSidebar: { name: SIDEBAR_NAME, tab: FOLDER_TAB } });
    }
  }, [openSidebar, setAppState]);

  // the stock library / search / comments / presentation tabs are gone, so an
  // unknown or missing tab name falls back to the folder tab
  useEffect(() => {
    if (
      openSidebar?.name === SIDEBAR_NAME &&
      openSidebar.tab !== FOLDER_TAB &&
      openSidebar.tab !== DOCUMENTS_TAB
    ) {
      setAppState({ openSidebar: { name: SIDEBAR_NAME, tab: FOLDER_TAB } });
    }
  }, [openSidebar, setAppState]);

  const tab = openSidebar?.tab === DOCUMENTS_TAB ? DOCUMENTS_TAB : FOLDER_TAB;

  // the sidebar is an overlay, so it covers this much of the canvas
  const sidebarCoversCanvas = !!openSidebar;

  useAutoFitPageOnResize({
    enabled: autoFitEnabled,
    sidebarWidth: width,
    sidebarCoversCanvas,
  });

  return (
    <>
      <DefaultSidebar builtInTabs={false}>
        <DefaultSidebar.TabTriggers>
          <Sidebar.TabTrigger
            tab={FOLDER_TAB}
            style={{ opacity: tab === FOLDER_TAB ? 1 : 0.45 }}
            title="Folder"
          >
            <FolderIcon />
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab={DOCUMENTS_TAB}
            style={{ opacity: tab === DOCUMENTS_TAB ? 1 : 0.45 }}
            title="Documents"
          >
            <DocumentIcon />
          </Sidebar.TabTrigger>

          {/* not a tab — a switch for how the canvas reacts to resizing */}
          <button
            type="button"
            className="app-sidebar-fit-toggle"
            onClick={onToggleAutoFit}
            aria-pressed={autoFitEnabled}
            title={
              autoFitEnabled
                ? "Auto-fit page is ON — resizing this sidebar keeps the whole page in view. Click to turn off."
                : "Auto-fit page is OFF — resizing this sidebar leaves the view where it is. Click to turn on."
            }
            aria-label="Auto-fit page to remaining space"
            data-testid="sidebar-auto-fit-toggle"
          >
            <FitPageIcon active={autoFitEnabled} />
          </button>
        </DefaultSidebar.TabTriggers>
        <Sidebar.Tab tab={FOLDER_TAB}>
          <FolderTab />
        </Sidebar.Tab>
        <Sidebar.Tab tab={DOCUMENTS_TAB}>
          <DocumentsTab />
        </Sidebar.Tab>
      </DefaultSidebar>

      {/* drag target on the sidebar's left edge; positioned off the same
          `--right-sidebar-width` the sidebar box sizes itself from */}
      {sidebarCoversCanvas && (
        <div
          className="app-sidebar-resizer"
          data-testid="sidebar-resizer"
          data-dragging={dragging ? "true" : undefined}
          style={{ right: `calc(${width}px - var(--space-factor) * 2)` }}
          onPointerDown={onResizePointerDown}
          onDoubleClick={onResetWidth}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={width}
          tabIndex={0}
        />
      )}
    </>
  );
};
