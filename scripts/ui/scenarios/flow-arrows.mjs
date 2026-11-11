import { defineScenario } from "../lib/scenario.mjs";

export default defineScenario({
  id: "flow-arrows",
  rows: [
    "AC-579",
    "AC-580",
    "AC-581",
    "AC-582",
    "AC-583",
    "AC-597",
    "AC-598",
    "AC-599",
    "AC-602",
  ],
  title: "routes, fork branches, marching marks and editor class playback",
  async run(ui) {
    console.log(`UI browser: ${ui.app.browser.version()}`);
    const panel = ui.page.getByTestId("flow-bar");
    await ui.step("insert a network at projector size", async () => {
      await ui.page.setViewportSize({ width: 1280, height: 720 });
      await ui.page.getByTitle("Flow", { exact: true }).click();
      const sidebar = ui.page.locator(".flow-tab");
      await sidebar.getByRole("radio", { name: /^Network/ }).click();
      await sidebar.getByLabel("Script", { exact: true }).fill("A -> B");
      await sidebar
        .getByRole("button", { name: "Insert chart", exact: true })
        .click();
      await panel.waitFor({ state: "visible" });
      if (await ui.page.getByTestId("sidebar-close").isVisible()) {
        await ui.page.getByTestId("sidebar-close").click();
      }
    });
    const examples = [
      ["straight", "A -> B"],
      ["native elbow", "A -> B @elbow"],
      ["two elbows", "A -> B @elbow @elbow"],
      ["mixed elbows and curve", "A -> B @elbow @elbow @curve"],
      ...["left", "right", "in", "out"].map((side) => [
        `side ${side}`,
        `A -> B @elbow:${side} @curve:${side}`,
      ]),
      ...[2, 3, 8].map((count) => [
        `fork ${count}`,
        `A -> ${Array.from(
          { length: count },
          (_, index) => `Branch ${index + 1}`,
        ).join(", ")} @fork-${count}`,
      ]),
      ["reverse fork and loose drops", "B, C -> A @fork-4"],
    ];
    for (const [label, script] of examples) {
      await ui.step(label, async () => {
        if (await ui.page.getByTestId("flow-bar-pill").isVisible()) {
          await ui.page.getByTestId("flow-bar-pill").click();
        }
        await panel.getByRole("tab", { name: "Script", exact: true }).click();
        await panel
          .getByLabel("Script", { exact: true })
          .fill(script.includes("@fork-") ? script : `${script}\nA -> C`);
        await panel.getByRole("button", { name: "Apply", exact: true }).click();
        await panel
          .getByRole("tab", { name: "Animation", exact: true })
          .click();
        await ui.wait(250);
        ui.expect(await panel.isVisible(), {
          expected: "the chart panel remains available",
          observed: "panel disappeared",
        });
        await ui.page
          .getByLabel("Collapse the animation bar into a pill")
          .click();
        await ui.page.locator(".excalidraw").first().focus();
        await ui.page.keyboard.press("Shift+1");
        if (label === "fork 8") {
          await ui.page.getByRole("button", { name: /^Zoom out/ }).click();
          await ui.page.getByRole("button", { name: /^Zoom out/ }).click();
        }
      });
    }
    await ui.step(
      "marching and stepped controls share the preview",
      async () => {
        await ui.page.getByTestId("flow-bar-pill").click();
        await ui.page
          .getByRole("button", { name: "More animation options", exact: true })
          .click();
        const dialog = ui.page.getByRole("dialog", {
          name: "Animation options",
          exact: true,
        });
        await dialog.getByRole("tab", { name: "Arrow", exact: true }).click();
        await dialog
          .getByLabel("Preview arrow animation")
          .selectOption("token");
        await dialog
          .getByLabel("Marching marks alongside the step")
          .selectOption("marching-beam");
        await dialog
          .getByLabel("Marching spacing", { exact: true })
          .fill("120");
        ui.expect(
          await dialog.getByRole("img", { name: "Chart preview" }).isVisible(),
          {
            expected: "the real looping chart preview",
            observed: "preview missing",
          },
        );
        await dialog
          .getByRole("button", { name: "Apply", exact: true })
          .click();
      },
    );
    await ui.step("show in class starts the editor without Play", async () => {
      await panel
        .getByRole("tab", { name: "Present in class", exact: true })
        .click();
      await panel.getByLabel("Show in class", { exact: true }).check();
      ui.expect(await ui.page.locator("[data-flow-class]").isVisible(), {
        expected: "automatic editor loop",
        observed: "no class loop",
      });
      await ui.wait(450);
    });
    await ui.step(
      "unticking show in class removes the editor loop",
      async () => {
        await panel.getByLabel("Show in class", { exact: true }).uncheck();
        ui.expect((await ui.page.locator("[data-flow-class]").count()) === 0, {
          expected: "loop stops when unticked",
          observed: "loop still drawn",
        });
      },
    );
    await ui.step(
      "a typo on line 40 is actionable and a 100-node input still builds",
      async () => {
        await panel.getByRole("tab", { name: "Script", exact: true }).click();
        await panel
          .getByLabel("Fit mode", { exact: true })
          .selectOption("larger");
        const lines = Array.from(
          { length: 99 },
          (_, index) => `Node ${index} -> Node ${index + 1} @elbow @curve`,
        );
        const bad = [...lines];
        bad[39] += " @unknown";
        await panel.getByLabel("Script", { exact: true }).fill(bad.join("\n"));
        ui.expect(
          await panel
            .getByRole("button", { name: "Apply", exact: true })
            .isDisabled(),
          {
            expected: "Apply disabled for the typo",
            observed: "invalid script can be applied",
          },
        );
        ui.expect((await panel.textContent()).includes("40"), {
          expected: "the original line number 40",
          observed: "no line number",
        });
        await panel
          .getByLabel("Script", { exact: true })
          .fill(lines.join("\n"));
        await panel.getByRole("button", { name: "Apply", exact: true }).click();
        await panel
          .getByRole("tab", { name: "Animation", exact: true })
          .click();
        await ui.page
          .getByRole("button", { name: "More animation options", exact: true })
          .click();
        const dialog = ui.page.getByRole("dialog", {
          name: "Animation options",
          exact: true,
        });
        ui.expect((await dialog.textContent()).includes("100 nodes"), {
          expected: "all 100 nodes in the chart",
          observed: "wrong node count",
        });
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
      },
    );
    await ui.step(
      "native arrow tool exposes Fork and branch count",
      async () => {
        await ui.page
          .getByLabel("Collapse the animation bar into a pill")
          .click();
        await ui.page.locator(".excalidraw").first().focus();
        await ui.page.keyboard.press("5");
        ui.expect(
          await ui.page
            .getByRole("button", { name: "Fork", exact: true })
            .isVisible(),
          {
            expected: "Fork in native arrow properties",
            observed: "Fork missing",
          },
        );
        await ui.page.getByLabel("Fork branches", { exact: true }).fill("8");
      },
    );
    await ui.step(
      "narrow editor keeps the fork control reachable",
      async () => {
        await ui.page.setViewportSize({ width: 800, height: 600 });
        if (
          !(await ui.page
            .getByLabel("Fork branches", { exact: true })
            .isVisible())
        ) {
          await ui.page.getByTitle("Arrow type", { exact: true }).click();
        }
        await ui.page.getByLabel("Fork branches", { exact: true }).focus();
        ui.expect(
          await ui.page
            .getByLabel("Fork branches", { exact: true })
            .isVisible(),
          {
            expected: "keyboard-reachable branch count",
            observed: "count off screen",
          },
        );
      },
    );
    await ui.step(
      "the app stays local and reports no browser error",
      async () => {
        ui.expect(ui.faults.outside.length === 0, {
          expected: "no request to another computer",
          observed: String(ui.faults.outside.length),
        });
        ui.expect(ui.app.realConsoleErrors().length === 0, {
          expected: "no browser console errors",
          observed: ui.app.realConsoleErrors().join("\n"),
        });
      },
    );
    await ui.step("draw a fork after its compact popup closes", async () => {
      await ui.page.getByLabel("Fork branches", { exact: true }).fill("3");
      await ui.page.getByRole("button", { name: "Fork", exact: true }).click();
      await ui.page.mouse.move(350, 150);
      await ui.page.mouse.down();
      await ui.page.mouse.move(650, 450, { steps: 8 });
      await ui.page.mouse.up();
      ui.expect(
        !(await ui.page
          .getByLabel("Fork branches", { exact: true })
          .isVisible()),
        {
          expected: "compact popup closes while drawing",
          observed: "popup still open",
        },
      );
    });
  },
});
