import { createHash } from "node:crypto";

import { defineScenario } from "../lib/scenario.mjs";

const tabs = [
  "Look",
  "Animation",
  "Script",
  "Present in class",
  "Save as preset",
  "Camera",
  "Export",
];
const panel = (page) => page.getByTestId("flow-bar");

export default defineScenario({
  id: "flow-panel",
  rows: ["AC-638", "AC-640"],
  title: "the chart panel and draft preview in both themes",
  async run(ui) {
    await ui.step("insert a chart through the Flow sidebar", async () => {
      await ui.page.setViewportSize({ width: 1280, height: 720 });
      await ui.page.getByTitle("Flow", { exact: true }).click();
      const sidebar = ui.page.locator(".flow-tab");
      await sidebar
        .getByLabel("Script", { exact: true })
        .fill("Plan\nTeach\nDiscuss\nReview");
      await sidebar
        .getByRole("button", { name: "Insert chart", exact: true })
        .click();
      await panel(ui.page).waitFor({ state: "visible" });
      await panel(ui.page)
        .getByRole("tab", { name: "Animation", exact: true })
        .click();
    });

    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await ui.step("switch to the dark theme", async () => {
          await ui.page.getByTestId("main-menu-trigger").click();
          await ui.page.getByLabel(/^Dark mode/).click();
          await ui.page.keyboard.press("Escape");
        });
      }
      for (const tab of tabs) {
        await ui.step(
          `${theme} theme - ${tab} tab at 1280 by 720`,
          async () => {
            await panel(ui.page)
              .getByRole("tab", { name: tab, exact: true })
              .click();
            await ui.wait(250);
            const box = await panel(ui.page).boundingBox();
            ui.expect(
              box &&
                box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= 1281 &&
                box.y + box.height <= 721,
              {
                expected: "the whole panel fits the viewport",
                observed: JSON.stringify(box),
              },
            );
            ui.expect(
              (await panel(ui.page)
                .getByRole("tabpanel", { name: `${tab} options`, exact: true })
                .count()) === 1,
              { expected: `${tab} content`, observed: "missing content" },
            );
          },
        );
      }
      await ui.step(`${theme} theme - expanded animation window`, async () => {
        await panel(ui.page)
          .getByRole("tab", { name: "Animation", exact: true })
          .click();
        await ui.page
          .getByRole("button", { name: "More animation options", exact: true })
          .click();
        const window = ui.page.getByRole("dialog", {
          name: "Animation options",
          exact: true,
        });
        await window.getByLabel("Preview node animation").selectOption("pulse");
        await ui.wait(900);
        const preview = window.getByRole("img", {
          name: "Chart preview",
          exact: true,
        });
        const first = createHash("md5")
          .update(await preview.screenshot())
          .digest("hex");
        await ui.wait(450);
        const next = createHash("md5")
          .update(await preview.screenshot())
          .digest("hex");
        ui.expect(first !== next, {
          expected: "the preview animates",
          observed: "two identical pictures",
        });
        ui.expect(
          !(await window.textContent()).includes("could not be drawn"),
          { expected: "the real chart preview", observed: "preview error" },
        );
      });
      await ui.step(
        `${theme} theme - every expanded sub-tab has the chart preview`,
        async () => {
          const window = ui.page.getByRole("dialog", {
            name: "Animation options",
            exact: true,
          });
          for (const tab of [
            "Meta node",
            "Arrow",
            "Connect / remove arrows",
            "Background",
            "Nodes",
          ]) {
            await window.getByRole("tab", { name: tab, exact: true }).click();
            ui.expect(
              await window
                .getByRole("img", { name: "Chart preview", exact: true })
                .isVisible(),
              { expected: `preview for ${tab}`, observed: "no preview" },
            );
          }
        },
      );
      await ui.step(
        `${theme} theme - Escape discards the draft and returns focus`,
        async () => {
          await ui.page.keyboard.press("Escape");
          ui.expect(
            (await ui.page
              .getByRole("dialog", { name: "Animation options", exact: true })
              .count()) === 0,
            { expected: "closed option window", observed: "still open" },
          );
          ui.expect(
            await ui.page
              .getByRole("button", {
                name: "More animation options",
                exact: true,
              })
              .evaluate((node) => node === document.activeElement),
            { expected: "focus back on the opener", observed: "focus lost" },
          );
        },
      );
    }

    await ui.step(
      "the pill closes, opens by keyboard and keeps the last tab",
      async () => {
        await panel(ui.page)
          .getByRole("tab", { name: "Camera", exact: true })
          .click();
        await ui.page
          .getByLabel("Collapse the animation bar into a pill")
          .click();
        await ui.page.getByTestId("flow-bar-pill").focus();
        await ui.page.keyboard.press("Enter");
        ui.expect(
          (await panel(ui.page)
            .getByRole("tab", { name: "Camera", exact: true })
            .getAttribute("aria-selected")) === "true",
          { expected: "Camera still selected", observed: "tab forgotten" },
        );
      },
    );

    await ui.step("a 100-node chart opens in the same preview", async () => {
      await panel(ui.page)
        .getByRole("tab", { name: "Script", exact: true })
        .click();
      await panel(ui.page)
        .getByLabel("Fit mode", { exact: true })
        .selectOption("larger");
      await panel(ui.page)
        .getByRole("textbox", { name: "Script", exact: true })
        .fill(
          Array.from({ length: 100 }, (_, index) => `Node ${index + 1}`).join(
            "\n",
          ),
        );
      await panel(ui.page)
        .getByRole("button", { name: "Apply", exact: true })
        .click();
      await ui.wait(800);
      ui.expect((await panel(ui.page).count()) === 1, {
        expected: "the panel stays after the script is applied",
        observed: "the panel is gone",
      });
      await panel(ui.page)
        .getByRole("tab", { name: "Animation", exact: true })
        .click();
      await ui.page
        .getByRole("button", { name: "More animation options", exact: true })
        .click();
      await ui.wait(1500);
      const window = ui.page.getByRole("dialog", {
        name: "Animation options",
        exact: true,
      });
      ui.expect((await window.textContent()).includes("100 nodes"), {
        expected: "all 100 nodes",
        observed: await window.textContent(),
      });
      ui.expect(!(await window.textContent()).includes("could not be drawn"), {
        expected: "100-node preview drawn",
        observed: "preview error",
      });
      await window.getByRole("button", { name: "Close", exact: true }).click();
    });

    await ui.step("a narrow window keeps the panel inside it", async () => {
      await ui.page.setViewportSize({ width: 800, height: 600 });
      await ui.wait(400);
      for (const tab of ["Animation", "Script", "Export"]) {
        await panel(ui.page)
          .getByRole("tab", { name: tab, exact: true })
          .click();
        const box = await panel(ui.page).boundingBox();
        ui.expect(
          box &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= 801 &&
            box.y + box.height <= 601,
          {
            expected: `the ${tab} tab fits 800 by 600`,
            observed: JSON.stringify(box),
          },
        );
      }
    });

    await ui.step(
      "no external request or console error during the flow checks",
      async () => {
        ui.expect(ui.faults.outside.length === 0, {
          expected: "no external requests",
          observed: String(ui.faults.outside.length),
        });
        ui.expect(ui.app.realConsoleErrors().length === 0, {
          expected: "no console errors",
          observed: ui.app.realConsoleErrors().join(" | "),
        });
      },
    );
  },
});
