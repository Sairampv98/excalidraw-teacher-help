import type { Sticker, StickerKind } from "./catalog";

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * How well one query word matches one sticker: 2 when it starts a word of the
 * label or a tag (a prefix), 1 when it is only somewhere inside one, 0 when it
 * is not there at all.
 */
const wordScore = (word: string, sticker: Sticker): number => {
  const tokens = [...words(sticker.label), ...sticker.tags];

  if (tokens.some((token) => token.startsWith(word))) {
    return 2;
  }

  return tokens.some((token) => token.includes(word)) ? 1 : 0;
};

/**
 * The stickers a query means (D-158).
 *
 * Every word of the query has to match, a prefix outranks a match in the
 * middle of a word, and ties keep the catalog's popularity order. An empty
 * query is the whole set in popularity order; a query that matches nothing is
 * an empty list, never the whole set.
 */
export const searchStickers = (
  stickers: readonly Sticker[],
  query: string,
  kind?: StickerKind,
): Sticker[] => {
  const pool = kind ? stickers.filter((s) => s.kind === kind) : [...stickers];
  const terms = words(query);

  if (terms.length === 0) {
    return pool;
  }

  return pool
    .map((sticker, order) => {
      let score = 0;

      for (const term of terms) {
        const s = wordScore(term, sticker);

        if (s === 0) {
          return null;
        }
        score += s;
      }

      return { sticker, score, order };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((row) => row.sticker);
};
