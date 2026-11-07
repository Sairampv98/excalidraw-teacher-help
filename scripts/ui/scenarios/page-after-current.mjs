import { defineScenario } from "../lib/scenario.mjs";

const counter = (page) => page.getByText(/^\d+\s*\/\s*\d+$/).first();
const read = async (page) =>
  (await counter(page).textContent()).replace(/\s+/g, "");

export default defineScenario({
  id: "page-after-current",
  rows: ["AC-17"],
  title: "a new page goes after the page you are on",
  async run(ui) {
    await ui.step("the page bar says page 1 of 1", async () => {
      const text = await read(ui.page);

      ui.expect(text === "1/1", { expected: "1/1", observed: text });
    });

    await ui.step("add a page: you are on page 2 of 2", async () => {
      await ui.page.getByRole("button", { name: "Add a page" }).click();
      await ui.wait(400);

      const text = await read(ui.page);

      ui.expect(text === "2/2", { expected: "2/2", observed: text });
    });

    await ui.step(
      "go back to page 1 and add a page: the new page is page 2 of 3, not the last",
      async () => {
        await ui.page.getByRole("button", { name: "Previous page" }).click();
        await ui.wait(300);
        await ui.page.getByRole("button", { name: "Add a page" }).click();
        await ui.wait(400);

        const text = await read(ui.page);

        ui.expect(text === "2/3", {
          expected: "2/3 (the new page goes after the page you were on)",
          observed: text,
        });
      },
    );
  },
});
