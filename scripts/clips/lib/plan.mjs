// The parts of the recorder that are plain arithmetic and plain data, so they can be checked.

/** the size every clip is filmed at: the app as a teacher's screen shows it */
export const CLIP_SIZE = { width: 1280, height: 720 };

/** how long a caption is held so that it can be read: a pause for the words, never less than 1.4 s */
export const readingTime = (text) =>
  Math.max(1400, Math.min(6000, 600 + String(text).split(/\s+/).length * 320));

/** the points of a smooth glide from one place to another (an ease in and out) */
export const glidePoints = (from, to, steps = 18) => {
  const points = [];

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

    points.push({
      x: Math.round(from.x + (to.x - from.x) * eased),
      y: Math.round(from.y + (to.y - from.y) * eased),
    });
  }

  return points;
};

/** the line of the manifest for one clip: what the app shows beside it */
export const manifestEntry = (clip, files) => ({
  id: clip.id,
  title: clip.title,
  line: clip.line,
  group: clip.group,
  seconds: files.seconds,
  bytes: files.bytes,
  video: `clips/${clip.id}.webm`,
  poster: `clips/${clip.id}.jpg`,
});

/** a clip is complete when it says what it is for and how it is told */
export const checkClip = (clip) => {
  const problems = [];

  for (const key of ["id", "title", "line", "group"]) {
    if (!clip?.[key] || typeof clip[key] !== "string") {
      problems.push(`${clip?.id ?? "a clip"}: no ${key}`);
    }
  }

  if (typeof clip?.run !== "function") {
    problems.push(`${clip?.id ?? "a clip"}: no run function`);
  }

  if (clip?.id && !/^[a-z0-9-]+$/.test(clip.id)) {
    problems.push(`${clip.id}: the id may hold only a-z, 0-9 and -`);
  }

  return problems;
};

/**
 * The list ffmpeg reads to turn the frames of a screencast into a film: each
 * frame stays for as long as it was on the screen. A screencast sends a frame
 * only when the picture changes, so the times are not even.
 */
export const concatList = (frames, { lastFor = 0.5 } = {}) => {
  const lines = [];

  frames.forEach((frame, index) => {
    const next = frames[index + 1];
    const seconds = next ? Math.max(0.001, next.at - frame.at) : lastFor;

    lines.push(`file '${frame.file}'`, `duration ${seconds.toFixed(3)}`);
  });

  if (frames.length) {
    // the last file is named again, or the last duration is ignored
    lines.push(`file '${frames[frames.length - 1].file}'`);
  }

  return `${lines.join("\n")}\n`;
};
