import clsx from "clsx";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";

import {
  CLASSES,
  EVENT,
  isDevEnv,
  KEYS,
  updateObject,
} from "@excalidraw/common";

import { useUIAppState } from "../../context/ui-appState";
import { atom, useSetAtom } from "../../editor-jotai";
import { useOutsideClick } from "../../hooks/useOutsideClick";
import { useEditorInterface, useExcalidrawSetAppState } from "../App";
import { Island } from "../Island";

import { SidebarHeader } from "./SidebarHeader";
import { SidebarTabTrigger } from "./SidebarTabTrigger";
import { SidebarTabTriggers } from "./SidebarTabTriggers";
import { SidebarTrigger } from "./SidebarTrigger";
import { SidebarPropsContext } from "./common";
import { SidebarTabs } from "./SidebarTabs";
import { SidebarTab } from "./SidebarTab";

import "./Sidebar.scss";

import type { SidebarProps, SidebarPropsContextValue } from "./common";

/**
 * Flags whether the currently rendered Sidebar is docked or not, for use
 * in upstream components that need to act on this (e.g. LayerUI to shift the
 * UI). We use an atom because of potential host app sidebars (for the default
 * sidebar we could just read from appState.defaultSidebarDockedPreference).
 *
 * Since we can only render one Sidebar at a time, we can use a simple flag.
 */
export const isSidebarDockedAtom = atom(false);

export const SidebarInner = forwardRef(
  (
    {
      name,
      children,
      onDock,
      docked,
      className,
      ...rest
    }: SidebarProps & Omit<React.RefAttributes<HTMLDivElement>, "onSelect">,
    ref: React.ForwardedRef<HTMLDivElement>,
  ) => {
    if (isDevEnv() && onDock && docked == null) {
      console.warn(
        "Sidebar: `docked` must be set when `onDock` is supplied for the sidebar to be user-dockable. To hide this message, either pass `docked` or remove `onDock`",
      );
    }

    const setAppState = useExcalidrawSetAppState();

    const setIsSidebarDockedAtom = useSetAtom(isSidebarDockedAtom);

    useLayoutEffect(() => {
      setIsSidebarDockedAtom(!!docked);
      return () => {
        setIsSidebarDockedAtom(false);
      };
    }, [setIsSidebarDockedAtom, docked]);

    const headerPropsRef = useRef<SidebarPropsContextValue>(
      {} as SidebarPropsContextValue,
    );
    headerPropsRef.current.onCloseRequest = () => {
      setAppState({ openSidebar: null });
    };
    headerPropsRef.current.onDock = (isDocked) => onDock?.(isDocked);
    // renew the ref object if the following props change since we want to
    // rerender. We can't pass down as component props manually because
    // the <Sidebar.Header/> can be rendered upstream.
    headerPropsRef.current = updateObject(headerPropsRef.current, {
      docked,
      // explicit prop to rerender on update
      shouldRenderDockButton: !!onDock && docked != null,
    });

    const islandRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => {
      return islandRef.current!;
    });

    const editorInterface = useEditorInterface();

    const closeLibrary = useCallback(
      (opts?: { ignoreDialogOpenedSince?: boolean }) => {
        const isDialogOpen = !!document.querySelector(".Dialog");

        // Prevent closing if any dialog is open (unless the dialog is the
        // result of the very click that asks for the close)
        if (isDialogOpen && !opts?.ignoreDialogOpenedSince) {
          return;
        }
        setAppState({ openSidebar: null });
      },
      [setAppState],
    );

    // A press on a control outside the sidebar (a tool, the help icon) closes
    // it, and closing gives the screen its room back, so the control moves
    // under the pointer and the click that was on its way is lost. So the
    // close waits for the press to end: the control is still where it was
    // when the click lands. A press on the drawing surface closes at once.
    const closeAfterPressPending = useRef(false);

    const closeAfterPress = useCallback(() => {
      if (closeAfterPressPending.current) {
        return;
      }
      closeAfterPressPending.current = true;

      const dialogWasOpen = !!document.querySelector(".Dialog");

      const onRelease = () => {
        document.removeEventListener("pointerup", onRelease, true);
        document.removeEventListener("touchend", onRelease, true);
        document.removeEventListener("pointercancel", onRelease, true);
        // after the click that ends the press has been delivered
        window.setTimeout(() => {
          closeAfterPressPending.current = false;
          closeLibrary({ ignoreDialogOpenedSince: !dialogWasOpen });
        }, 60);
      };

      document.addEventListener("pointerup", onRelease, true);
      document.addEventListener("touchend", onRelease, true);
      document.addEventListener("pointercancel", onRelease, true);
    }, [closeLibrary]);

    useOutsideClick(
      islandRef,
      useCallback(
        (event) => {
          // If click on the library icon, do nothing so that LibraryButton
          // can toggle library menu
          if ((event.target as Element).closest(".sidebar-trigger")) {
            return;
          }
          if (!docked || !editorInterface.canFitSidebar) {
            if (event.target instanceof HTMLCanvasElement) {
              closeLibrary();
            } else {
              closeAfterPress();
            }
          }
        },
        [closeLibrary, closeAfterPress, docked, editorInterface.canFitSidebar],
      ),
    );

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          event.key === KEYS.ESCAPE &&
          (!docked || !editorInterface.canFitSidebar)
        ) {
          closeLibrary();
        }
      };
      document.addEventListener(EVENT.KEYDOWN, handleKeyDown);
      return () => {
        document.removeEventListener(EVENT.KEYDOWN, handleKeyDown);
      };
    }, [closeLibrary, docked, editorInterface.canFitSidebar]);

    return (
      <Island
        {...rest}
        className={clsx(
          CLASSES.SIDEBAR,
          { "sidebar--docked": docked },
          className,
        )}
        ref={islandRef}
      >
        <SidebarPropsContext.Provider value={headerPropsRef.current}>
          {children}
        </SidebarPropsContext.Provider>
      </Island>
    );
  },
);
SidebarInner.displayName = "SidebarInner";

