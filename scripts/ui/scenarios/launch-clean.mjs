import { outsideByHost } from "../lib/guard.mjs";
import { defineScenario } from "../lib/scenario.mjs";

// Guards the app itself, not one row: opening it in a classroom must be quiet.
export default defineScenario({
  id: "launch-clean",
  rows: [],
  title:
    "the app opens with no error and without reaching outside this computer",
  async run(ui) {
    await ui.step("the app is open, and the canvas is there", async () => {
      ui.expect((await ui.page.locator("canvas").count()) > 0, {
        expected: "a canvas on the page",
        observed: "no canvas",
      });
    });

    await ui.step(
      "wait a few seconds, as a teacher looking at the first screen would",
      async () => {
        await ui.wait(3000);
      },
    );

    await ui.step("nothing went wrong in the console", async () => {
      const errors = ui.app.realConsoleErrors();

      ui.expect(errors.length === 0, {
        expected: "no error in the console",
        observed: `${errors.length} error(s): ${errors
          .slice(0, 2)
          .join(" | ")}`,
      });
    });

    await ui.step("nothing was sent outside this computer", async () => {
      const hosts = outsideByHost(ui.faults.outside);

      ui.expect(hosts.length === 0, {
        expected:
          "no request to any other computer while the app opens (it must work, and stay private, in a classroom with no internet)",
        observed: hosts.map((h) => `${h.host} x${h.count}`).join(", "),
        hint: "the requests are refused by the gate, so this run is the same with or without the internet",
      });
    });
  },
});
