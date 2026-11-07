import os from "node:os";
import path from "node:path";

import { ensureAssets } from "../../clips/lib/assets.mjs";
import { defineScenario } from "../lib/scenario.mjs";

// D-279: the PDFs are drawn by the app. In a classroom with no internet that has to hold too:
// the gate refuses every request that leaves this computer, so a PDF that opens here opens there.
export default defineScenario({
  id: "pdf-opens-offline",
  rows: ["AC-557"],
  title: "a PDF opens in the side panel with no internet",
  async run(ui) {
    const assets = ensureAssets(path.join(os.tmpdir(), "ui-gate-assets"));

    await ui.step("open the demo PDF from the Files tab", async () => {
      const [chooser] = await Promise.all([
        ui.page.waitForEvent("filechooser"),
        ui.page.locator('[data-testid="files-open-files"]').click(),
      ]);

      await chooser.setFiles([assets.pdf]);
      await ui.wait(1000);
      await ui.page
        .locator('button.app-file-list__row[title="demo.pdf"]')
        .click();
      await ui.wait(3500);
    });

    await ui.step("the PDF is shown, with no error", async () => {
      const text = await ui.page
        .locator(".app-sidebar-panel, [role=tabpanel]")
        .first()
        .innerText();

      ui.expect(!/could not be opened|failed|error/i.test(text), {
        expected: "the PDF opens",
        observed: text.replace(/\s+/g, " ").slice(0, 200),
        hint: "the PDF engine is fetched from a CDN when the first PDF is opened, so it is missing with no internet",
      });
    });
  },
});
