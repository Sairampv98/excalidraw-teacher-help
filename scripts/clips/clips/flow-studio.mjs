// A flowchart from a preset, drawn as ordinary shapes, and played as an animation.
export default {
  id: "flow-studio",
  group: "Animated flowcharts",
  title: "An animated flowchart",
  line: "Pick a kind of chart in the Flow tab, put it on the page, and play it step by step.",
  posterAt: 14,
  async run(c) {
    const { page } = c;
    const button = (text) => page.locator("button", { hasText: text }).first();

    await c.say("The Flow tab makes charts from presets");
    await c.click(page.locator('button[title="Flow"]'));
    await c.say("Pick a kind: a process, a decision, a cycle, a timeline...");
    await c.click(button("Decision"));
    await c.say("Press Insert chart");
    await c.click(button("Insert chart"));
    await c.wait(1800);

    await c.say(
      "It is made of ordinary shapes and arrows, so you can change it",
      {
        hold: 3000,
      },
    );
    await c.say("Press Play, and the chart lights up step by step");
    await c.click(page.getByRole("button", { name: "Play", exact: true }));
    await c.wait(7000);

    await c.say("Export turns the animation into a GIF, a WebP or an MP4");
    await c.click(
      page.getByRole("button", { name: "Export", exact: true }).last(),
    );
    await c.wait(2500);
  },
};
