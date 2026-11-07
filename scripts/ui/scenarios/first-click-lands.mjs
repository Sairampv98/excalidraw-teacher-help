import { defineScenario } from "../lib/scenario.mjs";

const sidebarOpen = async (page) => {
  const box = await page
    .locator(".default-sidebar")
    .first()
    .boundingBox()
    .catch(() => null);

  return Boolean(box) && box.x < page.viewportSize().width - 20;
};

// On the first screen the files panel is open and the controls are laid out beside it. The
// first click on a control outside the panel closes the panel, which moves the control: that
// click must still land, and the panel must still close.
export default defineScenario({
  id: "first-click-lands",
  rows: ["AC-551"],
  title:
    "the first click on a control outside the open side panel lands, and the panel closes after it",
  async run(ui) {
    await ui.step("the first screen has the side panel open", async () => {
      await ui.wait(1500);
      ui.expect(await sidebarOpen(ui.page), {
        expected: "the side panel is open on the first screen",
        observed: "it is closed",
      });
    });

    await ui.step(
      "one click on the help icon opens the help, and the panel is closed after",
      async () => {
        await ui.page.locator(".help-icon").click();
        await ui.wait(800);
        ui.expect((await ui.page.locator(".HelpDialog").count()) === 1, {
          expected: "the help is open after one click on its icon",
          observed: "nothing opened (the icon moved away under the pointer)",
        });
        ui.expect(!(await sidebarOpen(ui.page)), {
          expected: "the side panel is closed after the click",
          observed: "it is still open",
        });
      },
    );

    await ui.step(
      "on a fresh first screen, one click on the rectangle tool selects it",
      async () => {
        await ui.page.reload();
        await ui.page.locator("canvas").first().waitFor({ state: "attached" });
        await ui.wait(1500);

        const tool = ui.page.locator('[data-testid="toolbar-rectangle"]');
        const label = ui.page.locator(".ToolIcon", { has: tool }).first();

        await label.click();
        await ui.wait(600);
        ui.expect(await tool.isChecked(), {
          expected: "the rectangle tool is selected after one click",
          observed: "it is not selected (the toolbar moved under the pointer)",
        });
      },
    );
  },
});
