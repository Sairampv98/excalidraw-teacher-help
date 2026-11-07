import { defineScenario } from "../lib/scenario.mjs";

// D-462: the first screen shows how to connect an AI assistant: one press and its clip plays.
export default defineScenario({
  id: "first-screen-assistant",
  rows: ["AC-560"],
  title: "the first screen offers the assistant, and its clip plays",
  async run(ui) {
    await ui.step("the first screen has Connect an AI assistant", async () => {
      ui.expect(
        (await ui.page
          .getByText("Connect an AI assistant", { exact: true })
          .count()) === 1,
        {
          expected: "an item on the first screen: Connect an AI assistant",
          observed: "it is not there",
        },
      );
    });

    await ui.step(
      "press it: the help opens on the assistant clip, playing",
      async () => {
        await ui.page
          .getByText("Connect an AI assistant", { exact: true })
          .click();
        await ui.page
          .locator('[data-testid="feature-video"]')
          .waitFor({ timeout: 8000 });
        await ui.wait(2500);

        const state = await ui.page.evaluate(() => {
          const video = document.querySelector('[data-testid="feature-video"]');

          return {
            src: video.currentSrc,
            ready: video.readyState,
            time: video.currentTime,
            error: video.error ? video.error.code : null,
          };
        });

        ui.expect(
          /assistant-mcp\.webm$/.test(state.src) &&
            state.error === null &&
            state.ready >= 2 &&
            state.time > 0.5,
          {
            expected: "the assistant clip is playing",
            observed: JSON.stringify(state),
          },
        );
      },
    );
  },
});
