// A picture goes on the board and can be cropped to the part that matters.
export default {
  id: "picture-crop",
  group: "Files, documents and pictures",
  title: "Put a picture on the board and crop it",
  line: "Open a picture from the Files tab, put it on the board, and crop it to the part you need.",
  posterAt: 12,
  async run(c) {
    const { page } = c;

    await c.say("Open a picture from the Files tab");
    await c.choose(page.locator('[data-testid="files-open-files"]'), [
      c.assets.words,
    ]);
    await c.click(page.locator('button.app-file-list__row[title="words.png"]'));
    await c.say("Press the button at the bottom to put it on the board");
    await c.click(page.locator(".app-sidebar-primary"));
    await c.wait(1500);

    await c.say("Double-click the picture to crop it");
    await page.mouse.dblclick(600, 350);
    await c.wait(2000);
    await c.say("Drag the corners to keep only the part you need");
    await c.drag({ x: 1232, y: 562 }, { x: 900, y: 420 });
    await c.say("Press Apply and the picture on the board is cropped", {
      hold: 2200,
    });
    await c.click(page.getByRole("button", { name: "Apply", exact: true }));
    await c.wait(1800);
    await c.say("Reset in the crop window brings the whole picture back", {
      hold: 3000,
    });
  },
};
