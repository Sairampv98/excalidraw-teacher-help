#!/usr/bin/env node
/* eslint-disable no-console */
// Films the clips of the app.
//
//   node scripts/clips/run.mjs                 every clip
//   node scripts/clips/run.mjs --only pages    one clip
//   options: --gif (also a GIF, for a README)   --app <folder> (the built app)   --out <folder>
//
// The built app is the one of the UI gate: run `node scripts/ui/build.mjs` first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLIPS } from "./clips/index.mjs";
import { recordClip } from "./lib/record.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const parse = (argv) => {
  const args = { only: [], gif: false };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only") {
      args.only.push(argv[++i]);
    } else if (argv[i] === "--gif") {
      args.gif = true;
    } else if (argv[i] === "--app") {
      args.app = path.resolve(argv[++i]);
    } else if (argv[i] === "--out") {
      args.out = path.resolve(argv[++i]);
    }
  }

  return args;
};

export const main = async (argv) => {
  const args = parse(argv);
  const appDir =
    args.app ?? path.join(ROOT, "node_modules", ".cache", "ui-gate", "build");
  const outDir =
    args.out ?? path.join(ROOT, "excalidraw-app", "public", "clips");
  const rawDir = path.join(ROOT, "node_modules", ".cache", "clips", "raw");

  if (!fs.existsSync(path.join(appDir, "index.html"))) {
    console.error(
      `no built app at ${appDir}: run node scripts/ui/build.mjs first`,
    );

    return 2;
  }

  const chosen = args.only.length
    ? CLIPS.filter((clip) => args.only.includes(clip.id))
    : CLIPS;

  if (!chosen.length) {
    console.error("no clip matches that");

    return 2;
  }

  const manifestFile = path.join(outDir, "manifest.json");
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    : { clips: [] };

  for (const clip of chosen) {
    process.stdout.write(`${clip.id} ... `);

    const entry = await recordClip(clip, {
      appDir,
      outDir,
      rawDir,
      withGif: args.gif,
    });

    manifest.clips = [
      ...manifest.clips.filter((existing) => existing.id !== entry.id),
      entry,
    ];
    console.log(`${entry.seconds} s, ${(entry.bytes / 1024).toFixed(0)} KB`);
  }

  // the order of the list is the order of the clips here
  const order = new Map(CLIPS.map((clip, index) => [clip.id, index]));

  manifest.clips.sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
  );
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  return 0;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(2);
    },
  );
}
