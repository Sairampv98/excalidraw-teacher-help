import { createHash } from "node:crypto";

import { defineScenario } from "../lib/scenario.mjs";

const fingerprint = async (page) =>
  createHash("md5")
    .update(await page.screenshot())
    .digest("hex");

// AC-177: the presenter view opens, shows the teacher's scene and page.
// AC-543: what is edited where it stands (a shape moved) reaches the projector too.
export default defineScenario({
  id: "presenter-follows",
  rows: ["AC-177", "AC-543"],
  title: "the presenter window follows what the teacher draws and moves",
  async run(ui) {
    let presenter;

    await ui.step(
      "open the main menu and choose Presenter view: a second window opens",
      async () => {
        await ui.page.locator('[data-testid="main-menu-trigger"]').click();
        [presenter] = await Promise.all([
          ui.context.waitForEvent("page", { timeout: 15000 }),
          ui.page.getByText("Presenter view", { exact: true }).click(),
        ]);
        await presenter.waitForLoadState("load");
        await presenter
          .locator("canvas")
          .first()
          .waitFor({ state: "attached", timeout: 15000 });
        await ui.wait(1500);
        ui.expect((await presenter.locator("canvas").count()) > 0, {
          expected: "the presenter window shows a canvas",
          observed: "no canvas in the presenter window",
        });
      },
    );

    let beforeDraw;

    await ui.step("draw a rectangle in the editor", async () => {
      beforeDraw = await fingerprint(presenter);
      await ui.page.keyboard.press("Escape");
      await ui.page.keyboard.press("r");
      await ui.page.mouse.move(420, 300);
      await ui.page.mouse.down();
      await ui.page.mouse.move(520, 360, { steps: 6 });
      await ui.page.mouse.move(640, 430, { steps: 6 });
      await ui.page.mouse.up();
      await ui.page.keyboard.press("v");
      await ui.wait(1200);
    });

    let afterDraw;

    await ui.step("the presenter window shows the new rectangle", async () => {
      afterDraw = await fingerprint(presenter);
      ui.expect(afterDraw !== beforeDraw, {
        expected: "the presenter picture changes when a rectangle is drawn",
        observed: "the presenter picture is the same as before the rectangle",
      });
    });

    await ui.step(
      "drag the rectangle across the editor by its edge",
      async () => {
        await ui.page.mouse.move(420, 360);
        await ui.page.mouse.down();
        await ui.page.mouse.move(520, 380, { steps: 8 });
        await ui.page.mouse.move(820, 420, { steps: 8 });
        await ui.page.mouse.up();
        await ui.wait(1200);
      },
    );

    await ui.step(
      "the presenter window shows the rectangle in its new place",
      async () => {
        const afterMove = await fingerprint(presenter);

        ui.expect(afterMove !== afterDraw, {
          expected: "the presenter picture changes when the rectangle is moved",
          observed:
            "the presenter picture is still the one from before the move (a change made where an element stands did not reach it)",
        });
      },
    );
  },
});
