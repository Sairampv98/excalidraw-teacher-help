/**
 * AC-561 - the pieces of the installer check themselves: it is compiled and its own self test is run.
 * AC-562 - the two editions: the classroom setup carries the launcher, the student setup does not.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { findCsc } from "../build-gui-installer.mjs";

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
