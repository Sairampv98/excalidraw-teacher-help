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

  const pdf = path.join(dir, "demo.pdf");

  fs.writeFileSync(
    pdf,
    demoPdf([
      "Lesson 3: Queues",
      "A queue is first in, first out.",
      "People join at the back of the line.",
      "People leave from the front of the line.",
    ]),
  );

  const words = path.join(dir, "words.png");

  if (!fs.existsSync(words)) {
    runFfmpeg(findFfmpeg(), wordsPictureArgs(words));
  }

  return { video, captions, pdf, words };
};

/** a one-page PDF with selectable text, written by hand (no program is needed to make it) */
export const demoPdf = (lines) => {
  const esc = (text) => text.replace(/([()\\])/g, "\\$1");
  const stream = [
    "BT",
    "/F1 22 Tf",
    "72 720 Td",
    "30 TL",
    ...lines.flatMap((line, index) =>
      index === 0 ? [`(${esc(line)}) Tj`] : [`T* (${esc(line)}) Tj`],
    ),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return pdf;
};

/** a picture of a line of printed words: the thing a teacher photographs from a book */
export const wordsPictureArgs = (output) => [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=white:s=900x260",
  "-vf",
  "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='A queue - first in, first out':fontsize=56:fontcolor=black:x=40:y=60,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Add at the back, remove from the front':fontsize=40:fontcolor=black:x=40:y=150",
  "-frames:v",
  "1",
  output,
];
