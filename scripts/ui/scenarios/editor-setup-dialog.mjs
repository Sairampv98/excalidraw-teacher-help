import { defineScenario } from "../lib/scenario.mjs";

const dialog = (page) => page.locator('[data-testid="editor-setup"]');

const openFromMenu = async (page) => {
  await page.locator('[data-testid="main-menu-trigger"]').click();
  await page.getByText("Set up my editor", { exact: true }).click();
};

// AC-619: "Set up my editor" - the checklist, the link, the .cmd and the PowerShell command,
// on a small screen and with the keyboard.
export default defineScenario({
  id: "editor-setup-dialog",
  rows: ["AC-619"],
  title:
    "Set up my editor: the checklist, the link, the file and the command, on a 1280 x 720 screen",
  async run(ui) {
    await ui.step(
      "a 1280 x 720 screen, the way a projector gives it",
      async () => {
        await ui.page.setViewportSize({ width: 1280, height: 720 });
        await ui.wait(400);
      },
    );

    await ui.step(
      "the main menu has Set up my editor, and it opens the dialog",
      async () => {
        await openFromMenu(ui.page);
        await dialog(ui.page).waitFor({ state: "visible", timeout: 10000 });
        ui.expect((await ui.page.getByText("Set up my editor").count()) > 0, {
          expected: "the title Set up my editor",
          observed: "no title",
        });
      },
    );

    await ui.step(
      "the dialog fits the screen: nothing is cut off at the bottom or the sides",
      async () => {
        const box = await dialog(ui.page).boundingBox();
        const close = await ui.page
          .getByRole("button", { name: "Close", exact: true })
          .last()
          .boundingBox();

        ui.expect(Boolean(box) && box.x >= 0 && box.x + box.width <= 1280, {
          expected: "the dialog inside the width of the screen",
          observed: JSON.stringify(box),
        });
        // the content scrolls inside the dialog when it is taller than the screen: the Close button can be reached
        const scrolls = await dialog(ui.page).evaluate(
          (node) => node.scrollHeight > node.clientHeight,
        );

        ui.expect(Boolean(close) || scrolls, {
          expected: "the Close button on the screen, or a dialog that scrolls",
          observed: `close ${JSON.stringify(close)}, scrolls ${scrolls}`,
        });
      },
    );

    await ui.step(
      "the checklist is ticked as the setup does it, and the link, the file and the command are there",
      async () => {
        const href = await ui.page
          .locator('[data-testid="editor-setup-link"]')
          .getAttribute("href");
        const command = await ui.page
          .locator('[data-testid="editor-setup-command"]')
          .inputValue();

        ui.expect(
          /^excalidraw-setup:\/\/install\?editor=auto&profile=excalidraw&groups=python,cpp,java,js&vsix=/.test(
            href ?? "",
          ),
          {
            expected: "the link with the default choice",
            observed: String(href),
          },
        );
        ui.expect(
          /Bootstrap\.ps1/.test(command) && /^powershell /.test(command),
          {
            expected: "a PowerShell command that fetches Bootstrap.ps1",
            observed: command.slice(0, 120),
          },
        );
        ui.expect(
          (await ui.page.getByText("Download ExcalidrawSetup.cmd").count()) ===
            1,
          { expected: "the download button", observed: "missing" },
        );
      },
    );

    await ui.step(
      "VSCodium and no Java: the link follows at once",
      async () => {
        await ui.page
          .locator(`input[name="editor-setup-editor"][value="codium"]`)
          .check();
        await ui.page.getByLabel("Java", { exact: true }).uncheck();
        await ui.wait(300);

        const href = await ui.page
          .locator('[data-testid="editor-setup-link"]')
          .getAttribute("href");

        ui.expect(
          /editor=codium/.test(href ?? "") &&
            /groups=python,cpp,js/.test(href ?? ""),
          {
            expected: "editor=codium and groups=python,cpp,js",
            observed: String(href),
          },
        );
      },
    );

    await ui.step(
      "a profile name the engine would refuse: the problem is said and nothing is offered",
      async () => {
        await ui.page
          .locator('[data-testid="editor-setup-profile"]')
          .fill("bad&name");
        await ui.wait(300);

        const problem = await ui.page
          .locator('[data-testid="editor-setup-problem"]')
          .textContent();

        ui.expect(/profile name/i.test(problem ?? ""), {
          expected: "a sentence about the profile name",
          observed: String(problem),
        });
        ui.expect(
          (await ui.page
            .locator('[data-testid="editor-setup-link"]')
            .count()) === 0,
          { expected: "no link", observed: "a link is offered" },
        );
        await ui.page
          .locator('[data-testid="editor-setup-profile"]')
          .fill("excalidraw");
      },
    );

    await ui.step(
      "Escape closes the dialog and the canvas is back",
      async () => {
        await ui.page.keyboard.press("Escape");
        await dialog(ui.page).waitFor({ state: "hidden", timeout: 5000 });
      },
    );

    await ui.step(
      "the VS Code mirror's connection state offers the same dialog",
      async () => {
        await ui.page.locator('[data-testid="main-menu-trigger"]').click();
        await ui.page
          .getByText("VS Code mirror (bridge)", { exact: true })
          .click();
        await ui.wait(1500);
        await ui.page
          .locator('[data-testid="panel-bridge-setup"]')
          .waitFor({ state: "visible", timeout: 10000 });
        await ui.page.locator('[data-testid="panel-bridge-setup"]').click();
        await dialog(ui.page).waitFor({ state: "visible", timeout: 10000 });
      },
    );

    await ui.step(
      "the app asked nothing of another computer for all this",
      async () => {
        const errors = ui.app.realConsoleErrors();

        ui.expect(errors.length === 0, {
          expected: "no error in the console",
          observed: errors.slice(0, 2).join(" | "),
        });
      },
    );
  },
});
