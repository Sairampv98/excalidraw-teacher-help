// A video from a file becomes a panel on the board, with its captions beside it.
export default {
  id: "video-sidebar",
  group: "Video and media",
  title: "A video on the board",
  line: "Open a video from the Files tab and it plays on the board, with its captions beside it.",
  posterAt: 14,
  async run(c) {
    const { page } = c;

    await c.say("The Files tab opens videos, pictures, PDFs and code");
    await c.choose(page.locator('[data-testid="files-open-files"]'), [
      c.assets.video,
      c.assets.captions,
    ]);
    await c.say("A video and its captions file are listed together");

    await c.click(page.locator('button.app-file-list__row[title="demo.mp4"]'));
    await c.say("Pick the video, then press the button at the bottom");
    await c.click(page.locator(".app-sidebar-primary"));
    await c.wait(1500);

    await c.say(
      "It becomes a video panel on the page, and the captions sit beside it",
      {
        hold: 3500,
      },
    );
    await c.wait(2500);
  },
};
