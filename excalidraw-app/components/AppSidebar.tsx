import { useEffect, useRef } from "react";

import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import { useExcalidrawSetAppState } from "@excalidraw/excalidraw/components/App";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import { FilesTab } from "../sidebar/FilesTab";
import { useAutoFitPageOnResize } from "../sidebar/useSidebarLayout";

/** the one tab: it picks files *and* folders */
const FILES_TAB = "files";
/** the one sidebar in this build; matches `DEFAULT_SIDEBAR.name` */
const SIDEBAR_NAME = "default";

/** a pile of sheets — files of every kind, in one place */
const FilesIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="m4 7.5 8-4.5 8 4.5-8 4.5-8-4.5Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"
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
      setAppState({ openSidebar: { name: SIDEBAR_NAME, tab: FILES_TAB } });
    }
  }, [openSidebar, setAppState]);

  // the stock library / search / comments / presentation tabs are gone, and the
  // folder + documents tabs are one tab now, so any other tab name falls back
  // to it
  useEffect(() => {
    if (openSidebar?.name === SIDEBAR_NAME && openSidebar.tab !== FILES_TAB) {
      setAppState({ openSidebar: { name: SIDEBAR_NAME, tab: FILES_TAB } });
    }
  }, [openSidebar, setAppState]);

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
          <Sidebar.TabTrigger tab={FILES_TAB} title="Files">
            <FilesIcon />
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
        <Sidebar.Tab tab={FILES_TAB}>
          <FilesTab />
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
