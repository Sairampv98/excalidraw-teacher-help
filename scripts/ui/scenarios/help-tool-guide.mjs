import { defineScenario } from "../lib/scenario.mjs";

const guide = (page) => page.locator('[data-testid="help-tool-guide"]');

// AC-550: the help icon brings up the guide of the tool in use.
export default defineScenario({
  id: "help-tool-guide",
  rows: ["AC-550"],
  title: "the help icon shows the guide of the tool that is selected",
  async run(ui) {
    await ui.step(
      "choose the rectangle tool and press the help icon",
      async () => {
        await ui.page.keyboard.press("r");
        await ui.page.locator(".help-icon").click();
        await guide(ui.page).waitFor({ state: "visible", timeout: 5000 });

        const text = await guide(ui.page).textContent();

        ui.expect(/Rectangle/.test(text), {
          expected: "the guide is the rectangle's",
          observed: text,
        });
      },
    );

    await ui.step(
      "close it, choose the arrow tool and press the help icon: the guide is the arrow's",
      async () => {
        await ui.page.keyboard.press("Escape");
        await ui.wait(300);
        await ui.page.keyboard.press("a");
        await ui.page.locator(".help-icon").click();
        await guide(ui.page).waitFor({ state: "visible", timeout: 5000 });

        const text = await guide(ui.page).textContent();

        ui.expect(/Arrow/.test(text) && !/Rectangle/.test(text), {
          expected: "the guide changed with the tool",
          observed: text,
        });
      },
    );
  },
});
