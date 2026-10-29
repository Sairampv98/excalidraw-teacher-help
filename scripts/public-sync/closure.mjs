/**
 * The closure check of the public mirror.
 *
 * Scrubbing takes files out, and a file that is taken out may be a file a
 * feature needs. The check reads the scrubbed tree and asks of everything it
 * refers to by a relative path - an import, a stylesheet, a script a
 * `package.json` runs - whether the file is in the tree. A missing one is a
 * finding, and the sync stops on it, so that a feature is never published
 * without a file it needs.
 *
 * It is pure: a map of paths to text in, findings out.
 */

const CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|s?css)$/;

const RESOLVE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".scss",
  ".css",
  ".d.ts",
];

const dirname = (path) => path.split("/").slice(0, -1).join("/");

/** joins a relative specifier to a directory, resolving `.` and `..` */
export const resolveRelative = (directory, specifier) => {
  const parts = directory ? directory.split("/") : [];

  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
};

/** whether a path, as it is written, or with an extension, or as a folder's index, is in the tree */
const exists = (paths, target) =>
  RESOLVE_EXTENSIONS.some((extension) => paths.has(`${target}${extension}`)) ||
  RESOLVE_EXTENSIONS.some((extension) =>
    paths.has(`${target}/index${extension}`),
  ) ||
  // a stylesheet partial: `_name.scss`
  (() => {
    const slash = target.lastIndexOf("/");
    const partial = `${target.slice(0, slash + 1)}_${target.slice(slash + 1)}`;

    return RESOLVE_EXTENSIONS.some((extension) =>
      paths.has(`${partial}${extension}`),
    );
  })();

const IMPORT_RE =
  /(?:\bfrom\s+|\bimport\s*\(\s*(?:\/\*.*?\*\/\s*)?|\bimport\s+|\brequire\(\s*|@use\s+|@import\s+|\bexport\s+\*\s+from\s+)["'](\.{1,2}\/[^"'?]+)(?:\?[^"']*)?["']/g;

const URL_RE = /url\(\s*["']?(\.{1,2}\/[^"')?#]+)/g;

const SCRIPT_PATH_RE =
  /(?:^|\s)(\.{0,2}\/?(?:[\w.-]+\/)+[\w.-]+\.(?:[cm]?[jt]s|json|sh|ps1))(?=\s|$)/g;

/**
 * The files the scrubbed tree refers to that it does not hold.
 * Each finding says which file refers to which.
 */
export const checkClosure = (files) => {
  const paths = new Set(files.keys());
  const missing = [];

  for (const [path, content] of files) {
    if (typeof content !== "string") {
      continue;
    }

    if (CODE_EXTENSIONS.test(path)) {
      const directory = dirname(path);

      for (const re of [IMPORT_RE, URL_RE]) {
        re.lastIndex = 0;

        let match;

        while ((match = re.exec(content))) {
          const target = resolveRelative(directory, match[1]);

          if (!exists(paths, target)) {
            missing.push({ file: path, needs: target });
          }
        }
      }
    }

    // the scripts a package runs, written as paths
    if (path.endsWith("package.json")) {
      let json;

      try {
        json = JSON.parse(content);
      } catch {
        continue;
      }

      const directory = dirname(path);

      for (const command of Object.values(json.scripts ?? {})) {
        SCRIPT_PATH_RE.lastIndex = 0;

        let match;

        while ((match = SCRIPT_PATH_RE.exec(` ${command}`))) {
          const written = match[1];

          if (written.startsWith("/") || /^[a-z]+:/.test(written)) {
            continue;
          }

          const target = resolveRelative(
            written.startsWith(".") ? directory : "",
            written,
          );

          if (!paths.has(target)) {
            missing.push({ file: path, needs: target });
          }
        }
      }
    }
  }

  return missing;
};

export const describeMissing = ({ file, needs }) =>
  `${file} needs ${needs}, which is not in the tree`;
