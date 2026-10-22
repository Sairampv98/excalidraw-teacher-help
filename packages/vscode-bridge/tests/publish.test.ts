/**
 * The **coalesced publish** (D-88).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 *
 * A keystroke in the teacher's editor used to rewrite the whole scene, because
 * the message carries the whole file. The publish is now coalesced: at most
 * one every 100 ms, and the LAST state is always published.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCoalescedPublisher,
  PUBLISH_INTERVAL_MS,
} from "../extension/src/publish";

/** The package root, found by walking up from the working directory. */
const findPackageRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");

    if (existsSync(join(candidate, "extension", "package.json"))) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the vscode-bridge package was not found");
};

/** A clock the test drives by hand. */
const clock = () => {
  let now = 0;

  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

/**
 * A timer the test drives by hand.
 *
 * The pending timer is fired by `advance`, so the test says exactly when the
 * trailing publish happens.
 */
const timers = (time: { now: () => number }) => {
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();

  return {
    setTimer: (run: () => void, delayMs: number) => {
      const handle = next++;
      pending.set(handle, { at: time.now() + delayMs, run });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    fire: (at: number) => {
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= at) {
          pending.delete(handle);
          timer.run();
        }
      }
    },
    size: () => pending.size,
  };
};

describe("the coalesced publish", () => {
  it("AC-118 the editor's text is published at most every 100 ms, and the last state is always published", () => {
    expect(PUBLISH_INTERVAL_MS).toBe(100);

    const time = clock();
    const timer = timers(time);

    /** the text as it stands right now */
    let text = "";

    const published: string[] = [];
    const stamps: number[] = [];

    const publisher = createCoalescedPublisher({
      publish: () => {
        stamps.push(time.now());
        published.push(text);
      },
      now: time.now,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    // A fast typist: a keystroke every 20 ms for a second.
    for (let tick = 0; tick < 50; tick++) {
      text = `line ${tick}`;
      publisher.request();
      time.advance(20);
      timer.fire(time.now());
    }

    // AT MOST one publish every 100 ms: fifty keystrokes in a second are ten
    // publishes, not fifty.
    expect(published.length).toBeGreaterThan(0);
    expect(published.length).toBeLessThanOrEqual(11);

    // and no two publishes ever land inside the same window
    for (let index = 1; index < stamps.length; index++) {
      expect(stamps[index] - stamps[index - 1]).toBeGreaterThanOrEqual(
        PUBLISH_INTERVAL_MS,
      );
    }

    // and the LAST state is always published: the trailing timer carries the
    // text as it is when it fires, so the final keystroke is never lost.
    expect(published[published.length - 1]).toBe("line 49");
  });

  it("AC-118 a pending publish can be flushed, and the last state is the one that goes out", () => {
    const time = clock();
    const timer = timers(time);

    let text = "first";

    const published: string[] = [];

    const publisher = createCoalescedPublisher({
      publish: () => {
        published.push(text);
      },
      now: time.now,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    // the first ask publishes at once: the teacher sees the text
    publisher.request();
    expect(published).toEqual(["first"]);

    // and the next one inside the window is coalesced
    text = "second";
    publisher.request();

    expect(published).toEqual(["first"]);
    expect(publisher.pending).toBe(true);

    // the trailing timer carries the LATEST state
    text = "third";
    time.advance(100);
    timer.fire(time.now());

    expect(published).toEqual(["first", "third"]);
    expect(publisher.pending).toBe(false);

    // and a flush publishes right away, with the state as it is
    text = "fourth";
    publisher.request();
    text = "fifth";
    publisher.flush();

    expect(published).toEqual(["first", "third", "fifth"]);
    expect(publisher.pending).toBe(false);
  });

  it("AC-118 the extension's publish is the coalesced one", () => {
    // The publisher on its own is not enough: the extension has to USE it.
    // The extension cannot be imported here - it needs the `vscode` module -
    // so its own source is read, the way the capture's helper is read.
    const source = readFileSync(
      join(findPackageRoot(), "extension", "src", "extension.ts"),
      "utf8",
    );

    expect(source).toContain("createCoalescedPublisher");
    expect(source).toContain("textPublisher?.request()");

    // and the editor's content is broadcast from ONE place only: the
    // coalescer's own publish. A second one - the direct publish that every
    // keystroke used to make - would put the whole scene rewrite back.
    const broadcasts = source.match(/broadcast\(editorContentMessage\(/g) ?? [];

    expect(broadcasts).toHaveLength(1);
  });
});
