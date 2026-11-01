/**
 * The folders the assistant may read from and write to (D-408).
 *
 * The server is the one that touches the disk, so the rule is here and it is the
 * whole of the rule: nothing is allowed until the person lists a folder - in the
 * arguments the assistant's client starts the server with (`--folder <path>`, as
 * often as needed) or in `EXCALIDRAW_MCP_FOLDERS` (folders separated as the system
 * separates a path list) - and a path is allowed only when what it **really is**
 * lies inside one of them. Real: a link or a shortcut is followed first, so `..`, a
 * link that leads out and a name that only looks inside all end where they end.
 */

import { promises as fs, realpathSync } from "node:fs";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export type FileKind =
  | "image"
  | "video"
  | "captions"
  | "document"
  | "whiteboard"
  | "other";

const EXTENSIONS: Record<Exclude<FileKind, "other">, readonly string[]> = {
  image: [
    "png",
    "jpg",
    "jpeg",
    "jfif",
    "gif",
    "webp",
    "svg",
    "bmp",
    "avif",
    "ico",
  ],
  video: ["mp4", "webm", "mov", "m4v", "ogv"],
  captions: ["srt", "vtt"],
  document: ["md", "markdown", "txt", "pdf"],
  whiteboard: ["excalidraw"],
};

/** the most a file of each kind may be, in bytes */
export const FILE_LIMITS: Record<FileKind, number> = {
  image: 25 * 1024 * 1024,
  video: 400 * 1024 * 1024,
  captions: 2 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  whiteboard: 25 * 1024 * 1024,
  other: 5 * 1024 * 1024,
};

export const kindOf = (name: string): FileKind => {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";

  for (const [kind, extensions] of Object.entries(EXTENSIONS)) {
    if (extensions.includes(extension)) {
      return kind as FileKind;
    }
  }

  return "other";
};

/** an error with the code the protocol gives it */
export class FolderError extends Error {
  readonly code: "bad-arguments" | "not-found" | "too-large" | "failed";

  constructor(code: FolderError["code"], message: string) {
    super(message);
    this.name = "FolderError";
    this.code = code;
  }
}

/** the folders the person listed: the arguments, and the environment */
export const foldersFromConfig = ({
  argv = process.argv.slice(2),
  env = process.env,
}: { argv?: string[]; env?: NodeJS.ProcessEnv } = {}): string[] => {
  const listed: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--folder" && argv[i + 1]) {
      listed.push(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith("--folder=")) {
      listed.push(argv[i].slice("--folder=".length));
    }
  }

  if (env.EXCALIDRAW_MCP_FOLDERS) {
    listed.push(...env.EXCALIDRAW_MCP_FOLDERS.split(delimiter));
  }

  return listed.map((folder) => folder.trim()).filter(Boolean);
};

