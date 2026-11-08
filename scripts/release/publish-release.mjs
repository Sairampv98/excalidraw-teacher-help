#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Publishes a release of the public repository: a draft, the files, a proof that every file comes back the
 * same, and only then the release itself.
 *
 *   node scripts/release/publish-release.mjs --tag v2.1.1 --notes <file> --dir <folder> [options]
 *   node scripts/release/publish-release.mjs --tag v2.1.1 --notes <file> --dir <folder> --check
 *
 *   --tag <tag>           the release (and the tag) to make, for example v2.1.1
 *   --notes <file>        the text of the release
 *   --dir <folder>        the folder with the files and SHA256SUMS-<tag>.txt (the files it lists are the ones sent)
 *   --clone <folder>      the clone of the public repository (default: ../excalidraw-public beside this repository)
 *   --remote <name>       the remote of that clone that is the public repository (default: github-public)
 *   --expect-main <sha>   the public main this release was prepared on; stops when the remote is another
 *   --check               read-only: checks that everything is ready and changes nothing
 *
 * It needs git to be able to give it your GitHub login (the same one `git push` uses). The token is read from
 * git's own credential store, is never printed, and is never written.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

export const parseArgs = (argv) => {
  const args = {
    tag: null,
    notes: null,
    dir: null,
    clone: path.resolve(ROOT, "..", "excalidraw-public"),
    remote: "github-public",
    expectMain: null,
    check: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];

    if (flag === "--tag") {
      args.tag = argv[++i];
    } else if (flag === "--notes") {
      args.notes = path.resolve(argv[++i]);
    } else if (flag === "--dir") {
      args.dir = path.resolve(argv[++i]);
    } else if (flag === "--clone") {
      args.clone = path.resolve(argv[++i]);
    } else if (flag === "--remote") {
      args.remote = argv[++i];
    } else if (flag === "--expect-main") {
      args.expectMain = argv[++i];
    } else if (flag === "--check") {
      args.check = true;
    }
  }

  return args;
};

/** the problems with the arguments, as sentences (none means they will do) */
export const problemsWith = (args) => {
  const problems = [];

  if (!args.tag || !/^v\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(args.tag)) {
    problems.push("--tag must be a version such as v2.1.1");
  }

  if (!args.notes) {
    problems.push("--notes <file> is needed");
  }

  if (!args.dir) {
    problems.push("--dir <folder> is needed");
  }

  return problems;
};

/** `owner/name` of a GitHub address, https or ssh */
export const repoFromUrl = (url) => {
  const match = String(url)
    .trim()
    .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);

  return match ? `${match[1]}/${match[2]}` : null;
};

/** `{ file: hash }` from the text of a SHA256SUMS file (a hash, spaces, a name; `*` before a name is allowed) */
export const readSums = (text) =>
  Object.fromEntries(
    text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, ...rest] = line.trim().split(/\s+/);

        return [rest.join(" ").replace(/^\*/, ""), hash.toLowerCase()];
      }),
  );

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");

    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

const say = (text) => console.log(text);
const die = (text) => {
  console.error(`STOP: ${text}`);
  process.exit(1);
};

