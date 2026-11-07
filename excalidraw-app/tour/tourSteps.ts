/**
 * The steps of the first-launch tour. Each step points at a real control of the
 * app (the first selector that is on the screen wins); a step whose control is
 * not on the screen is told in the middle of the screen instead.
 */

export type TourStep = {
  id: string;
  title: string;
  text: string;
  /** where the control is, the first one found on the screen is used */
  targets?: string[];
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to the classroom board",
    text: "This is a board you draw on while you teach. It has a few additions that make a class easier: pages, a code editor, a presenter window, animations. This short tour shows where they are. You can leave at any time.",
  },
  {
    id: "tools",
    title: "The tools",
    text: "Pick a tool here, then draw on the board. Press the number or the letter on each tool to choose it faster. The help icon at the bottom right explains whichever tool you are using.",
    targets: [".App-toolbar", ".App-toolbar-container"],
  },
  {
    id: "pages",
    title: "Pages",
    text: "A class is a series of pages, not one endless board. Add a page, go back and forth, and export all of them as one PDF.",
    targets: [".excalidraw-page-bar", '[class*="page-bar"]'],
  },
  {
    id: "sidebar",
    title: "Files, Flow and Assistant",
    text: "Open this panel for your files and pictures, for animated flowcharts (Flow), and for the Assistant that can draw for you. It is also where a video or a YouTube link goes.",
    targets: [".default-sidebar-trigger", '[data-testid="sidebar-trigger"]'],
  },
  {
    id: "menu",
    title: "The menu",
    text: "Open this menu for the code editor, the VS Code mirror and the presenter view. The presenter view opens a second window for the projector, while you keep the editing window to yourself.",
    targets: ['[data-testid="main-menu-trigger"]'],
  },
  {
    id: "help",
    title: "Help, for the tool in use",
    text: "This icon brings up the guide for the tool you have selected, with its shortcuts. Pick another tool and press it again.",
    targets: [".help-icon"],
  },
  {
    id: "done",
    title: "You are ready",
    text: "Draw something. You can take this tour again from the menu at any time.",
  },
];
