// A YouTube link becomes a video panel on the board: the page holds YouTube's own player.
export default {
  id: "youtube",
  group: "Video and media",
  title: "A YouTube link on the board",
  line: "Paste a YouTube link in the Files tab and the video plays on the board.",
  posterAt: 16,
  // the one clip that goes online: only to YouTube's player and its pictures and streams
  allowHosts: [
    "youtube.com",
    "youtube-nocookie.com",
    "ytimg.com",
    "googlevideo.com",
  ],
  async run(c) {
    const { page } = c;

    await c.say("A YouTube link is added beside the other files");
    await c.click(page.locator('[data-testid="files-youtube-button"]'));
    await c.say("Paste the link of the video");
    await page
      .locator('[data-testid="files-youtube-field"] input')
      .fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await c.wait(1200);
    await page
      .locator('[data-testid="files-youtube-field"] input')
      .press("Enter");
    await c.wait(4000);

    await c.say(
      "It becomes a video panel on the page, with YouTube's own player",
      {
        hold: 3500,
      },
    );
    await c.wait(3000);
  },
};
