// The material a clip works on, made with ffmpeg when it is first needed (nothing is downloaded).
import fs from "node:fs";
import path from "node:path";

import { findFfmpeg, runFfmpeg } from "./ffmpeg.mjs";

/** the arguments that make a short moving picture to stand for "a video the teacher has" */
export const demoVideoArgs = (output, { seconds = 8 } = {}) => [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "mandelbrot=size=640x360:rate=24",
  "-t",
  String(seconds),
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-an",
  output,
];

/** captions for it, in the plain format a teacher keeps beside a video */
export const demoCaptions = `WEBVTT

00:00.000 --> 00:04.000
A fractal: the same shape at every size

00:04.000 --> 00:08.000
Zoom in and it keeps going
`;

export const ensureAssets = (dir) => {
  fs.mkdirSync(dir, { recursive: true });

  const video = path.join(dir, "demo.mp4");
  const captions = path.join(dir, "demo.vtt");

  if (!fs.existsSync(video)) {
    runFfmpeg(findFfmpeg(), demoVideoArgs(video));
  }

  fs.writeFileSync(captions, demoCaptions);

  return { video, captions };
};
