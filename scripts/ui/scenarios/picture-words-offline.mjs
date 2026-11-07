import os from "node:os";
import path from "node:path";

import { ensureAssets } from "../../clips/lib/assets.mjs";
import { defineScenario } from "../lib/scenario.mjs";

// D-460: the words in a picture are read by an engine the app carries, so it works with no internet:
// the gate refuses every request that leaves this computer.
export default defineScenario({
  id: "picture-words-offline",
  rows: ["AC-557"],
  title: "the words in a picture are read with no internet",
  async run(ui) {
    const assets = ensureAssets(path.join(os.tmpdir(), "ui-gate-assets"));

    await ui.step("put a picture of printed words on the board", async () => {
      const [chooser] = await Promise.all([
        ui.page.waitForEvent("filechooser"),
        ui.page.locator('[data-testid="files-open-files"]').click(),
      ]);

      await chooser.setFiles([assets.words]);
      await ui.wait(1000);
      await ui.page
        .locator('button.app-file-list__row[title="words.png"]')
        .click();
      await ui.page.locator(".app-sidebar-primary").click();
      await ui.wait(1800);
    });

    await ui.step("open the crop window and press Read the text", async () => {
      await ui.page.mouse.dblclick(775, 445);
      await ui.page
        .getByRole("button", { name: "Read the text", exact: true })
        .click({ timeout: 8000 });
    });

    await ui.step("the words come back", async () => {
      await ui.wait(25000);

      const text = await ui.page.evaluate(() => {
        const box = document.querySelector('[data-testid="ocr-preview-text"]');

        return box
          ? box.value ?? box.textContent ?? ""
          : document.body.innerText;
      });

      ui.expect(/queue/i.test(text), {
        expected:
          "the text read from the picture is shown (it holds the word queue)",
        observed: (text
          .replace(/\s+/g, " ")
          .match(/The text that was read.{0,300}/) ?? [text.slice(0, 200)])[0],
        hint: "the reader (tesseract.js), its core and the English language are carried by the app",
      });
    });
  },
});
