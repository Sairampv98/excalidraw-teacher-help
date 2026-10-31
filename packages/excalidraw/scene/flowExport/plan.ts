/**
 * What an exported animation is made of (D-374, D-375, D-376): how long it is,
 * which moment each frame shows, how large the file is and how it is set in the
 * picture.
 *
 * Everything here is a pure function, so the rules are tested without a canvas,
 * an encoder or a browser. The animation's own rules are the overlay's: a step
 * is held for `durationMs`, the steps follow each other, and the marks that run
 * along the arrows restart at every step.
 */

export type FlowExportFormat = "gif" | "webp" | "mp4";

export const FLOW_EXPORT_FORMATS: readonly {
  id: FlowExportFormat;
  label: string;
  extension: string;
  mime: string;
}[] = [
  { id: "gif", label: "GIF", extension: "gif", mime: "image/gif" },
  { id: "webp", label: "WebP", extension: "webp", mime: "image/webp" },
  { id: "mp4", label: "MP4", extension: "mp4", mime: "video/mp4" },
];

/** the frame rates the selector offers (D-375) */
export const FLOW_EXPORT_FPS: readonly number[] = [5, 10, 15, 24, 30, 60];

/** a GIF cannot be played faster than this and stay a GIF people can open */
export const FLOW_EXPORT_GIF_MAX_FPS = 30;

/** the rate a format starts at (D-375) */
export const FLOW_EXPORT_DEFAULT_FPS: Readonly<
  Record<FlowExportFormat, number>
> = {
  gif: 15,
  webp: 15,
  mp4: 30,
};

/** the frame rates a format offers: a GIF has no 60 */
export const fpsChoicesOf = (format: FlowExportFormat): readonly number[] =>
  format === "gif"
    ? FLOW_EXPORT_FPS.filter((fps) => fps <= FLOW_EXPORT_GIF_MAX_FPS)
    : FLOW_EXPORT_FPS;

/** the frame rate, kept to what the format offers: the nearest choice */
export const clampFps = (format: FlowExportFormat, fps: number): number => {
  const choices = fpsChoicesOf(format);

  if (!Number.isFinite(fps)) {
    return FLOW_EXPORT_DEFAULT_FPS[format];
  }

  return choices.reduce((best, choice) =>
    Math.abs(choice - fps) < Math.abs(best - fps) ? choice : best,
  );
};

/** the longest an export runs, in milliseconds (D-374) */
export const FLOW_EXPORT_MAX_MS = 60_000;

/** the most frames an export makes: memory and time stay in bounds (D-379) */
export const FLOW_EXPORT_MAX_FRAMES = 1800;

/** the longest side of the picture, in pixels (D-375) */
export const FLOW_EXPORT_SIZES: readonly number[] = [480, 720, 1080, 1920];

export const FLOW_EXPORT_DEFAULT_SIZE = 720;

export type FlowExportShape = "chart" | "landscape" | "square" | "portrait";

/** the shape of the picture: width over height, or the chart's own */
export const FLOW_EXPORT_SHAPES: readonly {
  id: FlowExportShape;
  label: string;
  ratio: number | null;
}[] = [
  { id: "chart", label: "As the chart", ratio: null },
  { id: "landscape", label: "16:9", ratio: 16 / 9 },
  { id: "square", label: "Square", ratio: 1 },
  { id: "portrait", label: "Portrait 9:16", ratio: 9 / 16 },
];

/* ---------------------------------------------------------------- the timeline */

/** how long one full run of the steps takes, never more than the limit */
export const exportLengthMs = (stepCount: number, durationMs: number): number =>
  Math.min(
    FLOW_EXPORT_MAX_MS,
    Math.max(0, Math.floor(stepCount)) * Math.max(0, durationMs),
  );

/** how many pictures a run of `lengthMs` makes at `fps`: at least one */
export const frameCountOf = (lengthMs: number, fps: number): number =>
  Math.max(1, Math.round((lengthMs * fps) / 1000));

/** the moment, in ms from the start, that frame `index` shows */
export const frameTimeMs = (index: number, fps: number): number =>
  (index * 1000) / fps;

/**
 * Which step is current at `timeMs`, and how long it has been current: the
 * marks of the arrows run for that long. The steps loop, as the animation does.
 */
export const stepAt = (
  timeMs: number,
  stepCount: number,
  durationMs: number,
): { stepIndex: number; sinceStepMs: number } => {
  if (stepCount <= 0 || durationMs <= 0) {
    return { stepIndex: 0, sinceStepMs: Math.max(0, timeMs) };
  }

  const whole = Math.floor(timeMs / durationMs);

  return {
    stepIndex: whole % stepCount,
    sinceStepMs: timeMs - whole * durationMs,
  };
};

/**
 * The delay of each GIF frame in hundredths of a second.
 *
 * A GIF counts in hundredths, so a frame rate of 15 is 6.67 of them. The delays
 * are chosen so that the **total** is exact (7, 6, 7, 7, 6 ...): the animation
 * is as long as it was asked to be, and no frame is shorter than 2 (the least
 * every viewer honours).
 */
export const gifDelays = (count: number, fps: number): number[] => {
  const delays: number[] = [];

  for (let i = 0; i < count; i++) {
    const end = Math.round(((i + 1) * 100) / fps);
    const start = Math.round((i * 100) / fps);

    delays.push(Math.max(2, end - start));
  }

  return delays;
};

