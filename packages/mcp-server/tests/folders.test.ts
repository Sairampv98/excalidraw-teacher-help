/**
 * The folders the assistant may use (D-409): nothing until the person lists one,
 * and only what is really inside it - not by its name, not by a way round.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FILE_LIMITS,
  FolderError,
  createFolders,
  foldersFromConfig,
  kindOf,
} from "../src/folders";

/** a folder with a few files in it, and a folder next to it that is not allowed */
const setup = () => {
  const base = mkdtempSync(join(tmpdir(), "mcp-folders-"));
  const allowed = join(base, "class");
  const outside = join(base, "private");

  mkdirSync(join(allowed, "pictures"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(allowed, "notes.md"), "# Notes\n");
  writeFileSync(join(allowed, "pictures", "cat.png"), Buffer.from([1, 2, 3]));
  writeFileSync(join(outside, "secret.txt"), "do not read");

  return { base, allowed, outside, folders: createFolders([allowed]) };
};

const refused = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(FolderError);

    return error as FolderError;
  }

  throw new Error("it was allowed");
};

describe("what is allowed", () => {
  it("AC-485 is nothing until a folder is listed, and says how to list one", async () => {
    const none = createFolders([]);

    expect(none.allowed()).toEqual([]);

    for (const run of [
      () => none.list(),
      () => none.read("a.png"),
      () => none.file("a.png"),
      () => none.write("a.png", new Uint8Array(1)),
    ]) {
      expect((await refused(run)).message).toMatch(/--folder/);
    }
  });

  it("AC-485 is the folders the person listed in the arguments and the environment, and only those that are there", () => {
    const { allowed, base } = setup();
    const second = join(base, "other");

    mkdirSync(second);

    const listed = foldersFromConfig({
      argv: ["--folder", allowed, "--other", "x", `--folder=${second}`],
      env: {
        EXCALIDRAW_MCP_FOLDERS: ["/nowhere/at/all", second].join(delimiter),
      },
    });

    expect(listed).toEqual([allowed, second, "/nowhere/at/all", second]);
    // a folder that is not there is not allowed
    expect(createFolders(listed).allowed()).toHaveLength(3);
    expect(foldersFromConfig({ argv: [], env: {} })).toEqual([]);
  });

  it("AC-485 reads what is inside, by a name relative to the first folder or by its whole path, and says what each file is", async () => {
    const { allowed, folders } = setup();

    expect((await folders.file("notes.md")).kind).toBe("document");
    expect(
      (await folders.file(join(allowed, "pictures", "cat.png"))).kind,
    ).toBe("image");
    expect([...(await folders.read("pictures/cat.png"))]).toEqual([1, 2, 3]);

    const listing = await folders.list();

    expect(listing.entries).toEqual([
      { name: "pictures", folder: true },
      { name: "notes.md", folder: false, kind: "document", size: 8 },
    ]);
    expect((await folders.list("pictures")).entries.map((e) => e.name)).toEqual(
      ["cat.png"],
    );
    expect(kindOf("clip.MP4")).toBe("video");
    expect(kindOf("subs.vtt")).toBe("captions");
    expect(kindOf("board.excalidraw")).toBe("whiteboard");
    expect(kindOf("run.exe")).toBe("other");
  });

  it("AC-485 refuses what is outside: a way up with .., a whole path, and a name that only looks inside", async () => {
    const { outside, folders, base } = setup();

    for (const name of [
      "../private/secret.txt",
      join(outside, "secret.txt"),
      "pictures/../../private/secret.txt",
      join(base, "class-evil", "x.png"),
    ]) {
      const error = await refused(() => folders.read(name));

      // outside is outside, whether the file is there or not
      expect(error.code).toBe("bad-arguments");
      expect(error.message).toMatch(/outside/);
      expect(error.message).not.toMatch(/do not read/);
    }

    expect((await refused(() => folders.list(".."))).message).toMatch(
      /outside/,
    );
    expect((await refused(() => folders.read("a\0b"))).code).toBe(
      "bad-arguments",
    );
    expect((await refused(() => folders.read("missing.png"))).code).toBe(
      "not-found",
    );
    expect((await refused(() => folders.read("pictures"))).message).toMatch(
      /folder, not a file/,
    );
  });

  it("AC-485 follows a link to where it really leads: one that leads out is refused and is not listed", async () => {
    const { allowed, outside, folders } = setup();

    try {
      // a junction needs no special rights on Windows, and is a link elsewhere
      symlinkSync(outside, join(allowed, "shortcut"), "junction");
    } catch {
      // links cannot be made here: nothing to check
      return;
    }

    expect(existsSync(join(allowed, "shortcut", "secret.txt"))).toBe(true);
    expect(
      (await refused(() => folders.read("shortcut/secret.txt"))).message,
    ).toMatch(/outside/);
    expect(
      (await folders.list()).entries.map((entry) => entry.name),
    ).not.toContain("shortcut");
  });

  it("AC-485 refuses a file larger than its kind may be, and says how large that is", async () => {
    const { allowed, folders } = setup();

    writeFileSync(join(allowed, "big.md"), Buffer.alloc(1024));

    const error = await refused(() => folders.read("big.md", 100));

    expect(error.code).toBe("too-large");
    expect(error.message).toMatch(/the most for this kind of file/);
    expect(FILE_LIMITS.image).toBe(25 * 1024 * 1024);
    expect(FILE_LIMITS.video).toBeGreaterThan(FILE_LIMITS.image);
  });

  it("AC-485 writes a new file inside the first folder and never over one that is there, and refuses names that are not names", async () => {
    const { allowed, folders } = setup();

    expect(await folders.write("fetched/cat.png", Buffer.from([9]))).toBe(
      "fetched/cat.png",
    );
    expect(existsSync(join(allowed, "fetched", "cat.png"))).toBe(true);
    expect(
      (await refused(() => folders.write("fetched/cat.png", Buffer.from([8]))))
        .message,
    ).toMatch(/already there/);

    for (const name of [
      "../x.png",
      "a/../../x",
      "/etc/x",
      "a:b",
      "",
      "x/./y",
    ]) {
      expect(
        (await refused(() => folders.write(name, Buffer.from([1])))).code,
      ).toBe("bad-arguments");
    }
  });
});
