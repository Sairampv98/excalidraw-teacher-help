/**
 * The picture of a part of **this tab** (D-352).
 *
 * A YouTube panel is an iframe of YouTube's own player, and a foreign document
 * cannot be drawn into a canvas: no `drawImage`, no `html2canvas`, nothing a
 * page may do to another origin's pixels. What the browser does allow is the
 * **page asking to see its own tab** (`getDisplayMedia`, with the current tab
 * preferred): the teacher presses Allow once, the page gets frames of what the
 * tab shows, and the player's part is cut out of a frame.
 *
 * The stream is kept for a short while after a picture, so a second picture
 * does not ask again, and it is stopped when it has been idle - the browser
 * says "sharing this tab" for as long as it runs, and the teacher's students
 * may be looking at the screen.
 */

export interface TabPicture {
  dataURL: string;
  width: number;
  height: number;
}

/** how long the stream is kept after the last picture */
export const TAB_IDLE_MS = 20_000;

/** a rectangle, as the browser measures an element: in CSS pixels */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where an element is in a frame of the tab, in the frame's own pixels.
 *
 * The frame is the size of the viewport times the device's pixel ratio, so the
 * two scales are measured from the sizes and never assumed. The part of the
 * element that is outside the viewport is not in the frame, so it is cut off;
 * `null` when none of it is inside.
 */
export const regionInFrame = (
  rect: ScreenRect,
  viewport: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null => {
  if (!viewport.width || !viewport.height) {
    return null;
  }

  const scaleX = frame.width / viewport.width;
  const scaleY = frame.height / viewport.height;

  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.height, rect.top + rect.height);

  if (right - left < 1 || bottom - top < 1) {
    return null;
  }

  return {
    x: Math.round(left * scaleX),
    y: Math.round(top * scaleY),
    width: Math.max(1, Math.round((right - left) * scaleX)),
    height: Math.max(1, Math.round((bottom - top) * scaleY)),
  };
};

/** the stream that is kept between two pictures, and the video that plays it */
let session: {
  stream: MediaStream;
  video: HTMLVideoElement;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

const release = () => {
  if (!session) {
    return;
  }

  if (session.timer) {
    clearTimeout(session.timer);
  }

  session.stream.getTracks().forEach((track) => track.stop());
  session.video.srcObject = null;
  session.video.remove();
  session = null;
};

/** the first frame that the browser shows after now */
const nextFrame = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve) => {
    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };

    if (withCallback.requestVideoFrameCallback) {
      withCallback.requestVideoFrameCallback(() => resolve());

      // a still tab sends no frame: the last one is the picture
      setTimeout(resolve, 400);

      return;
    }

    setTimeout(resolve, 150);
  });

const open = async (): Promise<NonNullable<typeof session>> => {
  if (
    session &&
    session.stream.getVideoTracks().some((track) => track.readyState === "live")
  ) {
    if (session.timer) {
      clearTimeout(session.timer);
    }

    return session;
  }

  release();

  const devices =
    typeof navigator === "undefined" ? null : navigator.mediaDevices;

  if (!devices?.getDisplayMedia) {
    throw new TabCaptureError("unsupported");
  }

  let stream: MediaStream;

  try {
    // the options that a browser knows and the type definitions do not
    stream = await devices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
  } catch {
    throw new TabCaptureError("not-shared");
  }

  const [track] = stream.getVideoTracks();

  // a window or a screen has a different geometry from the tab: the part of
  // the frame that is the player could not be found in it
  if (
    (track?.getSettings() as { displaySurface?: string } | undefined)
      ?.displaySurface !== "browser"
  ) {
    stream.getTracks().forEach((each) => each.stop());

    throw new TabCaptureError("not-shared");
  }

  const video = document.createElement("video");

  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  // it is never seen: it is only where the frames are read from
  video.style.cssText =
    "position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);

  await video.play();

  track.addEventListener("ended", release);

  session = { stream, video, timer: null };

  return session;
};

export class TabCaptureError extends Error {
  readonly reason: "unsupported" | "not-shared";

  constructor(reason: "unsupported" | "not-shared") {
    super(reason);
    this.reason = reason;
  }
}

/**
 * The picture of a part of the tab.
 *
 * `rect` is where the part is on the screen, as `getBoundingClientRect` says.
 * It throws a `TabCaptureError` when the browser cannot do it or the teacher
 * did not allow it.
 */
export const captureTabRegion = async (
  rect: ScreenRect,
): Promise<TabPicture | null> => {
  const current = await open();

  try {
    await nextFrame(current.video);

    const frame = {
      width: current.video.videoWidth,
      height: current.video.videoHeight,
    };

    const region = regionInFrame(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      frame,
    );

    if (!region) {
      return null;
    }

    const canvas = document.createElement("canvas");

    canvas.width = region.width;
    canvas.height = region.height;

    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.drawImage(
      current.video,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );

    return {
      dataURL: canvas.toDataURL("image/png"),
      width: region.width,
      height: region.height,
    };
  } finally {
    if (session === current) {
      current.timer = setTimeout(release, TAB_IDLE_MS);
    }
  }
};

/** Stops the stream now, if there is one. */
export const releaseTabCapture = release;

/**
 * The biggest rectangle of an aspect that fits in another, centred (D-362).
 *
 * The player fills a full-screen window, and when the screen is not the
 * player's shape the rest is bars: the picture is the player's own shape,
 * in the middle.
 */
export const fitAspect = (rect: ScreenRect, aspect: number): ScreenRect => {
  const width = Math.min(rect.width, rect.height * aspect);
  const height = width / aspect;

  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
};

/** how long the player is left alone in full screen, so its controls go */
export const FULLSCREEN_SETTLE_MS = 2500;

/**
 * Shares the tab now, so that nothing is asked while the player is full
 * screen (D-362). A stream that is there is kept as it is.
 */
export const ensureTabShared = async (): Promise<void> => {
  const current = await open();

  current.timer = setTimeout(release, TAB_IDLE_MS);
};

/**
 * The picture of a YouTube player, taken with the player **full screen**
 * (D-362).
 *
 * The player on the canvas is as big as the canvas shows it, so a picture of it
 * is that many pixels. Full screen it is as big as the screen. The order is:
 *
 * - full screen is asked for **first**, in the click that asked for the
 *   picture - the browser lets only a click do it;
 * - the tab is shared next, so that nothing is asked while the player is full
 *   screen (a stream that is already there is used);
 * - the player is left alone for a moment, so that its controls go away;
 * - the picture is cut from the frame, in the player's own shape, and full
 *   screen is left.
 *
 * A browser that will not go full screen gets the picture of the player where
 * it is - the picture is never refused for that.
 */
export const captureYoutubePicture = async (
  frame: HTMLElement,
  aspect: number | null,
  settleMs: number = FULLSCREEN_SETTLE_MS,
): Promise<TabPicture | null> => {
  const wanted =
    typeof frame.requestFullscreen === "function"
      ? frame.requestFullscreen().then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);

  try {
    const entered = await wanted;

    await ensureTabShared();

    if (entered && document.fullscreenElement === frame) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));

      const rect = frame.getBoundingClientRect();

      return await captureTabRegion(aspect ? fitAspect(rect, aspect) : rect);
    }

    return await captureTabRegion(frame.getBoundingClientRect());
  } finally {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
  }
};
