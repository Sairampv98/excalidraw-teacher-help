import {
  PRESENTER_QUERY_PARAM,
  PRESENTER_WINDOW_NAME,
} from "./presenterChannel";

/**
 * Web APIs don't expose the full monitor layout, so we place the presenter
 * window immediately to the right of the editor window — on the common
 * "laptop/primary on the left, projector/second display on the right" setup
 * that lands it on the second display.
 *
 * If it lands wrong, the user just drags it across and presses `F`. Either way
 * the window is opened as a chromeless popup, so it reads as a projector
 * surface rather than another browser tab.
 */
const getPresenterWindowFeatures = () => {
  const { availWidth, availHeight } = window.screen;

  const width = Math.max(640, Math.floor(availWidth) - 40);
  const height = Math.max(480, Math.floor(availHeight) - 80);

  const left = window.screenX + window.outerWidth + 24;
  const top = window.screenY;

  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
};

export const getPresenterUrl = () => {
  const url = new URL(window.location.href);

  // the presenter mirrors the live editor scene, it is not a scene itself
  url.hash = "";
  url.searchParams.delete("id");
  url.searchParams.set(PRESENTER_QUERY_PARAM, "true");

  return url.toString();
};

/**
 * Opens (or focuses, if it is already open) the presenter window.
 *
 * Must be called from a user gesture, otherwise the browser blocks it.
 */
export const openPresenterView = () => {
  const presenterWindow = window.open(
    getPresenterUrl(),
    PRESENTER_WINDOW_NAME,
    getPresenterWindowFeatures(),
  );

  if (!presenterWindow) {
    console.warn(
      "presenter: window was blocked — allow popups for this origin, or open " +
        `${getPresenterUrl()} in a second window manually`,
    );
    return null;
  }

  presenterWindow.focus();
  return presenterWindow;
};