/** the same for WebP and MP4, which count in milliseconds */
export const frameDelaysMs = (count: number, fps: number): number[] => {
  const delays: number[] = [];

  for (let i = 0; i < count; i++) {
    delays.push(
      Math.max(
        1,
        Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps),
      ),
    );
  }

  return delays;
};

/* ------------------------------------------------------------------ the picture */

/** the nearest even number, at least 2: video wants even sides */
const even = (value: number): number => Math.max(2, 2 * Math.round(value / 2));

/**
 * The picture's size: its longest side is `longest`, and its shape is the
 * chart's own or one of the three that were asked for. Both sides are even.
 */
export const exportSizeOf = (
  chart: { width: number; height: number },
  shape: FlowExportShape,
  longest: number,
): { width: number; height: number } => {
  const preset = FLOW_EXPORT_SHAPES.find((each) => each.id === shape);
  const ratio =
    preset?.ratio ?? (chart.height > 0 ? chart.width / chart.height : 1);

  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

  return safeRatio >= 1
    ? { width: even(longest), height: even(longest / safeRatio) }
    : { width: even(longest * safeRatio), height: even(longest) };
};

/**
 * Where the chart goes in the picture: the scale from scene units to pixels and
 * the offset, so that the chart is whole, centred and has a margin of
 * `marginRatio` of the picture on every side.
 */
export const placeChart = (
  chart: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
  marginRatio = 0.04,
): { scale: number; offsetX: number; offsetY: number } => {
  const marginX = size.width * marginRatio;
  const marginY = size.height * marginRatio;
  const availableWidth = Math.max(1, size.width - 2 * marginX);
  const availableHeight = Math.max(1, size.height - 2 * marginY);

  const scale = Math.min(
    availableWidth / Math.max(1, chart.width),
    availableHeight / Math.max(1, chart.height),
  );

  return {
    scale,
    offsetX: (size.width - chart.width * scale) / 2 - chart.x * scale,
    offsetY: (size.height - chart.height * scale) / 2 - chart.y * scale,
  };
};

/* ---------------------------------------------------------------- the rules */

/** the background choices of a format (D-376) */
export const backgroundChoicesOf = (
  format: FlowExportFormat,
): { transparent: boolean; reason?: string } =>
  format === "mp4"
    ? { transparent: false, reason: "MP4 cannot be transparent" }
    : { transparent: true };

/** why an export cannot run as asked, or null when it can (D-379) */
export const exportProblem = (options: {
  stepCount: number;
  durationMs: number;
  fps: number;
}): string | null => {
  if (options.stepCount < 1) {
    return "There is nothing to animate: choose a chart with steps.";
  }

  const length = exportLengthMs(options.stepCount, options.durationMs);

  if (length <= 0) {
    return "The animation has no length.";
  }

  const frames = frameCountOf(length, options.fps);

  if (frames > FLOW_EXPORT_MAX_FRAMES) {
    return `That is ${frames} pictures; the most is ${FLOW_EXPORT_MAX_FRAMES}. Choose a lower frame rate.`;
  }

  return null;
};

/**
 * How many pictures of the run are looked at to choose a GIF's colours: two for
 * each step, so the highlight of every step is among them, and never fewer than
 * eight or more than twenty-four.
 */
export const paletteSampleCount = (stepCount: number): number =>
  Math.min(24, Math.max(8, Math.floor(stepCount) * 2));

/**
 * Where in the run the first picture is taken: far enough into the first step
 * that its highlight has come in (D-384). A file that is looked at as one
 * picture - a thumbnail, a viewer that does not play it - then shows the chart
 * lit, and not the plain chart a highlight has not yet reached. The run is
 * still one whole round of the steps, and a round is the same wherever it
 * starts, so the file loops with no jump.
 */
export const startOffsetMs = (durationMs: number): number =>
  Math.max(0, Math.min(400, Math.floor(durationMs / 2)));

/** the length of a step in an export, kept to what a step can be (D-390) */
export const clampStepMs = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(60_000, Math.max(100, Math.round(value)))
    : 1200;

/** the most a file may grow to while it is being made, in bytes (D-387) */
export const FLOW_EXPORT_MAX_BYTES = 512 * 1024 * 1024;

/** what is said when a file grows past the most it may be (D-387) */
export const tooLargeMessage = (maxBytes = FLOW_EXPORT_MAX_BYTES): string =>
  `The file has grown past ${Math.round(
    maxBytes / (1024 * 1024),
  )} MB, so the export was stopped. Choose a smaller size, a lower frame rate or a shorter chart.`;

/** the shortest side, in pixels, below which a picture is too small to read (D-386) */
export const FLOW_EXPORT_MIN_SIDE = 240;

/**
 * A word for the person when the picture would come out too narrow or too low to
 * read - a chart of a hundred boxes in a column, in the chart's own shape,
 * is a picture 92 pixels wide - or `null` when it is fine (D-386).
 */
export const sizeHint = (size: {
  width: number;
  height: number;
}): string | null => {
  if (Math.min(size.width, size.height) >= FLOW_EXPORT_MIN_SIDE) {
    return null;
  }

  const shape = size.height > size.width ? "tall" : "wide";

  return `The picture would be only ${size.width}x${size.height}: this chart is very ${shape}, so its boxes would be tiny. Fly the camera to each step, choose a larger size, or choose 16:9, square or portrait.`;
};