const gitToken = () => {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
  }).toString();
  const match = out.match(/^password=(.*)$/m);

  if (!match) {
    die("git has no GitHub login to give");
  }

  return match[1].trim();
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  const problems = problemsWith(args);

  if (problems.length) {
    die(problems.join("; "));
  }

  const remoteUrl = execFileSync("git", [
    "-C",
    args.clone,
    "remote",
    "get-url",
    args.remote,
  ])
    .toString()
    .trim();
  const repo = repoFromUrl(remoteUrl);

  if (!repo) {
    die(`${args.remote} is not a GitHub address: ${remoteUrl}`);
  }

  const token = gitToken();
  const headers = {
    "User-Agent": "release-script",
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
  };

  const api = (method, route, body) =>
    new Promise((resolve, reject) => {
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const request = https.request(
        {
          hostname: "api.github.com",
          path: route,
          method,
          headers: {
            ...headers,
            ...(data
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": data.length,
                }
              : {}),
          },
        },
        (response) => {
          let buffer = "";

          response.on("data", (chunk) => (buffer += chunk));
          response.on("end", () => {
            if (response.statusCode >= 300) {
              return reject(
                new Error(
                  `${method} ${route}: ${response.statusCode} ${buffer.slice(
                    0,
                    200,
                  )}`,
                ),
              );
            }
            resolve(buffer ? JSON.parse(buffer) : {});
          });
        },
      );

      request.on("error", reject);
      if (data) {
        request.write(data);
      }
      request.end();
    });

  const upload = (uploadUrl, name, file) =>
    new Promise((resolve, reject) => {
      const target = new URL(
        `${uploadUrl.replace("{?name,label}", "")}?name=${encodeURIComponent(
          name,
        )}`,
      );
      const size = fs.statSync(file).size;
      const request = https.request(
        {
          hostname: target.hostname,
          path: target.pathname + target.search,
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
            "Content-Length": size,
          },
        },
        (response) => {
          let buffer = "";

          response.on("data", (chunk) => (buffer += chunk));
          response.on("end", () =>
            response.statusCode >= 300
              ? reject(
                  new Error(
                    `upload ${name}: ${response.statusCode} ${buffer.slice(
                      0,
                      200,
                    )}`,
                  ),
                )
              : resolve(JSON.parse(buffer)),
          );
        },
      );

      request.on("error", reject);

      let sent = 0;
      let last = 0;

      fs.createReadStream(file)
        .on("data", (chunk) => {
          sent += chunk.length;
          if (sent - last > 50e6) {
            last = sent;
            say(`  ${name}: ${Math.round((sent / size) * 100)}%`);
          }
        })
        .pipe(request);
    });

  const download = (url) =>
    new Promise((resolve, reject) => {
      const get = (address, first) => {
        const target = new URL(address);

        https
          .get(
            {
              hostname: target.hostname,
              path: target.pathname + target.search,
              headers: {
                "User-Agent": "release-script",
                Accept: "application/octet-stream",
                ...(first ? { Authorization: `Bearer ${token}` } : {}),
              },
            },
            (response) => {
              if (response.statusCode >= 300 && response.statusCode < 400) {
                response.resume();

                return get(response.headers.location, false);
              }
              if (response.statusCode !== 200) {
                return reject(
                  new Error(`download ${address}: ${response.statusCode}`),
                );
              }

              const hash = createHash("sha256");
              let size = 0;

              response.on("data", (chunk) => {
                hash.update(chunk);
                size += chunk.length;
              });
              response.on("end", () =>
                resolve({ sha: hash.digest("hex"), size }),
              );
            },
          )
          .on("error", reject);
      };

      get(url, true);
    });

  // 1. the public main is the one the release was prepared on
  const remote = execFileSync("git", [
    "-C",
    args.clone,
    "ls-remote",
    args.remote,
    "refs/heads/main",
  ])
    .toString()
    .split(/\s+/)[0];

  say(`remote main: ${remote.slice(0, 7)}`);

  if (args.expectMain && !remote.startsWith(args.expectMain)) {
    die(
      `the public main is ${remote.slice(0, 7)}, not ${
        args.expectMain
      }: push main and dev first`,
    );
  }

  // 2. the files are the ones that were built (the sums file lists them)
  const sumsName = `SHA256SUMS-${args.tag}.txt`;
  const sumsPath = path.join(args.dir, sumsName);

  if (!fs.existsSync(sumsPath)) {
    die(`missing ${sumsName} in ${args.dir}`);
  }

  const sums = readSums(fs.readFileSync(sumsPath, "utf8"));
  const names = [...Object.keys(sums), sumsName];
  const local = {};

  for (const name of names) {
    const file = path.join(args.dir, name);

    if (!fs.existsSync(file)) {
      die(`missing ${name}`);
    }

    local[name] = await sha256File(file);

    if (name !== sumsName && sums[name] !== local[name]) {
      die(`${name} changed since it was built`);
    }

    say(
      `ok  ${name}  ${(fs.statSync(file).size / 1048576).toFixed(
        1,
      )} MB  ${local[name].slice(0, 12)}`,
    );
  }

  // 3. nothing of this tag exists yet
  let existing = null;

  try {
    existing = await api("GET", `/repos/${repo}/releases/tags/${args.tag}`);
  } catch {
    // not found is what is wanted
  }

  if (existing) {
    die(`a release ${args.tag} already exists (${existing.html_url})`);
  }

  say(`no release ${args.tag} yet: good`);

  if (args.check) {
    say("\n--check: everything is ready; nothing was changed.");

    return 0;
  }

  // 4. a draft, the files, the proof, then publish
  const sha = execFileSync("git", [
    "-C",
    args.clone,
    "rev-parse",
    `${args.remote}/main`,
  ])
    .toString()
    .trim();
  const draft = await api("POST", `/repos/${repo}/releases`, {
    tag_name: args.tag,
    target_commitish: sha,
    name: args.tag.replace(/^v/, ""),
    body: fs.readFileSync(args.notes, "utf8"),
    draft: true,
    prerelease: false,
  });

  say(
    `draft created: id ${draft.id} (invisible to the public until it is published)`,
  );

  const uploaded = {};

  for (const name of names) {
    say(`uploading ${name} ...`);
    uploaded[name] = await upload(
      draft.upload_url,
      name,
      path.join(args.dir, name),
    );
  }

  say("downloading every file back to compare:");

  let bad = 0;

  for (const name of names) {
    const got = await download(uploaded[name].url);
    const same =
      got.sha === local[name] &&
      got.size === fs.statSync(path.join(args.dir, name)).size;

    say(`  ${same ? "same" : "DIFFERENT"}  ${name}`);
    if (!same) {
      bad += 1;
    }
  }

  if (bad) {
    die(
      `${bad} file(s) came back different: the draft ${draft.html_url} was NOT published`,
    );
  }

  const done = await api("PATCH", `/repos/${repo}/releases/${draft.id}`, {
    draft: false,
  });

  say(`\nPUBLISHED: ${done.html_url}`);

  return 0;
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
