// eslint-disable-next-line no-restricted-imports
import {
  atom,
  Provider,
  useAtom,
  useAtomValue,
  useSetAtom,
  createStore,
  type PrimitiveAtom,
} from "jotai";
import { useLayoutEffect } from "react";

export const appJotaiStore = createStore();

export { atom, Provider, useAtom, useAtomValue, useSetAtom };

export const useAtomWithInitialValue = <
  T extends unknown,
  A extends PrimitiveAtom<T>,
>(
  atom: A,
  initialValue: T | (() => T),
) => {
  const [value, setValue] = useAtom(atom);

  useLayoutEffect(() => {
    if (typeof initialValue === "function") {
      // @ts-ignore
      setValue(initialValue());
    } else {
      setValue(initialValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [value, setValue] as const;
};

/**
 * A picture of a PDF page the teacher asked to have read with OCR (D-279).
 *
 * The viewer sets it; the app, which owns the OCR, reads it and clears it.
 */
export const pdfPageReadRequestAtom = atom<{
  dataURL: string;
  width: number;
  height: number;
} | null>(null);

/**
 * What an OCR read is doing and how far it is (D-288), or null when none runs.
 * The hook sets it; a bar on the screen shows it.
 */
export const ocrProgressAtom = atom<{
  label: string;
  fraction: number | null;
} | null>(null);
