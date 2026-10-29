/**
 * AC-327 - a language that is not here yet is a download, and the page keeps
 * track of it.
 */

import { vi } from "vitest";

import { LANGUAGE_PACKS, createLanguagePacks } from "../bridge/languagePacks";

import type { LanguagePack } from "../bridge/languagePacks";

const memory = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

const withInstall = (
  install: LanguagePack["install"],
): readonly LanguagePack[] => [
  { id: "python", name: "Python", builtIn: true },
  { id: "go", name: "Go", install },
  { id: "java", name: "Java" },
];

describe("AC-327 language packs", () => {
  it("AC-327 the built-in languages are ready, a pack with a source is a download, one without is not available yet", () => {
    const packs = createLanguagePacks({
      packs: withInstall(async () => {}),
      storage: memory(),
    });

    expect(packs.list().map(({ id, state }) => [id, state])).toEqual([
      ["python", "ready"],
      ["go", "download"],
      ["java", "unavailable"],
    ]);
  });

  it("AC-327 the packs the page lists have no source that was not verified", () => {
    // Python and JavaScript are built in; every other language stays "not
    // available yet" until a verified source is added for it
    const states = createLanguagePacks({ storage: memory() })
      .list()
      .map(({ id, state }) => [id, state]);

    expect(states).toContainEqual(["python", "ready"]);
    expect(states).toContainEqual(["javascript", "ready"]);

    for (const pack of LANGUAGE_PACKS.filter((entry) => !entry.builtIn)) {
      expect(pack.install).toBeUndefined();
    }
  });

  it("AC-327 a download reports how far it is, and the pack is ready after it", async () => {
    let finish: () => void = () => {};
    let report: (fraction: number | null) => void = () => {};

    const packs = createLanguagePacks({
      packs: withInstall(
        (onProgress) =>
          new Promise<void>((resolve) => {
            report = onProgress;
            finish = resolve;
          }),
      ),
      storage: memory(),
    });
    const seen: Array<[string, number | null]> = [];

    packs.subscribe(() => {
      const go = packs.list().find((pack) => pack.id === "go")!;

      seen.push([go.state, go.progress]);
    });

    const done = packs.install("go");

    report(0.4);
    finish();
    await done;

    expect(seen).toEqual([
      ["downloading", null],
      ["downloading", 0.4],
      ["ready", null],
    ]);
  });

  it("AC-327 an installed pack is remembered by the next visit", async () => {
    const storage = memory();
    const first = createLanguagePacks({
      packs: withInstall(async () => {}),
      storage,
    });

    await first.install("go");

    const next = createLanguagePacks({
      packs: withInstall(async () => {}),
      storage,
    });

    expect(next.isReady("go")).toBe(true);
    expect(next.isReady("java")).toBe(false);
  });

  it("AC-327 a download that fails leaves the pack a download, and says why", async () => {
    const packs = createLanguagePacks({
      packs: withInstall(async () => {
        throw new Error("network down");
      }),
      storage: memory(),
    });

    await expect(packs.install("go")).rejects.toThrow("network down");
    expect(packs.list().find((pack) => pack.id === "go")!.state).toBe(
      "download",
    );
  });

  it("AC-327 a pack that is not available yet cannot be started", async () => {
    const packs = createLanguagePacks({
      packs: withInstall(async () => {}),
      storage: memory(),
    });
    const listener = vi.fn();

    packs.subscribe(listener);

    await expect(packs.install("java")).rejects.toThrow("not available yet");
    expect(listener).not.toHaveBeenCalled();
  });
});
