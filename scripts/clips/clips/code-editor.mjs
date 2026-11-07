// A code editor of its own on the board: write a program, run it, see what it prints.
export default {
  id: "code-editor",
  group: "Teaching with code",
  title: "Write and run code on the board",
  line: "A code editor in the browser: write a short program, press run, and its output appears below.",
  posterAt: 16,
  async run(c) {
    const { page } = c;

    await c.say("The menu has a code editor that works right in the browser");
    await c.click(page.locator('[data-testid="main-menu-trigger"]'));
    await c.click(
      page.getByText("Code editor (in the browser)", { exact: true }),
    );
    await c.wait(2000);

    await c.say("Pick the language: JavaScript and Python run here");
    await page.locator("select").first().selectOption("javascript");
    await c.wait(800);

    await c.say("Click into the editor and write a program");
    await c.click({ x: 640, y: 250 });
    await page.keyboard.press("Control+A");
    await page.keyboard.type(
      "function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }",
      {
        delay: 45,
      },
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("console.log(fact(5));", { delay: 45 });
    await c.wait(800);

    await c.say("Press the green button to run it");
    await c.click(page.locator('[data-testid="code-panel-run"]'));
    await c.wait(1500);
    await c.say("The output appears right below, on the board", { hold: 3500 });
  },
};