export const Sidebar = Object.assign(
  forwardRef((props: SidebarProps, ref: React.ForwardedRef<HTMLDivElement>) => {
    const appState = useUIAppState();

    const { onStateChange } = props;

    const refPrevOpenSidebar = useRef(appState.openSidebar);
    useEffect(() => {
      if (
        // closing sidebar
        ((!appState.openSidebar &&
          refPrevOpenSidebar?.current?.name === props.name) ||
          // opening current sidebar
          (appState.openSidebar?.name === props.name &&
            refPrevOpenSidebar?.current?.name !== props.name) ||
          // switching tabs or switching to a different sidebar
          refPrevOpenSidebar.current?.name === props.name) &&
        appState.openSidebar !== refPrevOpenSidebar.current
      ) {
        onStateChange?.(
          appState.openSidebar?.name !== props.name
            ? null
            : appState.openSidebar,
        );
      }
      refPrevOpenSidebar.current = appState.openSidebar;
    }, [appState.openSidebar, onStateChange, props.name]);

    const [mounted, setMounted] = useState(false);
    useLayoutEffect(() => {
      setMounted(true);
      return () => setMounted(false);
    }, []);

    // We want to render in the next tick (hence `mounted` flag) so that it's
    // guaranteed to happen after unmount of the previous sidebar (in case the
    // previous sidebar is mounted after the next one). This is necessary to
    // prevent flicker of subcomponents that support fallbacks
    // (e.g. SidebarHeader). This is because we're using flags to determine
    // whether prefer the fallback component or not (otherwise both will render
    // initially), and the flag won't be reset in time if the unmount order
    // it not correct.
    //
    // Alternative, and more general solution would be to namespace the fallback
    // HoC so that state is not shared between subcomponents when the wrapping
    // component is of the same type (e.g. Sidebar -> SidebarHeader).
    const shouldRender = mounted && appState.openSidebar?.name === props.name;

    if (!shouldRender) {
      return null;
    }

    return <SidebarInner {...props} ref={ref} key={props.name} />;
  }),
  {
    Header: SidebarHeader,
    TabTriggers: SidebarTabTriggers,
    TabTrigger: SidebarTabTrigger,
    Tabs: SidebarTabs,
    Tab: SidebarTab,
    Trigger: SidebarTrigger,
  },
);
Sidebar.displayName = "Sidebar";
