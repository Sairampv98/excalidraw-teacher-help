import { appJotaiStore, atom } from "../app-jotai";

/** whether the "Set up my editor" dialog is on the screen (D-518) */
export const editorSetupOpenAtom = atom(false);

export const openEditorSetup = () =>
  appJotaiStore.set(editorSetupOpenAtom, true);

export const closeEditorSetup = () =>
  appJotaiStore.set(editorSetupOpenAtom, false);

const CHOICE_KEY = "excalidraw-classroom-editor-setup-choice";

/** the last choice, so that the checklist is as the teacher left it (storage may be blocked: then it is the default) */
export const readSavedChoice = (): unknown => {
  try {
    const raw = window.localStorage.getItem(CHOICE_KEY);

    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveChoice = (choice: unknown) => {
  try {
    window.localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // storage is blocked: the checklist starts from the default next time, which is harmless
  }
};
