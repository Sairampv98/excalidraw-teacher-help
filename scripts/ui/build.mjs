#!/usr/bin/env node
// Builds the app for the UI gate into node_modules/.cache/ui-gate/build (not tracked), with the telemetry of the build switched off.
//   node scripts/ui/build.mjs
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const vite = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

const result = spawnSync(
  process.execPath,
  [
    vite,
    "build",
    "--outDir",
    path.join(ROOT, "node_modules", ".cache", "ui-gate", "build"),
    "--emptyOutDir",
  ],
  {
    cwd: path.join(ROOT, "excalidraw-app"),
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_APP_DISABLE_SENTRY: "true",
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=4096",
    },
  },
);

process.exit(result.status ?? 1);
