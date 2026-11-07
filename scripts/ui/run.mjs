#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool: it speaks on the console */
// The UI gate: the built app, driven in a real browser, scenario by scenario.
//
//   node scripts/ui/run.mjs                        every scenario
//   node scripts/ui/run.mjs --rows AC-538,AC-543   the scenarios that speak for these rows
//   node scripts/ui/run.mjs --only fly-switch      one scenario, by its id
//   node scripts/ui/run.mjs --list                 what there is
//   options: --headed (show the browser)  --slow <ms>  --hold <s> (keep the window open at the end)
//            --app <folder> (the built app; default node_modules/.cache/ui-gate/build, made by `node scripts/ui/build.mjs`)
//            --out <folder> (default node_modules/.cache/ui-gate/out/<time>)
//
// It writes report.md, report.json, a card for each scenario that did not pass, and a picture for each step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchApp } from "./lib/app.mjs";
import { renderReport, reproCard } from "./lib/report.mjs";
import { runScenario } from "./lib/scenario.mjs";
import { parseSpecRows, rowsById } from "./lib/specRows.mjs";
import { serveFolder } from "./lib/staticServer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const parseArgs = (argv) => {
  const args = {
    headed: false,
    slow: 0,
    hold: 0,
    rows: [],
    only: [],
    list: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    if (flag === "--headed") {
      args.headed = true;
    } else if (flag === "--list") {
      args.list = true;
    } else if (flag === "--slow") {
      args.slow = Number(argv[++i]);
    } else if (flag === "--hold") {
      args.hold = Number(argv[++i]);
    } else if (flag === "--rows") {
      args.rows = argv[++i].split(",").map((s) => s.trim());
    } else if (flag === "--only") {
      args.only = argv[++i].split(",").map((s) => s.trim());
    } else if (flag === "--app") {
      args.app = path.resolve(argv[++i]);
    } else if (flag === "--out") {
      args.out = path.resolve(argv[++i]);
    } else {
      throw new Error(`unknown option ${flag}`);
    }
  }

  return args;
};

export const loadScenarios = async () => {
  const dir = path.join(HERE, "scenarios");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  const scenarios = [];

  for (const file of files) {
    scenarios.push(
      (await import(pathToFileURL(path.join(dir, file)).href)).default,
    );
  }

  return scenarios;
};

const safe = (text) => text.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);

export const main = async (argv) => {
  const args = parseArgs(argv);
  const all = await loadScenarios();
  const chosen = all.filter(
    (s) =>
      (!args.rows.length && !args.only.length) ||
      args.only.includes(s.id) ||
      s.rows.some((row) => args.rows.includes(row)) ||
      args.rows.includes(s.id),
  );

  if (args.list) {
    for (const s of all) {
      console.log(
        `${s.id.padEnd(24)} ${s.rows.join(", ").padEnd(18)} ${s.title}`,
      );
    }
    return 0;
  }

  if (!chosen.length) {
    console.error("no scenario matches that");
    return 2;
  }

  const appDir =
    args.app ?? path.join(ROOT, "node_modules", ".cache", "ui-gate", "build");

  if (!fs.existsSync(path.join(appDir, "index.html"))) {
    console.error(
      `the built app is not at ${appDir}: run  node scripts/ui/build.mjs  first`,
    );
    return 2;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out =
    args.out ??
    path.join(ROOT, "node_modules", ".cache", "ui-gate", "out", stamp);

  fs.mkdirSync(path.join(out, "cards"), { recursive: true });

  const rows = rowsById(
    parseSpecRows(
      fs.readFileSync(path.join(ROOT, ["SPEC", "md"].join(".")), "utf8"),
    ),
  );
  const server = await serveFolder(appDir);
  const results = [];

  for (const scenario of chosen) {
    const shotsDir = path.join(out, "shots", scenario.id);

    fs.mkdirSync(shotsDir, { recursive: true });

    const app = await launchApp({
      url: server.url,
      headed: args.headed,
      slowMo: args.slow,
    });
    const shoot = async (label) => {
      const file = path.join(shotsDir, `${safe(label)}.png`);

      await app.page.screenshot({ path: file });

      return path.relative(out, file).replace(/\\/g, "/");
    };

    console.log(`\n${scenario.id}  (${scenario.title})`);

    const result = await runScenario(
      scenario,
      (base) => ({
        ...base,
        app,
        page: app.page,
        context: app.context,
        faults: app.faults,
        baseUrl: server.url,
        wait: (ms) => app.page.waitForTimeout(ms),
      }),
      { shoot },
    );

    result.faults = {
      console: app.realConsoleErrors().length,
      outside: app.faults.outside.length,
    };
    results.push(result);

    for (const step of result.steps) {
      console.log(`  ${step.ok ? "ok  " : "FAIL"} ${step.n}. ${step.text}`);
    }
    console.log(
      `  => ${result.status}${
        result.failure?.expected
          ? `: expected ${result.failure.expected}, saw ${result.failure.observed}`
          : result.failure?.message
          ? `: ${result.failure.message}`
          : ""
      }`,
    );

    if (result.status !== "pass") {
      fs.writeFileSync(
        path.join(out, "cards", `${scenario.id}.md`),
        reproCard(result, rows),
      );
    }

    if (args.headed && args.hold > 0) {
      await app.page.waitForTimeout(args.hold * 1000);
    }

    await app.close();
  }

  await server.close();

  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(results, null, 2),
  );
  fs.writeFileSync(
    path.join(out, "report.md"),
    renderReport(results, { when: new Date().toLocaleString() }),
  );
  console.log(`\nreport: ${path.join(out, "report.md")}`);

  return results.every((r) => r.status === "pass") ? 0 : 1;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(2);
    },
  );
}
