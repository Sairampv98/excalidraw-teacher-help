/**
 * Handwriting recognition – public entry point.
 *
 * Engine policy (per product decision):
 *   - The local HTR model is the DEFAULT. It is consistent across every
 *     browser, works offline, and keeps ink on-device.
 *   - The browser Handwriting Recognition API is an optional ACCURACY UPGRADE,
 *     used only when `preferApiWhenAvailable` is set AND the API is available
 *     AND we're online (the OS engine may stream/telemetry).
 *
 * `pickRecognizer` returns the engine to use right now, always falling back to
 * whichever engine is actually available.
 */

import { ApiRecognizer } from "./apiRecognizer";
import { HtrRecognizer } from "./htrRecognizer";
import {
  DEFAULT_RECOGNIZER_PREFERENCES,
  type Recognizer,
  type RecognizerPreferences,
} from "./types";

export * from "./types";
export { inkFromElements, strokeFromFreedraw, inkSize } from "./strokes";
export { ApiRecognizer } from "./apiRecognizer";
export { HtrRecognizer } from "./htrRecognizer";

const isOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

export type RecognizerFactories = {
  htr: () => Recognizer;
  api: () => Recognizer;
};

const defaultFactories = (
  prefs: RecognizerPreferences,
): RecognizerFactories => ({
  htr: () =>
    new HtrRecognizer({
      modelUrl: prefs.htrModelUrl,
      language: prefs.language,
    }),
  api: () => new ApiRecognizer(prefs.language ?? "en"),
});

/**
 * Choose a recognizer given preferences and the current environment.
 *
 * Resolution order:
 *   1. If API is preferred + online + actually available → API.
 *   2. Else if HTR is available (model + onnxruntime present) → HTR.
 *   3. Else whichever of the two is available, preferring the configured
 *      `primary`. Returns null if neither can run.
 */
export const pickRecognizer = async (
  prefs: RecognizerPreferences = DEFAULT_RECOGNIZER_PREFERENCES,
  factories: RecognizerFactories = defaultFactories(prefs),
): Promise<Recognizer | null> => {
  const htr = factories.htr();
  const api = factories.api();

  const wantApiFirst = prefs.preferApiWhenAvailable && isOnline();

  if (wantApiFirst && (await api.isAvailable())) {
    htr.dispose?.();
    return api;
  }

  if (await htr.isAvailable()) {
    api.dispose?.();
    return htr;
  }

  // Last resort: API even if it wasn't first choice.
  if (await api.isAvailable()) {
    htr.dispose?.();
    return api;
  }

  htr.dispose?.();
  api.dispose?.();
  return null;
};
