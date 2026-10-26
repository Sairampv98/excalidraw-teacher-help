/**
 * AC-192 - the search finds what the teacher means, in the order they would
 * expect (D-158). Pure functions over the real catalog - no DOM.
 */

import { describe, expect, it } from "vitest";

import { STICKERS } from "../emoji/catalog";
import { searchStickers } from "../emoji/search";

import type { Sticker } from "../emoji/catalog";

const ids = (list: readonly Sticker[]) => list.map((s) => s.id);

const sticker = (
  id: string,
  label: string,
  tags: string[],
  kind: Sticker["kind"] = "emoji",
): Sticker => ({ id, label, tags, kind, file: `${id}.svg` });

describe("searching the stickers (AC-192)", () => {
  it("AC-192 an empty query is the popularity order", () => {
    expect(ids(searchStickers(STICKERS, ""))).toEqual(ids(STICKERS));
    expect(ids(searchStickers(STICKERS, "   "))).toEqual(ids(STICKERS));

    // the catalog's own order is what the bar shows first: the skull leads
    expect(searchStickers(STICKERS, "", "emoji")[0].id).toBe("skull");
  });

  it("AC-192 a tag finds its sticker", () => {
    expect(ids(searchStickers(STICKERS, "lmao"))).toContain("joy");
    expect(searchStickers(STICKERS, "launch")[0].id).toBe("rocket");
    expect(ids(searchStickers(STICKERS, "dead"))).toContain("skull");

    // a GIF is found by what it animates, not only by its own words: the
    // skull GIF is called "Dead (shaking)", and "skull" has to find it
    expect(ids(searchStickers(STICKERS, "skull", "gif"))).toContain(
      "skull-shake",
    );
  });

  it("AC-192 every word must match", () => {
    expect(ids(searchStickers(STICKERS, "skull lol"))).toContain("skull");
    expect(searchStickers(STICKERS, "skull rocket")).toEqual([]);
  });

  it("AC-192 a prefix outranks a middle match", () => {
    // "Heart" comes first in the list and has "ear" in the middle; "Earth"
    // starts with it, so it must win
    const small = [
      sticker("heart", "Heart", ["love"]),
      sticker("earth", "Earth", ["world"]),
    ];

    expect(ids(searchStickers(small, "ear"))).toEqual(["earth", "heart"]);

    // equal scores keep the list's order
    const tie = [sticker("a", "Alpha", ["x"]), sticker("b", "Beta", ["x"])];

    expect(ids(searchStickers(tie, "x"))).toEqual(["a", "b"]);
  });

  it("AC-192 the kind filter holds", () => {
    const gifs = searchStickers(STICKERS, "", "gif");

    expect(gifs.length).toBeGreaterThan(0);
    expect(gifs.every((s) => s.kind === "gif")).toBe(true);

    // "fire" exists as an emoji and as a gif - each tab sees only its own
    expect(ids(searchStickers(STICKERS, "fire", "emoji"))).toEqual(["fire"]);
    expect(ids(searchStickers(STICKERS, "fire", "gif"))).toEqual([
      "fire-flicker",
    ]);
  });

  it("AC-192 case and padding do not matter", () => {
    expect(ids(searchStickers(STICKERS, "  ROCKET "))).toEqual(
      ids(searchStickers(STICKERS, "rocket")),
    );
  });

  it("AC-192 nothing matches nothing", () => {
    expect(searchStickers(STICKERS, "zzzzqq")).toEqual([]);
  });
});
