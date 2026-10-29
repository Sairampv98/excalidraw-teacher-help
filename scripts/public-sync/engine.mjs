/**
 * The engine of the public mirror.
 *
 * It keeps a branch of the public repo's clone (`dev`) in step with the private
 * repo's `main`: one public commit for each first-parent commit of `main` that
 * changes something the public repo may hold, written with git's plumbing
 * (`git fast-import`), so no working tree is touched. The files go through the
 * scrub, the commit through the message rewrite, and nothing is written unless
 * the leak guard and the closure check pass for the whole batch.
 *
 * Its state - the last private commit that was mirrored - is in the private
 * repo's own git directory, `public-sync/state.json`, and never in a public file.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { checkClosure, describeMissing } from "./closure.mjs";
import {
  describeFinding,
  isDenied,
  isUntouched,
  scanMessages,
  scanTree,
} from "./guard.mjs";
import { deriveMessage, taskIdOf } from "./message.mjs";
import { scrubFile } from "./scrub.mjs";

/* ------------------------------------------------------------------ git */

const run = (cwd, args, options = {}) => {
  try {
    return execFileSync("git", args, {
      cwd,
      maxBuffer: 1 << 30,
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    // say what git said: "command failed" alone is no help to whoever reads it
    throw new Error(
      `git ${args[0]} failed: ${
        error.stderr?.toString("utf8").trim() ?? error.message
      }`,
    );
  }
};

const text = (cwd, args, options) => run(cwd, args, options).toString("utf8");

const tryText = (cwd, args) => {
  try {
    return text(cwd, args).trim();
  } catch {
    return null;
  }
};

/** the private repo's git directory that is shared by its worktrees */
export const commonDir = (repo) =>
  // git answers with a relative path in the main worktree and an absolute one
  // in the others; resolve handles both
  resolve(repo, text(repo, ["rev-parse", "--git-common-dir"]).trim());

/* ---------------------------------------------------------------- state */

export const readState = (repo) => {
  const file = join(commonDir(repo), "public-sync", "state.json");

  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
};

export const writeState = (repo, state) => {
  const directory = join(commonDir(repo), "public-sync");

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
};

/* -------------------------------------------------------------- commits */

/** the first-parent commits after `from`, up to `to`, the oldest first */
export const firstParentCommits = (repo, from, to) =>
  text(repo, ["rev-list", "--first-parent", "--reverse", `${from}..${to}`])
    .split("\n")
    .filter(Boolean);

export const commitInfo = (repo, commit) => {
  const [name, email, at, when, ...body] = text(repo, [
    "show",
    "-s",
    "--format=%an%x1f%ae%x1f%at%x1f%ai%x1f%B",
    commit,
  ]).split("\x1f");
  const tz = /([+-]\d{4})$/.exec(when.trim())?.[1] ?? "+0000";

  return { name, email, at, tz, message: body.join("\x1f").trim() };
};

/** what a commit changed against its first parent: `{ status, mode, sha, path }` */
export const changesOf = (repo, commit, { full = false } = {}) => {
  // `full` is the whole tree, as the root of the public branch needs it
  const hasParent =
    !full && tryText(repo, ["rev-parse", "--verify", "-q", `${commit}^1`]);
  const raw = hasParent
    ? run(repo, [
        "diff-tree",
        "-r",
        "-z",
        "--raw",
        "--no-renames",
        `${commit}^1`,
        commit,
      ])
    : run(repo, ["ls-tree", "-r", "-z", commit]);
  const parts = raw.toString("utf8").split("\0").filter(Boolean);
  const changes = [];

  if (!hasParent) {
    // ls-tree: "<mode> blob <sha>\t<path>"
    for (const entry of parts) {
      const [meta, path] = entry.split("\t");
      const [mode, , sha] = meta.split(" ");

      changes.push({ status: "A", mode, sha, path });
    }

    return changes;
  }

  // diff-tree -z: ":<m1> <m2> <sha1> <sha2> <status>" then the path, as two parts
  for (let i = 0; i < parts.length; i += 2) {
    const [, newMode, , newSha, status] = parts[i].slice(1).split(" ");

    changes.push({
      status: status[0],
      mode: newMode,
      sha: newSha,
      path: parts[i + 1],
    });
  }

  return changes;
};

const blob = (repo, commit, path) =>
  run(repo, ["cat-file", "blob", `${commit}:${path}`]);

/* ------------------------------------------------------------ the scrub */

const isPublicOwned = (path, publicOwned) =>
  publicOwned.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );

const looksBinary = (buffer) => buffer.includes(0);

/**
 * One changed file as the public repo is to hold it: an operation for the
 * stream, or null when the file stays out. `unmapped` collects the sentences of
 * the method that the map does not hold.
 */
export const publicOperation = (
  repo,
  commit,
  change,
  config,
  { map = null, allowDrop = false, unmapped = [] } = {},
) => {
  const { path, status } = change;

  // the files the public repo owns, and the denied ones, are never touched
  if (isDenied(path, config.deny) || isPublicOwned(path, config.publicOwned)) {
    return null;
  }

  if (status === "D") {
    return { type: "delete", path };
  }

  const content = blob(repo, commit, path);

  if (change.mode === "160000") {
    return null;
  }

  if (isUntouched(path, config.untouched) || looksBinary(content)) {
    return { type: "file", path, mode: change.mode, content };
  }

  const scrubbed = scrubFile(path, content.toString("utf8"), {
    map,
    allowDrop,
  });

  unmapped.push(...scrubbed.unmapped.map((sentence) => ({ path, sentence })));

  return {
    type: "file",
    path,
    mode: change.mode,
    content: Buffer.from(scrubbed.text, "utf8"),
  };
};

/* ---------------------------------------------------------- the stream */

const quote = (path) =>
  /["\\\n]/.test(path) || path.startsWith('"')
    ? `"${path
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")}"`
    : path;

/** a `git fast-import` stream of commits: `{ info, message, operations }` each, on `ref` */
export const buildStream = (ref, commits, tip = null) => {
  const out = [];
  let mark = 0;

  for (const commit of commits) {
    const who = `${commit.info.name} <${commit.info.email}> ${commit.info.at} ${commit.info.tz}`;
    const message = Buffer.from(commit.message, "utf8");

    out.push(
      Buffer.from(
        `commit ${ref}\nmark :${++mark}\nauthor ${who}\ncommitter ${who}\ndata ${
          message.length
        }\n`,
      ),
      message,
      Buffer.from("\n"),
    );

    // the first commit continues the branch's tip; a new branch has none
    if (mark === 1 && tip) {
      out.push(Buffer.from(`from ${tip}\n`));
    }

    for (const operation of commit.operations) {
      if (operation.type === "delete") {
        out.push(Buffer.from(`D ${quote(operation.path)}\n`));
      } else {
        out.push(
          Buffer.from(
            `M ${operation.mode} inline ${quote(operation.path)}\ndata ${
              operation.content.length
            }\n`,
          ),
          operation.content,
          Buffer.from("\n"),
        );
      }
    }

    out.push(Buffer.from("\n"));
  }

  return Buffer.concat(out);
};

/* ------------------------------------------------------------- the tree */

/** the paths of a ref's tree, with the text of the files that the closure check reads */
export const readTree = (clone, ref) => {
  const listing = text(clone, ["ls-tree", "-r", "-z", ref])
    .split("\0")
    .filter(Boolean);
  const files = new Map();

  for (const entry of listing) {
    const [meta, path] = entry.split("\t");
    const [, , sha] = meta.split(" ");

    const wanted =
      /\.(?:[cm]?[jt]sx?|s?css)$/.test(path) || path.endsWith("package.json");

    files.set(
      path,
      wanted ? run(clone, ["cat-file", "blob", sha]).toString("utf8") : "",
    );
  }

  return files;
};

/** the files of a batch laid over the tree that is there, for the checks */
const afterBatch = (tree, commits) => {
  const files = new Map(tree);

  for (const commit of commits) {
    for (const operation of commit.operations) {
      if (operation.type === "delete") {
        files.delete(operation.path);
      } else {
        files.set(
          operation.path,
          looksBinary(operation.content)
            ? operation.content
            : operation.content.toString("utf8"),
        );
      }
    }
  }

  return files;
};

/* ------------------------------------------------------------ the batch */

/**
 * Works out what the next commits of the public branch are, without writing
 * anything: the commits, what the checks found, and the sentences the map does
 * not hold.
 */
export const plan = (
  repo,
  config,
  { map = null, allowDrop = false, from } = {},
) => {
  const clone = config.publicClone;
  const ref = `refs/heads/${config.devBranch}`;
  const state = readState(repo);
  const tip = tryText(clone, ["rev-parse", "--verify", "-q", ref]);
  const last = state.lastMirrored ?? from ?? config.baseCommit;
  const unmapped = [];
  const commits = [];

  // the root: the base commit's whole tree, with the files the public repo owns
  if (!tip) {
    const info = commitInfo(repo, config.baseCommit);
    const operations = changesOf(repo, config.baseCommit, { full: true })
      .map((change) =>
        publicOperation(repo, config.baseCommit, change, config, {
          map,
          allowDrop,
          unmapped,
        }),
      )
      .filter(Boolean);

    for (const owned of ownedFiles(clone, config)) {
      operations.push(owned);
    }

    commits.push({
      private: config.baseCommit,
      info,
      message: "Import the project from its first public release\n",
      operations,
    });
  }

  const start = tip ? last : config.baseCommit;

  for (const commitId of firstParentCommits(repo, start, config.mainBranch)) {
    const info = commitInfo(repo, commitId);
    const changes = changesOf(repo, commitId);
    const operations = changes
      .map((change) =>
        publicOperation(repo, commitId, change, config, {
          map,
          allowDrop,
          unmapped,
        }),
      )
      .filter(Boolean);

    if (!operations.length) {
      continue;
    }

    const id = taskIdOf(info.message);
    const taskText = id
      ? tryText(repo, ["show", `${commitId}:tasks/${id}.md`])
      : null;
    const derived = deriveMessage(
      { message: info.message, taskText, paths: operations.map((o) => o.path) },
      { map, allowDrop },
    );

    unmapped.push(
      ...derived.unmapped.map((sentence) => ({
        path: `commit ${commitId.slice(0, 8)}`,
        sentence,
      })),
    );
    commits.push({
      private: commitId,
      info,
      message: derived.message,
      operations,
    });
  }

  const tree = tip ? readTree(clone, ref) : new Map();
  const files = afterBatch(tree, commits);

  const findings = [
    ...scanTree(
      new Map(
        commits.flatMap((commit) =>
          commit.operations
            .filter((operation) => operation.type === "file")
            .map((operation) => [
              operation.path,
              looksBinary(operation.content)
                ? operation.content
                : operation.content.toString("utf8"),
            ]),
        ),
      ),
      { deny: config.deny, untouched: config.untouched },
    ),
    ...scanMessages(
      commits.map((commit) => ({
        id: commit.private.slice(0, 8),
        message: commit.message,
      })),
    ),
  ];

  const allowed = (list = [], item) =>
    list.some((entry) =>
      Object.entries(entry).every(([key, value]) => item[key] === value),
    );

  return {
    tip,
    commits,
    // what is known and accepted (upstream's own public search key, a test that
    // looks for the method's words, references upstream never resolved)
    findings: findings.filter(
      (finding) => !allowed(config.allowFindings, finding),
    ),
    missing: checkClosure(files).filter(
      (entry) => !allowed(config.allowMissing, entry),
    ),
    unmapped,
    last: commits.length ? commits.at(-1).private : last,
    lastSeen: tryText(repo, ["rev-parse", config.mainBranch]) ?? last,
  };
};

/** the files the public repo owns, read from its main branch (or the release branch) */
const ownedFiles = (clone, config) => {
  const ref = ["main", "version-1"].find((name) =>
    tryText(clone, ["rev-parse", "--verify", "-q", `refs/heads/${name}`]),
  );

  if (!ref) {
    return [];
  }

  return text(clone, ["ls-tree", "-r", "-z", ref])
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [meta, path] = entry.split("\t");
      const [mode, , sha] = meta.split(" ");

      return { path, mode, sha };
    })
    .filter(({ path }) => isPublicOwned(path, config.publicOwned))
    .map(({ path, mode, sha }) => ({
      type: "file",
      path,
      mode,
      content: run(clone, ["cat-file", "blob", sha]),
    }));
};

