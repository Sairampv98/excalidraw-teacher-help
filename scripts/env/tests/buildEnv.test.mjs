/**
 * AC-566 - the record of the build environment: how a version is read, and what counts as a difference.
 */

import { describe, expect, it } from "vitest";

import { compareEnv, major, matters, parseVersion } from "../build-env.mjs";

describe("AC-566 the record of the build environment", () => {
  it("AC-566 reads a version out of what a tool says", () => {
    expect(parseVersion("v20.19.6")).toBe("20.19.6");
    expect(parseVersion("git version 2.46.0.windows.1")).toBe("2.46.0");
    expect(
      parseVersion("Microsoft (R) Visual C# Compiler version 4.8.9037.0"),
    ).toBe("4.8.9037.0");
    expect(parseVersion("no number here")).toBeNull();
    expect(major("20.19.6")).toBe(20);
    expect(major(null)).toBeNull();
  });

  it("AC-566 a tool that is missing, or of another major version, is a difference that matters; a patch is only said", () => {
    const recorded = {
      tools: {
        node: { version: "20.19.6" },
        ffmpeg: { version: "9.0.2" },
        csc: { version: "4.8.9037" },
        python: { version: "3.15.2" },
      },
    };
    const found = {
      tools: {
        node: { version: "22.1.0" },
        ffmpeg: { version: "9.0.3" },
        csc: { version: null },
        python: { version: "3.15.2" },
      },
    };
    const differences = compareEnv(recorded, found);
    const by = Object.fromEntries(differences.map((d) => [d.id, d]));

    expect(by.node.kind).toBe("major");
    expect(by.ffmpeg.kind).toBe("version");
    expect(by.csc.kind).toBe("missing");
    expect(by.python).toBeUndefined();
    expect(
      differences
        .filter(matters)
        .map((d) => d.id)
        .sort(),
    ).toEqual(["csc", "node"]);
  });

  it("AC-566 the same environment has no difference", () => {
    const same = { tools: { node: { version: "20.19.6" } } };

    expect(compareEnv(same, same)).toEqual([]);
  });
});
