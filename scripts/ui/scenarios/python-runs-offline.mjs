import { defineScenario } from "../lib/scenario.mjs";

// D-272: Run works in the browser for Python and JavaScript. A classroom may have no internet:
// the gate refuses every request that leaves this computer, so Python that runs here runs there.
export default defineScenario({
  id: "python-runs-offline",
  rows: ["AC-557"],
  title: "Python runs in the browser editor with no internet",
  async run(ui) {
    await ui.step(
      "open the browser code editor and write print(2 + 3)",
      async () => {
        await ui.page.locator('[data-testid="main-menu-trigger"]').click();
        await ui.page
          .getByText("Code editor (in the browser)", { exact: true })
          .click();
        await ui.wait(2000);
        await ui.page.mouse.click(800, 250);
        await ui.page.keyboard.press("Control+A");
        await ui.page.keyboard.type("print(2 + 3)");
      },
    );

    await ui.step("press Run: the output is 5", async () => {
      await ui.page.locator('[data-testid="code-panel-run"]').click();
      await ui.wait(8000);

      const text = await ui.page.evaluate(() => document.body.innerText);

      ui.expect(
        /Run finished/.test(text) && !/could not be downloaded/i.test(text),
        {
          expected: "the program ran and finished",
          observed: (text.match(/Python could not[^\n]*/) ?? [
            "it did not finish",
          ])[0].slice(0, 200),
          hint: "Python (Pyodide) is fetched from a CDN the first time it is run, so it is missing with no internet",
        },
      );
    });
  },
});
