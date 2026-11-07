// A terminal window for a clip that shows what happens on the assistant's side: lines of text, one at a time.

/** the page the terminal is drawn on (plain HTML, nothing is loaded from anywhere) */
export const terminalHtml = (title) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  html, body { margin: 0; height: 100%; background: #14161c; color: #d7dae0; }
  body { font: 15px/1.5 Consolas, "Cascadia Mono", monospace; display: flex; flex-direction: column; }
  header { padding: 10px 16px; background: #1e2129; color: #9aa0ad; font: 600 14px system-ui, sans-serif; border-bottom: 1px solid #2a2e38; }
  #log { padding: 16px; white-space: pre-wrap; word-break: break-word; overflow: hidden; flex: 1; }
  .cmd { color: #ffffff; }
  .cmd::before { content: "$ "; color: #6965db; }
  .out { color: #9aa0ad; }
  .ok { color: #7bd88f; }
  .tool { color: #f0c674; }
  .cursor::after { content: "_"; color: #6965db; animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
</style></head>
<body><header>${title}</header><div id="log"></div></body></html>`;

/** what a clip can do with a terminal window: print a line, or type a command the way a person does */
export const terminalActions = (page) => ({
  print: async (text, kind = "out") => {
    await page.evaluate(
      ([line, cls]) => {
        const row = document.createElement("div");

        row.className = cls;
        row.textContent = line;
        document.getElementById("log").appendChild(row);
      },
      [text, kind],
    );
    await page.waitForTimeout(450);
  },
  typeCommand: async (text) => {
    await page.evaluate(() => {
      const row = document.createElement("div");

      row.className = "cmd cursor";
      row.id = "typing";
      document.getElementById("log").appendChild(row);
    });

    for (const char of text) {
      await page.evaluate((c) => {
        document.getElementById("typing").textContent += c;
      }, char);
      await page.waitForTimeout(32);
    }

    await page.evaluate(() => {
      const row = document.getElementById("typing");

      row.classList.remove("cursor");
      row.removeAttribute("id");
    });
    await page.waitForTimeout(500);
  },
});