const isInside = (child: string, root: string) => {
  const path = relative(root, child);

  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

export type Folders = ReturnType<typeof createFolders>;

export const createFolders = (listed: readonly string[]) => {
  // a folder that is not there cannot be allowed
  const roots = listed.flatMap((folder) => {
    try {
      return [realpathSync(resolve(folder))];
    } catch {
      return [];
    }
  });

  const none = () =>
    new FolderError(
      "bad-arguments",
      "No folder is allowed. The person lists one when the server is started (--folder <path>, or EXCALIDRAW_MCP_FOLDERS), and only files inside it can be read or written.",
    );

  /** the real path a name stands for, if it is inside an allowed folder */
  const inside = async (name: string, mustExist: boolean): Promise<string> => {
    if (!roots.length) {
      throw none();
    }

    if (typeof name !== "string" || !name.length || name.includes("\0")) {
      throw new FolderError("bad-arguments", "That is not a path.");
    }

    const wanted = isAbsolute(name) ? resolve(name) : resolve(roots[0], name);
    let real: string;

    try {
      real = await fs.realpath(wanted);
    } catch {
      // a name outside the folders gets the same answer whether it is there or not,
      // so the assistant cannot find out what is on the rest of the disk
      if (!roots.some((root) => isInside(wanted, root))) {
        throw new FolderError(
          "bad-arguments",
          `${name} is outside the folders that are allowed.`,
        );
      }

      if (mustExist) {
        throw new FolderError(
          "not-found",
          `There is no ${name} in the allowed folders.`,
        );
      }

      // a file to be made: where it will be is its folder's real place
      let parent: string;

      try {
        parent = await fs.realpath(dirname(wanted));
      } catch {
        throw new FolderError("not-found", `There is no folder for ${name}.`);
      }

      real = join(parent, basename(wanted));
    }

    if (!roots.some((root) => isInside(real, root))) {
      throw new FolderError(
        "bad-arguments",
        `${name} is outside the folders that are allowed.`,
      );
    }

    return real;
  };

  return {
    roots,

    /** the folders, as they really are */
    allowed: () => [...roots],

    /** a file: its real place, its kind, and its size */
    file: async (name: string) => {
      const real = await inside(name, true);
      const stat = await fs.stat(real);

      if (!stat.isFile()) {
        throw new FolderError(
          "bad-arguments",
          `${name} is a folder, not a file.`,
        );
      }

      return {
        path: real,
        name: basename(real),
        kind: kindOf(real),
        size: stat.size,
      };
    },

    /** the bytes of a file, whole, when it is not larger than its kind may be */
    read: async (name: string, maxBytes?: number): Promise<Buffer> => {
      const real = await inside(name, true);
      const stat = await fs.stat(real);

      if (!stat.isFile()) {
        throw new FolderError(
          "bad-arguments",
          `${name} is a folder, not a file.`,
        );
      }

      const limit = maxBytes ?? FILE_LIMITS[kindOf(real)];

      if (stat.size > limit) {
        throw new FolderError(
          "too-large",
          `${name} is ${Math.round(
            stat.size / 1024 / 1024,
          )} MB; the most for this kind of file is ${Math.round(
            limit / 1024 / 1024,
          )} MB.`,
        );
      }

      return fs.readFile(real);
    },

    /** a file made in an allowed folder - never over one that is there */
    write: async (name: string, bytes: Uint8Array): Promise<string> => {
      if (
        !/^[\w .()-]+(\/[\w .()-]+)*$/.test(name.replace(/\\/g, "/")) ||
        name.split(/[\\/]/).some((part) => part === ".." || part === ".")
      ) {
        throw new FolderError(
          "bad-arguments",
          `${name} is not a name for a file.`,
        );
      }

      if (!roots.length) {
        throw none();
      }

      const wanted = resolve(roots[0], name);

      await fs.mkdir(dirname(wanted), { recursive: true });

      const real = await inside(wanted, false);

      try {
        await fs.writeFile(real, bytes, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new FolderError(
            "bad-arguments",
            `${name} is already there; give another name.`,
          );
        }

        throw error;
      }

      return relative(roots[0], real).replace(/\\/g, "/");
    },

    /** what is in a folder */
    list: async (name?: string) => {
      const real = name === undefined ? roots[0] : await inside(name, true);

      if (!real) {
        throw none();
      }

      const entries = await fs.readdir(real, { withFileTypes: true });
      const out: {
        name: string;
        folder: boolean;
        kind?: FileKind;
        size?: number;
      }[] = [];

      for (const entry of entries.slice(0, 2000)) {
        // a link that leads out of the allowed folders is not shown
        const full = join(real, entry.name);
        let target: string;

        try {
          target = await fs.realpath(full);
        } catch {
          continue;
        }

        if (!roots.some((root) => isInside(target, root))) {
          continue;
        }

        const stat = await fs.stat(target).catch(() => null);

        if (!stat) {
          continue;
        }

        out.push(
          stat.isDirectory()
            ? { name: entry.name, folder: true }
            : {
                name: entry.name,
                folder: false,
                kind: kindOf(entry.name),
                size: stat.size,
              },
        );
      }

      out.sort((a, b) =>
        a.folder === b.folder
          ? a.name.localeCompare(b.name)
          : a.folder
          ? -1
          : 1,
      );

      return { folder: real, entries: out.slice(0, 500), total: out.length };
    },
  };
};
