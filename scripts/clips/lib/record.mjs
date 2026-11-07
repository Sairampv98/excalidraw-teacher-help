// Films one clip: the real app, in the browser of this computer, doing what a teacher does.
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";

import { findBrowser } from "../../ui/lib/app.mjs";
import { isLocalUrl } from "../../ui/lib/guard.mjs";
import { serveFolder } from "../../ui/lib/staticServer.mjs";

import {
  findFfmpeg,
  framesToFilmArgs,
  gifArgs,
  posterArgs,
  runFfmpeg,
  webmArgs,
} from "./ffmpeg.mjs";
import { ensureAssets } from "./assets.mjs";
import { overlayScript } from "./overlay.mjs";
import {
  CLIP_SIZE,
  checkClip,
  concatList,
  glidePoints,
  manifestEntry,
  readingTime,
} from "./plan.mjs";

/** what a clip's script is given: the page, and the few things a teacher does with it */
const makeHelper = (page, assets) => {
  let at = { x: 640, y: 360 };

  const helper = {
    page,
    assets,
    /** a button that opens the file chooser is pressed, and the chooser is given files */
    choose: async (button, files) => {
      await helper.glide(button);
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        helper.click(button),
      ]);

      await chooser.setFiles(files);
      await page.waitForTimeout(1500);
    },
    wait: (ms) => page.waitForTimeout(ms),
    /** a caption at the bottom, held long enough to read */
    say: async (text, { hold, at } = {}) => {
      await page.evaluate(
        ([words, where]) => window.__clipCaption?.(words, where),
        [text, at],
      );
      await page.waitForTimeout(hold ?? readingTime(text));
    },
    hush: () => page.evaluate(() => window.__clipCaption?.("")),
    /** the pointer travels to a place the way a hand does */
    glide: async (target) => {
      const to =
        "x" in target
          ? target
          : await (async () => {
              const box = await target.boundingBox();

              if (!box) {
                throw new Error("the control to point at is not on the screen");
              }

              return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            })();

      for (const point of glidePoints(at, to)) {
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(14);
      }
      at = to;
    },
    click: async (target) => {
      await helper.glide(target);
      await page.waitForTimeout(220);
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      await page.waitForTimeout(350);
    },
    /** draws a shape: press, travel, release */
    drag: async (from, to) => {
      await helper.glide(from);
      await page.mouse.down();
      await helper.glide(to);
      await page.mouse.up();
      await page.waitForTimeout(300);
    },
  };

  return helper;
};

export const recordClip = async (
  clip,
  { appDir, outDir, rawDir, withGif = false },
) => {
  const problems = checkClip(clip);

  if (problems.length) {
    throw new Error(problems.join("; "));
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const server = await serveFolder(appDir, { port: 0 });
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
  });
  const startedAt = Date.now();
  let seconds = 0;
  let rawFile;

  try {
    const context = await browser.newContext({
      viewport: CLIP_SIZE,
      serviceWorkers: "block",
    });

    // nothing leaves this computer while a clip is made
    await context.route("**/*", (route) =>
      isLocalUrl(route.request().url()) ? route.continue() : route.abort(),
    );
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("excalidraw-classroom-tour-seen", "yes");
      } catch {
        // storage blocked: the tour is not wanted in a clip, and cannot be told so
      }
    });
    await context.addInitScript(overlayScript);

    const page = await context.newPage();

    await page.goto(server.url, { waitUntil: "load" });
    await page.locator("canvas").first().waitFor({ state: "attached" });
    await page.mouse.move(640, 400);
    await page.waitForTimeout(1200);

    // the film is the frames Chrome sends of the page, gathered as they come
    const cdp = await context.newCDPSession(page);
    const frames = [];
    const frameDir = path.join(rawDir, clip.id);

    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.mkdirSync(frameDir, { recursive: true });
    cdp.on("Page.screencastFrame", (frame) => {
      const file = path.join(
        frameDir,
        `${String(frames.length).padStart(5, "0")}.jpg`,
      );

      fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
      frames.push({
        file: file.replaceAll("\\", "/"),
        at: frame.metadata.timestamp,
      });
      cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: CLIP_SIZE.width,
      maxHeight: CLIP_SIZE.height,
      everyNthFrame: 1,
    });

    const helper = makeHelper(page, ensureAssets(path.join(rawDir, "assets")));

    try {
      await clip.run(helper);
    } catch (error) {
      // a picture of the moment it went wrong, to look at
      const shot = path.join(rawDir, `${clip.id}-FAILED.png`);

      await page.screenshot({ path: shot }).catch(() => {});
      error.message += ` (a picture: ${shot})`;
      throw error;
    }
    await helper.hush();
    await page.waitForTimeout(600);
    seconds = (Date.now() - startedAt) / 1000;

    await cdp.send("Page.stopScreencast");
    await context.close();

    const listFile = path.join(frameDir, "frames.txt");

    fs.writeFileSync(listFile, concatList(frames));
    rawFile = path.join(rawDir, `${clip.id}.mp4`);
    runFfmpeg(findFfmpeg(), framesToFilmArgs(listFile, rawFile));
  } finally {
    await browser.close();
    await server.close();
  }

  const ffmpeg = findFfmpeg();
  const webm = path.join(outDir, `${clip.id}.webm`);
  const poster = path.join(outDir, `${clip.id}.jpg`);

  runFfmpeg(ffmpeg, webmArgs(rawFile, webm));
  runFfmpeg(ffmpeg, posterArgs(rawFile, poster, { at: clip.posterAt ?? 1.5 }));

  if (withGif) {
    runFfmpeg(ffmpeg, gifArgs(rawFile, path.join(outDir, `${clip.id}.gif`)));
  }

  return manifestEntry(clip, {
    seconds: Math.round(seconds * 10) / 10,
    bytes: fs.statSync(webm).size,
  });
};
