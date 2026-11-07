import { defineScenario } from "../lib/scenario.mjs";

const tour = (page) => page.locator('[data-testid="guided-tour"]');

// AC-548: the first launch shows the tour, it points at real controls, it can be left,
// and once left it does not come back by itself (it comes back from the menu).
export default defineScenario({
  id: "tour-first-launch",
  rows: ["AC-548", "AC-549"],
  tour: true,
  title:
    "the first launch walks a newcomer through the controls, and is shown once",
  async run(ui) {
    await ui.step(
      "open the app for the first time: the tour is on the screen",
      async () => {
        await tour(ui.page).waitFor({ state: "visible", timeout: 10000 });
        ui.expect(
          (await ui.page.getByText("Welcome to the classroom board").count()) >
            0,
          {
            expected: "the first card says welcome",
            observed: "no welcome card",
          },
        );
      },
    );

    await ui.step("Next: the tools step lights up the toolbar", async () => {
      await ui.page.locator('[data-testid="guided-tour-next"]').click();
      await ui.wait(600);
      ui.expect((await ui.page.locator(".GuidedTour__spot").count()) === 1, {
        expected: "a lit-up box around the toolbar",
        observed: "no lit-up box",
      });

      const spot = await ui.page.locator(".GuidedTour__spot").boundingBox();
      const toolbar = await ui.page.locator(".App-toolbar").boundingBox();

      ui.expect(
        Boolean(spot && toolbar) &&
          Math.abs(spot.x - (toolbar.x - 8)) < 40 &&
          Math.abs(spot.y - (toolbar.y - 8)) < 40,
        {
          expected: "the lit-up box sits on the toolbar",
          observed: `box ${JSON.stringify(spot)} / toolbar ${JSON.stringify(
            toolbar,
          )}`,
        },
      );
    });

    await ui.step(
      "Next through every step: each one with a control lights it up, and the last says start drawing",
      async () => {
        const seen = [];

        for (let guard = 0; guard < 12; guard += 1) {
          const label = await ui.page
            .locator('[data-testid="guided-tour-next"]')
            .textContent();

          seen.push({
            title: await ui.page.locator(".GuidedTour__title").textContent(),
            lit: (await ui.page.locator(".GuidedTour__spot").count()) === 1,
          });

          if (label === "Start drawing") {
            break;
          }

          await ui.page.locator('[data-testid="guided-tour-next"]').click();
          await ui.wait(350);
        }

        const dark = seen.filter(
          (s) => !s.lit && !/Welcome|ready/.test(s.title),
        );

        ui.expect(dark.length === 0, {
          expected:
            "every step except the first and the last lights up a control",
          observed: `no control found for: ${dark
            .map((s) => s.title)
            .join(", ")}`,
          hint: "the steps and where they point are in excalidraw-app/tour/tourSteps.ts",
        });
        ui.expect(/ready/.test(seen[seen.length - 1].title), {
          expected: "the last card says you are ready",
          observed: seen[seen.length - 1].title,
        });
      },
    );

    await ui.step(
      "Start drawing: the tour closes and the board can be used",
      async () => {
        await ui.page.locator('[data-testid="guided-tour-next"]').click();
        await ui.wait(300);
        ui.expect((await tour(ui.page).count()) === 0, {
          expected: "the tour is gone",
          observed: "the tour is still on the screen",
        });
      },
    );

    await ui.step(
      "open the app again: the tour does not come back",
      async () => {
        await ui.page.reload();
        await ui.page.locator("canvas").first().waitFor({ state: "attached" });
        await ui.wait(2500);
        ui.expect((await tour(ui.page).count()) === 0, {
          expected: "no tour on the second launch",
          observed: "the tour was shown again",
        });
      },
    );

    await ui.step(
      "the menu has Take the tour, and it brings the tour back",
      async () => {
        await ui.page.locator('[data-testid="main-menu-trigger"]').click();
        await ui.page.getByText("Take the tour", { exact: true }).click();
        await tour(ui.page).waitFor({ state: "visible", timeout: 5000 });
        await ui.page.keyboard.press("Escape");
        await ui.wait(300);
        ui.expect((await tour(ui.page).count()) === 0, {
          expected: "Escape leaves the tour",
          observed: "the tour is still there",
        });
      },
    );
  },
});
