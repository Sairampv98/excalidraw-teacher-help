// The classroom set-up: the teacher's editing window on one half of the screen, the presenter
// window (what the class sees on the projector) on the other half.
export default {
  id: "presenter-split",
  group: "Presenting to a class",
  title: "Editor and projector, half the screen each",
  line: "Teach in one window while the class sees the presenter window, which follows every stroke.",
  split: true,
  posterAt: 9,
  async run(c) {
    const { page } = c;
    const top = { at: "top" };
    const both = (left, right, hold = 3200) =>
      Promise.all([
        c.say(left, { ...top, hold }),
        c.right.say(right, { ...top, hold }),
      ]);

    await both(
      "Your window: you teach here",
      "The presenter window: the class sees this",
    );

    // the side panel steps aside on the first touch of the board, so the drawing is not moved under the pen
    await c.click({ x: 300, y: 600 });
    await c.wait(900);
    await page.keyboard.press("r");
    await c.drag({ x: 150, y: 260 }, { x: 330, y: 360 });
    await page.keyboard.press("v");
    await both("Draw a box...", "...and it appears for the class", 2600);

    await page.keyboard.press("t");
    await c.click({ x: 170, y: 440 });
    await page.keyboard.type("Queue", { delay: 140 });
    await page.keyboard.press("Escape");
    await c.wait(600);
    await both("Write a word...", "...and they read it as you write", 2600);

    await c.drag({ x: 240, y: 360 }, { x: 400, y: 330 });
    await both(
      "Move things around...",
      "...and they move for the class too",
      2600,
    );

    await c.glide({ x: 320, y: 690 });
    await c.wait(900);
    await c.click(page.getByRole("button", { name: "Add a page" }));
    await both(
      "Add a page...",
      "...and the presenter follows to the new page",
      3000,
    );
  },
};
