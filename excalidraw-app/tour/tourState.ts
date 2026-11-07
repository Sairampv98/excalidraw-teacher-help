import { appJotaiStore, atom } from "../app-jotai";

const SEEN_KEY = "excalidraw-classroom-tour-seen";

/** whether the tour is on the screen */
export const tourOpenAtom = atom(false);

export const openTour = () => appJotaiStore.set(tourOpenAtom, true);

export const closeTour = () => appJotaiStore.set(tourOpenAtom, false);

/** the tour is offered once: this says if it has been seen (storage may be blocked, then it is shown each time) */
export const hasSeenTour = () => {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "yes";
  } catch {
    return false;
  }
};

export const markTourSeen = () => {
  try {
    window.localStorage.setItem(SEEN_KEY, "yes");
  } catch {
    // storage is blocked: the tour will be offered again, which is harmless
  }
};
