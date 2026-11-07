// Stickers, emoji and GIFs that ship with the app: click one and it lands on the page.
export default {
  id: "stickers",
  group: "Video and media",
  title: "Stickers, emoji and GIFs",
  line: "A bar of emoji and GIFs that come with the app: click one and it lands on the page.",
  posterAt: 8,
  async run(c) {
    const { page } = c;
    const top = { at: "top" };
    // the bar can be folded away to a small smiley; it is opened again when it is needed
    // the bar slides away when it is not used and comes back when the pointer nears the edge
    const barOpen = async () => {
      await c.glide({ x: 640, y: 640 });
      await c.wait(900);

      const handle = page.locator('[aria-label="Show the emoji and GIF bar"]');

      if (await handle.count()) {
        await c.click(handle);
        await c.wait(500);
      }
    };
    const sticker = (n) =>
      page.locator('.excalidraw-sticker-bar [aria-label^="Insert "]').nth(n);

    await barOpen();
    await c.say("At the bottom there is a bar of emoji and GIFs", top);
    await c.say("They come with the app, so they work without internet", top);

    await barOpen();
    await c.click(sticker(3));
    await c.say("Click one and it lands on the page", { ...top, hold: 2000 });

    await barOpen();
    await c.click(
      page
        .locator(".excalidraw-sticker-bar__tabs")
        .getByText("GIF", { exact: true }),
    );
    await c.say("The GIF tab has moving pictures", top);
    await c.click(sticker(2));
    await c.say("A GIF plays right on the board", { ...top, hold: 3000 });
    await c.wait(1500);
  },
};
