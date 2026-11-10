/**
 * Makes the list the online setup carries: for each file of a built payload, where to fetch it (the maker's address
 * first, then mirrors, then this project's own copy), its size and its SHA-256. The setup fetches a file from the
 * first address that gives bytes of that hash, so a mirror need not be trusted.
 *
 *   node installer/online/make-online-manifest.mjs --payload <payload folder> --release-base <address ending in />
 *        [--mirror-base <address ending in />] [--out online.json] [--student] [--vscode-payload <folder>]
 *
 * The payload carries VSCodium; the small setup takes Microsoft's VS Code from Microsoft, so `--vscode-payload` is a
 * payload built with `build-payload.mjs --editor vscode` whose VS Code entry takes the place of VSCodium's.
 *
 * The files of this project (the board, the extension, the reader's libraries and models) are fetched from the release
 * (`--release-base` + file name, then `--mirror-base` + file name). The tools of other makers are fetched from the
 * address the payload recorded, pinned to the version, then from the mirrors below.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIRRORS = {
  node: (file) => [
    `https://npmmirror.com/mirrors/node/${file.version}/${file.name}`,
  ],
  python: (file) => [
    `https://cdn.npmmirror.com/binaries/python/${file.version}/${file.name}`,
  ],
  java: (file) => [
    `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/${file.name}`,
  ],
  gcc: () => [],
  vscode: () => [],
};

/** the editor's address in a payload says "latest", which changes: the pinned one names the version */
export const pinned = (file) =>
  file.role === "vscode"
    ? `https://update.code.visualstudio.com/${file.version}/win32-x64-user/stable`
    : file.source;

/** the addresses of one file, the maker's first */
export const addressesOf = (file, { releaseBase, mirrorBase }) => {
  const own = ["app", "extension", "indra-wheels", "indra-models"].includes(
    file.role,
  );
  const urls = [];

  if (own) {
    urls.push(releaseBase + file.name);
    if (mirrorBase) {
      urls.push(mirrorBase + file.name);
    }
  } else {
    if (pinned(file)) {
      urls.push(pinned(file));
    }
    urls.push(...(MIRRORS[file.role]?.(file) ?? []));
    // the project's own copy is the last resort for everything
    urls.push(releaseBase + file.name);
  }

  return [...new Set(urls)];
};

/**
 * The small setup takes Microsoft's VS Code from Microsoft (D-479): the payload carries VSCodium, so its entry is
 * swapped for the VS Code one of `vscodeManifest` (a payload built with `--editor vscode`), which has the hash.
 */
export const withVSCode = (manifest, vscodeManifest) => {
  const code = vscodeManifest?.files?.find((file) => file.role === "vscode");

  if (!code) {
    throw new Error(
      "the small setup needs a VS Code entry: build a payload with --editor vscode and pass it as --vscode-payload",
    );
  }

  return {
    ...manifest,
    files: manifest.files
      .filter((file) => file.role !== "vscode")
      .map((file) => (file.role === "vscodium" ? code : file)),
  };
};

export const makeList = ({
  manifest,
  releaseBase,
  mirrorBase,
  student,
  vscodeManifest,
}) => {
  if (vscodeManifest) {
    manifest = withVSCode(manifest, vscodeManifest);
  }

  const wanted = student
    ? new Set(["vscode", "python", "java", "gcc", "node"])
    : null;

  return {
    schema: 1,
    files: manifest.files
      .filter((file) => !wanted || wanted.has(file.role))
      .map((file) => ({
        role: file.role,
        name: file.name,
        version: file.version,
        size: file.size,
        sha256: file.sha256,
        urls: addressesOf(file, { releaseBase, mirrorBase }),
      })),
  };
};

const parse = (argv) => {
  const args = { out: "online.json", student: false };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === "--payload") {
      args.payload = resolve(argv[++i]);
    } else if (key === "--release-base") {
      args.releaseBase = argv[++i];
    } else if (key === "--mirror-base") {
      args.mirrorBase = argv[++i];
    } else if (key === "--out") {
      args.out = resolve(argv[++i]);
    } else if (key === "--vscode-payload") {
      args.vscodePayload = resolve(argv[++i]);
    } else if (key === "--student") {
      args.student = true;
    }
  }

  return args;
};

export const main = (argv) => {
  const args = parse(argv);

  if (!args.payload || !args.releaseBase) {
    console.error(
      "needs --payload <folder> and --release-base <address ending in />",
    );

    return 2;
  }
  if (
    !args.releaseBase.endsWith("/") ||
    (args.mirrorBase && !args.mirrorBase.endsWith("/"))
  ) {
    console.error("an address that names a folder ends in a slash");

    return 2;
  }

  const manifest = JSON.parse(
    readFileSync(join(args.payload, "manifest.json"), "utf8"),
  );
  const vscodeManifest = args.vscodePayload
    ? JSON.parse(
        readFileSync(join(args.vscodePayload, "manifest.json"), "utf8"),
      )
    : undefined;
  const list = makeList({ manifest, ...args, vscodeManifest });

  writeFileSync(args.out, `${JSON.stringify(list, null, 2)}\n`, "utf8");
  console.log(`${list.files.length} files listed in ${args.out}`);

  return 0;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
