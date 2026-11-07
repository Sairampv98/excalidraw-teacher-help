/* eslint-disable no-console */
// The engines the app carries so that it works with no internet: the PDF reader, the reader of
// words in a picture, and Python for the browser editor.
//
//   node scripts/vendor/engines.mjs            fetch what is missing, check every file against its hash
//   node scripts/vendor/engines.mjs --check    check only (nothing is fetched); exit 1 when something is missing or wrong
//   node scripts/vendor/engines.mjs --record   fetch and write the hashes into the list (when a version is changed)
//
// The files go to public/vendor/ (not tracked: they are about 35 MB), so the built app
// serves them from its own address, and so does the offline setup.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

export const LIST_FILE = path.join(HERE, "engines.manifest.json");
export const VENDOR_DIR = path.join(ROOT, "public", "vendor");

export const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

export const readList = (file = LIST_FILE) =>
  JSON.parse(fs.readFileSync(file, "utf8")).files;

/** what is the state of one file of the list in a folder: ok, missing, or wrong (its hash is not the one listed) */
export const checkFile = (dir, entry) => {
  const file = path.join(dir, entry.path);

  if (!fs.existsSync(file)) {
    return "missing";
  }

  return sha256(fs.readFileSync(file)) === entry.sha256 ? "ok" : "wrong";
};

/**
 * Fetches what is missing or wrong, and checks every file against its hash.
 * `fetchBytes(url)` is given so that a test needs no internet. With `record`,
 * the hash that arrives is the one written into the list.
 */
export const fetchEngines = async (
  list,
  { dir = VENDOR_DIR, fetchBytes, record = false, log = () => {} } = {},
) => {
  const result = { ok: [], fetched: [], failed: [] };

  for (const entry of list) {
    const state = record ? "wrong" : checkFile(dir, entry);

    if (state === "ok") {
      result.ok.push(entry.path);
      continue;
    }

    try {
      log(`fetching ${entry.path} ...`);

      const bytes = await fetchBytes(entry.url);
      const hash = sha256(bytes);

      if (record) {
        entry.sha256 = hash;
        entry.bytes = bytes.length;
      } else if (hash !== entry.sha256) {
        throw new Error(
          `the file from ${entry.url} is not the one listed (hash ${hash.slice(
            0,
            12,
          )}..., expected ${entry.sha256.slice(0, 12)}...)`,
        );
      }

      const target = path.join(dir, entry.path);

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      result.fetched.push(entry.path);
    } catch (error) {
      result.failed.push({ path: entry.path, reason: String(error.message) });
    }
  }

  return result;
};

const httpBytes = async (url) => {
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
};

/** the same check and fetch, for the build of the app: it says what is missing, and does not stop the build */
export const ensureEngines = async ({ log = console.log } = {}) => {
  const list = readList();
  const result = await fetchEngines(list, { fetchBytes: httpBytes, log });

  if (result.failed.length) {
    log(
      `the engines could not all be fetched (${result.failed
        .map((f) => f.path)
        .join(
          ", ",
        )}): the PDF reader, the reading of pictures and Python in the browser will need the internet`,
    );
  }

  return result;
};

const main = async (argv) => {
  const record = argv.includes("--record");
  const checkOnly = argv.includes("--check");
  const listJson = JSON.parse(fs.readFileSync(LIST_FILE, "utf8"));

  if (checkOnly) {
    const problems = listJson.files
      .map((entry) => [entry.path, checkFile(VENDOR_DIR, entry)])
      .filter(([, state]) => state !== "ok");

    for (const [name, state] of problems) {
      console.log(`${state}: ${name}`);
    }

    console.log(
      problems.length
        ? `${problems.length} of ${listJson.files.length} files are not as listed`
        : `all ${listJson.files.length} files are as listed`,
    );

    return problems.length ? 1 : 0;
  }

  const result = await fetchEngines(listJson.files, {
    fetchBytes: httpBytes,
    record,
    log: console.log,
  });

  if (record) {
    fs.writeFileSync(LIST_FILE, `${JSON.stringify(listJson, null, 2)}\n`);
  }

  console.log(
    `${result.ok.length} already there, ${result.fetched.length} fetched, ${result.failed.length} failed`,
  );

  for (const failure of result.failed) {
    console.log(`  failed: ${failure.path}: ${failure.reason}`);
  }

  return result.failed.length ? 1 : 0;
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
