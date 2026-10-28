/**
 * AC-272 - the hamburger menu is tidied (D-242).
 *
 * The real app, the real menu: it is opened and read in the order it is shown,
 * with its lines.
 */

import {
  act,
  fireEvent,
  render,
  screen,
} from "@excalidraw/excalidraw/tests/test-utils";
import { expect, vi } from "vitest";

import ExcalidrawApp from "../App";

vi.mock("../../excalidraw-app/data/firebase.ts", () => ({
  loadFromFirebase: async () => null,
  saveToFirebase: () => {},
  isSavedToFirebase: () => true,
  loadFilesFromFirebase: async () => ({ loadedFiles: [], erroredFiles: [] }),
  saveFilesToFirebase: async () => ({
    savedFiles: new Map(),
    erroredFiles: new Map(),
  }),
}));

const openMenu = async () => {
  await render(<ExcalidrawApp />);

  act(() => {
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
  });

  return document.querySelector(".dropdown-menu.main-menu") as HTMLElement;
};

/**
 * What the menu shows, in order: the text of each entry, a line where one is
 * drawn, and "Canvas background" for the picker of the colour of the board.
 */
const readMenu = (menu: HTMLElement) =>
  [...(menu.firstElementChild as HTMLElement).children].map((node) => {
    if (node.getAttribute("style")?.includes("height: 1px")) {
      return "---";
    }

    if (node.querySelector("[data-testid='canvas-background-label']")) {
      return "Canvas background";
    }

    return (
      node.querySelector(".dropdown-menu-item__text")?.textContent?.trim() ??
      node.getAttribute("data-testid") ??
      node.textContent!.trim().slice(0, 30)
    );
  });

describe("AC-272 the hamburger menu is tidied", () => {
  it("AC-272 the removed entries are gone", async () => {
    const menu = await openMenu();
    const text = menu.textContent!;

    // the menu is there, with what it should have
    expect(text).toContain("Presenter view");

    for (const gone of [
      "Excalidraw+",
      "Sign up",
      "Sign in",
      "Live collaboration",
      "Follow us",
      "GitHub",
      "Twitter",
      "Discord",
    ]) {
      expect(text, gone).not.toContain(gone);
    }

    // no link in the menu leaves the app
    expect(menu.querySelectorAll("a[href^='http']")).toHaveLength(0);
    expect(menu.querySelector("[data-testid='collab-button']")).toBeNull();
  });

  it("AC-272 the entries are in three groups", async () => {
    const menu = await openMenu();
    const items = readMenu(menu);

    const lines = items.reduce<number[]>(
      (at, item, i) => (item === "---" ? [...at, i] : at),
      [],
    );

    // two lines, so three groups
    expect(lines).toHaveLength(2);

    const [first, second, third] = [
      items.slice(0, lines[0]),
      items.slice(lines[0] + 1, lines[1]),
      items.slice(lines[1] + 1),
    ];

    // (1) the file
    expect(first[0]).toBe("Open");
    expect(first).toContain("Code panel (VS Code)");
    expect(first.some((entry) => /^Save/.test(entry))).toBe(true);
    expect(first.some((entry) => /^Export/.test(entry))).toBe(true);

    // (2) the look of the board, with the canvas background in view and before the preferences
    expect(second[0]).toBe("Presenter view");
    expect(second).toContain("Canvas background");
    expect(second.some((entry) => /Preferences/i.test(entry))).toBe(true);
    expect(second.indexOf("Canvas background")).toBeLessThan(
      second.findIndex((entry) => /Preferences/i.test(entry)),
    );

    // (3) finding things, help, and clearing the canvas last
    expect(third.some((entry) => /Command palette/i.test(entry))).toBe(true);
    expect(third.some((entry) => /Help/i.test(entry))).toBe(true);
    expect(third[third.length - 1]).toMatch(/Reset the canvas/i);

    // and nothing of it is in the places it was
    expect(first.concat(third)).not.toContain("Canvas background");
  });

  it("AC-272 the welcome screen still has its own entries", async () => {
    await render(<ExcalidrawApp />);

    // outside the menu, the welcome screen is as it was
    const welcome = document.querySelector(".welcome-screen-center")!;

    expect(welcome).not.toBeNull();
    expect(welcome.textContent).toContain("Live collaboration");
  });
});
