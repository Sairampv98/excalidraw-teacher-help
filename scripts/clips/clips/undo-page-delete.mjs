// A page that is deleted is kept: it can be brought back, even after a reload.
export default {
  id: "undo-page-delete",
  group: "Pages",
  title: "Bring back a deleted page",
  line: "A page you delete is kept, and can be brought back, even after a reload.",
  posterAt: 14,
  async run(c) {
    const { page } = c;

    // deleting asks for a yes: the browser's question is answered yes
    page.on("dialog", (dialog) => dialog.accept());

    // the emoji bar sits over the page bar on a small screen: it is folded away first
    await c.glide({ x: 640, y: 690 });
    await c.wait(900);
    await c.click(page.locator('[aria-label="Hide the emoji and GIF bar"]'));
    await c.wait(600);

    await c.say("Make a page and draw on it");
    await c.click(page.getByRole("button", { name: "Add a page" }));
    await page.keyboard.press("r");
    await c.drag({ x: 450, y: 250 }, { x: 700, y: 380 });
    await page.keyboard.press("v");
    await c.say("This is page 2, with a box on it", { hold: 1800 });

    await c.say("Delete the page...");
    // the page bar slides away when it is not used: the pointer goes to the edge to bring it back
    await c.glide({ x: 640, y: 700 });
    await c.wait(900);
    const remove = page.locator('button[title*="delete this page" i]');

    await c.click(remove);
    await c.say("It asks you to click again, so nothing goes by accident", {
      hold: 2000,
    });
    await c.click(remove);
    await c.wait(1200);
    await c.say("...and it is gone from the page bar", { hold: 1800 });

    await c.say("But it is kept: open the list of deleted pages");
    await c.glide({ x: 640, y: 700 });
    await c.wait(900);
    await c.click(page.locator('[data-testid="deleted-pages-button"]'));
    await c.wait(1200);
    await c.click(page.locator('[data-testid="deleted-page-restore"]').first());
    await c.wait(1500);
    await c.say("Restore it, and the page comes back with its box", {
      hold: 3000,
    });
  },
};
