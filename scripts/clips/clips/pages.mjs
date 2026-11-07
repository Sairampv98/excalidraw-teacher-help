// A class is a series of pages: add one, move between them, take them all out as one PDF.
export default {
  id: "pages",
  group: "Pages",
  title: "Pages",
  line: "A class is a series of pages, not one endless board.",
  posterAt: 4,
  async run(c) {
    const { page } = c;

    await c.say("A class is a series of pages, not one endless board");
    await page.keyboard.press("r");
    await c.drag({ x: 380, y: 240 }, { x: 560, y: 340 });
    await page.keyboard.press("v");
    await c.say("This is page 1", { hold: 1500 });

    await c.say("Add a page with the plus in the page bar");
    await c.click(page.getByRole("button", { name: "Add a page" }));
    await c.say("You are on page 2, and it is empty", { hold: 1800 });

    await c.say("Go back to page 1 with the arrow");
    await c.click(page.getByRole("button", { name: "Previous page" }));
    await c.say("Your drawing is where you left it", { hold: 1800 });

    await c.say("Export pages takes them all out as one PDF");
    await c.glide(page.getByText("Export pages", { exact: true }).first());
    await c.wait(1200);
  },
};