/** what stops a batch from being written, as lines of a report; empty when nothing does */
export const problems = (result, { allowDrop = false } = {}) => [
  ...result.findings.map((finding) => `leak: ${describeFinding(finding)}`),
  ...result.missing.map((entry) => `missing: ${describeMissing(entry)}`),
  ...(allowDrop
    ? []
    : result.unmapped.map(
        ({ path, sentence }) => `unmapped: ${path}: ${sentence.slice(0, 120)}`,
      )),
];

/**
 * Writes the batch to the public branch, when nothing stops it, and moves the
 * state forward. Returns what was done.
 */
export const mirror = (repo, config, options = {}) => {
  const result = plan(repo, config, options);
  const stops = problems(result, options);

  if (stops.length) {
    return { done: false, stops, result };
  }

  if (!result.commits.length || options.dryRun) {
    if (!options.dryRun) {
      writeState(repo, { ...readState(repo), lastMirrored: result.lastSeen });
    }

    return { done: false, stops: [], result, written: 0 };
  }

  const ref = `refs/heads/${config.devBranch}`;
  const stream = buildStream(ref, result.commits, result.tip);

  run(config.publicClone, ["fast-import", "--quiet"], { input: stream });
  writeState(repo, {
    ...readState(repo),
    lastMirrored: result.lastSeen,
    mirroredAt: new Date().toISOString(),
  });

  return { done: true, stops: [], result, written: result.commits.length };
};
