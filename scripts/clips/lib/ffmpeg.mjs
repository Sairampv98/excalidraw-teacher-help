// What the recorder asks of ffmpeg, as plain argument lists (so they can be checked without running it).
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const CANDIDATES = [
  process.env.FFMPEG,
  "C:/ProgramData/chocolatey/bin/ffmpeg.exe",
  "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
  "/usr/bin/ffmpeg",
  "/opt/homebrew/bin/ffmpeg",
].filter(Boolean);

/** the ffmpeg of this computer: the one on the path, or one at a usual place */
export const findFfmpeg = () => {
  const onPath = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });

  if (onPath.status === 0) {
    return "ffmpeg";
  }

  const found = CANDIDATES.find((candidate) => fs.existsSync(candidate));

  if (!found) {
    throw new Error("no ffmpeg found: install it or set FFMPEG to its file");
  }

  return found;
};

/** the frames of a screencast, kept for as long as they were shown, as one film at a steady rate */
export const framesToFilmArgs = (listFile, output, { fps = 24 } = {}) => [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  listFile,
  "-vf",
  `fps=${fps}`,
  "-c:v",
  "libx264",
  "-crf",
  "14",
  "-pix_fmt",
  "yuv420p",
  output,
];

/** a short web video: small, silent, plays in every browser the app runs in (also Chrome 109) */
export const webmArgs = (input, output, { width = 960, fps = 24 } = {}) => [
  "-y",
  "-i",
  input,
  "-an",
  "-vf",
  `fps=${fps},scale=${width}:-2:flags=lanczos`,
  "-c:v",
  "libvpx",
  "-b:v",
  "0",
  "-crf",
  "34",
  "-quality",
  "good",
  "-cpu-used",
  "2",
  "-pix_fmt",
  "yuv420p",
  output,
];

/** the same clip as MP4 (H.264), for a place that needs it */
export const mp4Args = (input, output, { width = 960, fps = 24 } = {}) => [
  "-y",
  "-i",
  input,
  "-an",
  "-vf",
  `fps=${fps},scale=${width}:-2:flags=lanczos`,
  "-c:v",
  "libx264",
  "-crf",
  "28",
  "-preset",
  "slow",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  output,
];

/** a picture of the clip, for the place where it waits to be played */
export const posterArgs = (input, output, { at = 1.2, width = 960 } = {}) => [
  "-y",
  "-ss",
  String(at),
  "-i",
  input,
  "-frames:v",
  "1",
  "-vf",
  `scale=${width}:-2:flags=lanczos`,
  "-q:v",
  "4",
  output,
];

/**
 * A GIF that plays by itself where only a picture can (a README): a palette made
 * for this clip, a low frame rate and a width that keeps the file small.
 */
export const gifArgs = (input, output, { width = 800, fps = 10 } = {}) => [
  "-y",
  "-i",
  input,
  "-an",
  "-filter_complex",
  `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  "-loop",
  "0",
  output,
];

export const runFfmpeg = (ffmpeg, args) => {
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(
      `ffmpeg failed (${result.status}): ${(result.stderr || "")
        .split("\n")
        .slice(-6)
        .join("\n")}`,
    );
  }
};
