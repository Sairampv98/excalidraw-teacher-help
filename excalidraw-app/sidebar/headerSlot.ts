import { createContext } from "react";

/**
 * Where in the sidebar's header the Files tab may put its buttons (D-312).
 *
 * - `undefined`: there is no header to put them in, so they stay in the tab
 * - `null`: the header has not given its place yet, so nothing is drawn
 * - an element: the place, and the buttons are drawn in it
 */
export const SidebarHeaderSlotContext = createContext<
  HTMLElement | null | undefined
>(undefined);
