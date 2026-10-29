import type { Sticker } from "./catalog";

/**
 * Every bundled sticker file, as a URL the build gives it (D-157). They are our
 * own files served from our own origin - nothing here reaches a third party.
 */
const urls = import.meta.glob<string>("./assets/*", {
  eager: true,
  query: "?url",
  import: "default",
});

export const stickerUrl = (sticker: Sticker): string | undefined =>
  urls[`./assets/${sticker.file}`];

export const stickerMimeType = (sticker: Sticker) =>
  sticker.kind === "gif" ? "image/gif" : "image/svg+xml";
