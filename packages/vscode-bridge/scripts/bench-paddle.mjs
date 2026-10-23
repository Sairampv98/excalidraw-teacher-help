#!/usr/bin/env node
/**
 * Measure the PaddleOCR engine **for real**, through the sidecar.
 *
 * The sidecar that ships with the extension is the thing that has to work, so
 * this drives THAT script, over its own stdio protocol - one JSON object per
 * line - with a real Python and a real frame. It is the harness behind the
 * numbers wave 5o reported (D-106).
 *
 *   node packages/vscode-bridge/scripts/bench-paddle.mjs \
 *     --python "C:\Users\user\.pyenv\pyenv-win\versions\3.12.10\python.exe" \
 *     --image "C:\Users\user\projects\stream-frame.jpg" \
 *     --out packages/vscode-bridge/tests/fixtures/paddle-fallback.json
 *
 * The sidecar is asked for the same frame twice: the first read is the one
 * that may fall back (the fast path crashes, the model is rebuilt), and the
 * second one is the read that REUSES the model that works.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

const args = process.argv.slice(2);

/** The value of a `--flag`, or the fallback when the flag is not there. */
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const python = flag("python", "python");
const image = flag("image", "");
const out = flag("out", "");
const reads = Number.parseInt(flag("reads", "2"), 10) || 2;
// the sidecar to measure: the one that ships, or the one in the source tree
const sidecarFlag = flag("sidecar", "");

if (!image) {
  process.stderr.write(
    "bench-paddle: --image <frame> is required\n" +
      "  node packages/vscode-bridge/scripts/bench-paddle.mjs --python <python> --image <frame>\n",
  );
  process.exit(2);
}

const sidecar = sidecarFlag
  ? resolve(sidecarFlag)
  : join(packageRoot, "extension", "media", "ocr_sidecar.py");
const imageBase64 = readFileSync(image).toString("base64");

// ---------------------------------------------------------------------------
// the sidecar's lines
// ---------------------------------------------------------------------------

/** Every line the sidecar wrote, in order. */
const lines = [];
/** The tests that are waiting for a line that matches. */
const waiting = [];
let buffer = "";

const deliver = (line) => {
  lines.push(line);

  for (let index = 0; index < waiting.length; index++) {
    if (waiting[index].match(line)) {
      waiting.splice(index, 1)[0].resolve(line);
      return;
    }
  }
};

/** The next line that matches - the ones that do not are kept. */
const waitFor = (match) =>
  new Promise((resolveLine) => {
    const found = lines.find(match);
    if (found) {
      resolveLine(found);
      return;
    }
    waiting.push({ match, resolve: resolveLine });
  });

const child = spawn(python, [sidecar], { stdio: ["pipe", "pipe", "pipe"] });

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");

  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");

    if (line) {
      deliver(JSON.parse(line));
    }
  }
});

// the libraries print things; the protocol owns stdout
child.stderr.on("data", () => {});

// ---------------------------------------------------------------------------
// the reads
// ---------------------------------------------------------------------------

const report = await waitFor((line) => line.type === "ready");

process.stdout.write(
  `[sidecar] python ${report.python} ` +
    `paddle=${JSON.stringify(report.engines?.paddle ?? null)}\n`,
);

const answers = [];

for (let index = 0; index < reads; index++) {
  const id = String(index + 1);
  const started = Date.now();

  child.stdin.write(
    `${JSON.stringify({
      id,
      engine: "paddle",
      imageBase64,
      region: null,
    })}\n`,
  );

  const answer = await waitFor((line) => line.id === id);
  answers.push(answer);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (answer.error) {
    process.stdout.write(`read ${id}: ${seconds} s  ERROR=${answer.error}\n`);
  } else {
    process.stdout.write(
      `read ${id}: ${seconds} s  durationMs=${answer.durationMs}  ` +
        `lines=${answer.lines?.length ?? 0}  model=${JSON.stringify(
          answer.model ?? null,
        )}\n`,
    );
  }
}

// the report is written AGAIN when the model is rebuilt, so the LAST one says
// how the model was built (D-107)
const lastReport = lines.filter((line) => line.type === "ready").pop();
const model = answers[0]?.model ?? {};

const record = {
  engine: "paddle",
  python: report.python,
  image: image.split("\\").join("/"),
  // the fall-back: the engine ran WITHOUT oneDNN (D-106)
  fellBack: model.mkldnn === false,
  oneDNN: model.mkldnn !== false,
  // the first read is the one that fell back; the second reuses the model
  durationMs: answers[0]?.durationMs ?? null,
  reusedDurationMs: answers[1]?.durationMs ?? null,
  lines: answers[0]?.lines?.length ?? 0,
  textLength: (answers[0]?.text ?? "").length,
  reportModel: lastReport?.engines?.paddle?.model ?? null,
};

process.stdout.write(`record: ${JSON.stringify(record, null, 2)}\n`);

if (out) {
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`written: ${target}\n`);
}

child.kill();
