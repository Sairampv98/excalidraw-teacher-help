import { defineScenario } from "../lib/scenario.mjs";

const playing = (page) =>
  page.evaluate(async () => {
    const video = document.querySelector('[data-testid="feature-video"]');

    if (!video) {
      return { found: false };
    }

    // give it a moment to start, then see that the picture moves
    await new Promise((resolve) => setTimeout(resolve, 2500));

    return {
      found: true,
      src: video.currentSrc,
      ready: video.readyState,
      time: video.currentTime,
      error: video.error ? video.error.code : null,
    };
  });

// D-462: the help lists what this version adds, each with a clip that plays, with no internet.
export default defineScenario({
  id: "help-features",
  rows: ["AC-560"],
  title: "the help lists what this version adds, and a clip plays",
  async run(ui) {
    await ui.step("press the help icon: the list is there", async () => {
      await ui.page.locator(".help-icon").click();
      await ui.page
        .locator('[data-testid="feature-clips"]')
        .waitFor({ timeout: 8000 });

      const count = await ui.page
        .locator('[data-testid^="feature-watch-"]')
        .count();

      ui.expect(count >= 10, {
        expected: "at least ten clips are listed",
        observed: `${count} clips`,
      });
    });

    await ui.step("Watch the pages clip: it plays in the help", async () => {
      await ui.page.locator('[data-testid="feature-watch-pages"]').click();

      const state = await playing(ui.page);

      ui.expect(
        state.found &&
          state.error === null &&
          state.ready >= 2 &&
          state.time > 0.5,
        {
          expected: "the clip is playing: it has data and its time moves",
          observed: JSON.stringify(state),
          hint: "the clips are in public/clips and are carried by the app",
        },
      );
    });

    await ui.step("Back: the list is shown again", async () => {
      await ui.page.locator('[data-testid="feature-back"]').click();
      ui.expect(
        (await ui.page
          .locator('[data-testid="feature-watch-assistant-mcp"]')
          .count()) === 1,
        {
          expected: "the list is back, with the assistant clip in it",
          observed: "the list is not there",
        },
      );
    });
  },
});
