import { defineScenario } from "../lib/scenario.mjs";

const iconBox = (page) => page.locator(".help-icon").boundingBox();

// The first screen must not move under a newcomer's hand: the help icon is where it
// will stay, so the first click on it opens the help.
export default defineScenario({
  id: "first-screen-steady",
  rows: ["AC-550"],
  title: "the help icon does not jump when the board is first touched",
  async run(ui) {
    let before;

    await ui.step("the first screen: note where the help icon is", async () => {
      await ui.wait(1500);
      before = await iconBox(ui.page);
      ui.expect(Boolean(before), {
        expected: "a help icon on the first screen",
        observed: "none",
      });
    });

    await ui.step(
      "touch the empty board once: the help icon stays where it was",
      async () => {
        await ui.page.mouse.click(700, 400);
        await ui.wait(500);

        const after = await iconBox(ui.page);

        ui.expect(Math.abs(after.x - before.x) < 4, {
          expected: `the help icon stays at x=${Math.round(before.x)}`,
          observed: `it moved to x=${Math.round(after.x)} (${Math.round(
            after.x - before.x,
          )} px)`,
          hint: "the first click on the help icon, made while it is at the first place, is lost",
        });
      },
    );

    await ui.step(
      "on a fresh first screen, one click on the help icon opens the help",
      async () => {
        await ui.page.reload();
        await ui.page.locator("canvas").first().waitFor({ state: "attached" });
        await ui.wait(1500);
        await ui.page.locator(".help-icon").click();
        await ui.wait(600);
        ui.expect((await ui.page.locator(".HelpDialog").count()) === 1, {
          expected: "the help is open after one click on its icon",
          observed: "nothing opened",
        });
      },
    );
  },
});
