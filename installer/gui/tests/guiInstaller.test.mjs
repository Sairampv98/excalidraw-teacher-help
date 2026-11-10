/**
 * AC-561 - the pieces of the installer check themselves: it is compiled and its own self test is run.
 * AC-562 - the two editions: the classroom setup carries the launcher, the student setup does not.
 * AC-567 - the proofs for clean Windows machines are here, and tied to no computer.
 * AC-568 - the setup says which Windows it is not for, and a PATH comes back exactly.
 * AC-573 - the Windows 7 build of the setup compiles with the .NET 3.5 compiler and checks itself.
 * AC-577 - the uninstaller can take one tool away and leave the rest.
 * AC-578 - the first screen of the Windows 7 setup says the assistant is not available there.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { findCsc, findCsc35 } from "../build-gui-installer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "..", "build-gui-installer.mjs");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "gui-installer-"));
const hasCompiler = Boolean(findCsc()) && process.platform === "win32";
const windowsOnly = hasCompiler ? describe : describe.skip;

const build = (edition, folder) =>
  execFileSync(
    process.execPath,
    [BUILD, "--no-payload", "--edition", edition, "--out", folder],
    { encoding: "utf8", timeout: 240_000 },
  );

windowsOnly("AC-561 the installer checks its own parts", () => {
  const folder = path.join(out, "classroom");

  beforeAll(() => {
    build("classroom", folder);
  }, 300_000);

  it("AC-561 the three programs are compiled by the compiler that ships with Windows", () => {
    expect(fs.existsSync(path.join(folder, "ClassroomSetup.exe"))).toBe(true);
  });

  it("AC-561 the self test passes: the PATH and variables, archives, the web server, the record, the choices", () => {
    const run = spawnSync(
      path.join(folder, "ClassroomSetup.exe"),
      ["/selftest"],
      {
        encoding: "utf8",
        timeout: 120_000,
      },
    );

    const lines = run.stdout.split("\n").map((line) => line.trim());

    expect(lines.filter((line) => line.startsWith("not ok"))).toEqual([]);
    expect(
      lines.filter((line) => line.startsWith("ok -")).length,
    ).toBeGreaterThan(20);
    expect(lines).toContain("all ok");
    expect(run.status).toBe(0);
  });

  it("AC-568 the setup says which Windows it is not for, and a PATH of any shape comes back exactly", () => {
    const run = spawnSync(
      path.join(folder, "ClassroomSetup.exe"),
      ["/selftest"],
      { encoding: "utf8", timeout: 120_000 },
    );
    const lines = run.stdout.split("\n").map((line) => line.trim());

    for (const wanted of [
      "ok - 32-bit Windows is refused, and the reason says why",
      "ok - Windows 7 is sent to the Windows 7 setup",
      "ok - a Windows 10 older than the lowest build is told to update",
      "ok - a PATH of the shape [C:\\Existing;] comes back exactly",
      "ok - a PATH of the shape [C:\\A;;C:\\B] comes back exactly",
      "ok - a PATH of the shape [%USERPROFILE%\\bin;C:\\B;] comes back exactly",
      "ok - a PATH of the shape [] comes back exactly",
    ]) {
      expect(lines).toContain(wanted);
    }
  });

  it("AC-577 each tool's share of the record is kept, and one tool can be taken away alone", () => {
    const run = spawnSync(
      path.join(folder, "ClassroomSetup.exe"),
      ["/selftest"],
      { encoding: "utf8", timeout: 120_000 },
    );
    const lines = run.stdout.split("\n").map((line) => line.trim());

    for (const wanted of [
      "ok - each tool's own share of the record is kept, and read back",
      "ok - a record from an older setup has no tools and still reads",
      "ok - one tool taken away: its folder, its PATH entry, its variable and its shortcut are gone",
      "ok - and the other tool stays whole: its folder, PATH entry and variable",
      "ok - the record says which is left, and the whole install was not taken away",
      "ok - a tool that is not there is said so, and nothing else is touched",
    ]) {
      expect(lines).toContain(wanted);
    }
  });

  it("AC-577 the uninstaller's help names /remove, and the proof for a machine takes the tools away one by one", () => {
    const run = spawnSync(path.join(folder, "ClassroomSetup.exe"), ["/help"], {
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(run.stdout).toContain("/remove=");

    const proof = fs.readFileSync(path.join(HERE, "vm-real.ps1"), "utf8");

    for (const said of ["/remove=node", "/remove=java,gcc", "/remove=python"]) {
      expect(proof).toContain(said);
    }
  });

  it("AC-561 without a payload the setup says so and installs nothing", () => {
    const run = spawnSync(
      path.join(folder, "ClassroomSetup.exe"),
      ["/silent", `/dir=${path.join(out, "never")}`],
      { encoding: "utf8", timeout: 60_000 },
    );

    expect(run.status).toBe(2);
    expect(fs.existsSync(path.join(out, "never"))).toBe(false);
  });
});

windowsOnly("AC-562 the classroom setup and the student setup", () => {
  const classroom = path.join(out, "classroom-2");
  const student = path.join(out, "student");

  beforeAll(() => {
    build("classroom", classroom);
    build("student", student);
  }, 400_000);

  it("AC-562 the classroom setup carries the launcher and the uninstaller", () => {
    const bytes = fs.readFileSync(path.join(classroom, "ClassroomSetup.exe"));

    expect(bytes.includes(Buffer.from("launcher.exe"))).toBe(true);
    expect(bytes.includes(Buffer.from("uninstall.exe"))).toBe(true);
  });

  it("AC-562 the student setup is a file of its own name, with the uninstaller and no launcher", () => {
    const file = path.join(student, "ClassTools-Setup.exe");

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(path.join(student, "ClassroomSetup.exe"))).toBe(false);

    const bytes = fs.readFileSync(file);

    expect(bytes.includes(Buffer.from("uninstall.exe"))).toBe(true);
    expect(bytes.includes(Buffer.from("launcher.exe"))).toBe(false);
    expect(bytes.includes(Buffer.from("edition.json"))).toBe(true);
  });

  it("AC-562 the student setup passes its self test as well", () => {
    const run = spawnSync(
      path.join(student, "ClassTools-Setup.exe"),
      ["/selftest"],
      {
        encoding: "utf8",
        timeout: 120_000,
      },
    );

    expect(run.stdout).toContain("all ok");
    expect(run.status).toBe(0);
  });
});

describe("AC-567 the proofs for clean Windows machines are in the repository", () => {
  for (const name of ["vm-real.ps1", "vm-student.ps1"]) {
    it(
      "AC-567 " +
        name +
        " checks the install, the tools by name, and that the uninstall leaves the PATH as it was",
      () => {
        const text = fs.readFileSync(path.join(HERE, name), "utf8");

        expect(text).toMatch(/silent install ends well/);
        expect(text).toMatch(/by name|fresh terminal/);
        expect(text).toMatch(/PATH is (exactly )?as it was/);
        expect(text).toMatch(/uninstall ends well/);
        // not tied to one computer: no drive path of a person, no user name
        expect(text).not.toMatch(/C:\\Users\\[A-Za-z]/);
      },
    );
  }
});

const hasCompiler35 = Boolean(findCsc35()) && process.platform === "win32";
const windows7Only = hasCompiler35 ? describe : describe.skip;

windows7Only("AC-573 the Windows 7 build of the setup", () => {
  const folder = path.join(out, "win7");

  beforeAll(() => {
    execFileSync(
      process.execPath,
      [BUILD, "--win7", "--no-payload", "--out", folder],
      { timeout: 240_000 },
    );
  }, 300_000);

  it("AC-573 it is built by the .NET 3.5 compiler and its self test passes", () => {
    const exe = path.join(folder, "ClassroomSetup-Win7.exe");

    expect(fs.existsSync(exe)).toBe(true);

    const run = spawnSync(exe, ["/selftest"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    const lines = run.stdout.split("\n").map((line) => line.trim());

    expect(lines.filter((line) => line.startsWith("not ok"))).toEqual([]);
    expect(lines).toContain(
      "ok - Windows 7 with Service Pack 1 is accepted, 32 and 64 bit",
    );
    expect(lines).toContain(
      "ok - Windows 7 without Service Pack 1 is told to install it",
    );
    expect(lines).toContain(
      "ok - Windows 10 and 11 are sent to the other setup",
    );
    expect(lines).toContain("all ok");
  });

  it("AC-578 its first screen says the assistant is not available on Windows 7, and the other setup's does not", () => {
    // a C# program keeps its text in UTF-16
    const textOf = (file) => fs.readFileSync(file).toString("utf16le");
    const textOfOdd = (file) =>
      fs.readFileSync(file).subarray(1).toString("utf16le");
    const has = (file, words) =>
      textOf(file).includes(words) || textOfOdd(file).includes(words);

    const win7 = path.join(folder, "ClassroomSetup-Win7.exe");
    const classroom = path.join(out, "classroom", "ClassroomSetup.exe");

    expect(has(win7, "The assistant is not available on Windows 7")).toBe(true);
    // and it does not promise one in the first words
    expect(has(win7, "animated flowcharts, and an assistant")).toBe(false);

    expect(has(classroom, "The assistant is not available on Windows 7")).toBe(
      false,
    );
    expect(has(classroom, "animated flowcharts, and an assistant")).toBe(true);
  });
});
