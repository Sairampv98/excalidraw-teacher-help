// The report of a run, and the repro card of a discrepancy: what the owner reads, and how the owner replays it.

const STATUS_WORD = {
  pass: "verified",
  discrepancy: "DISCREPANCY",
  error: "COULD NOT RUN",
};

/** the one command that opens the real browser on the failing scenario, slowed down */
export const replayCommand = (scenarioId) =>
  `node scripts/ui/replay.mjs ${scenarioId}`;

const quoteRow = (row) =>
  row
    ? `> **${row.id}** (${row.name}): ${row.text}`
    : "> (this row is not in the requirements file)";

/**
 * The card for one scenario that did not pass. It is written to be read by a
 * person who has not seen the run: the sentence of the requirement, what was done, what
 * should have happened, what happened, a picture, and how to see it again.
 */
export const reproCard = (result, rows) => {
  const lines = [
    `# ${result.title}`,
    "",
    `Scenario \`${result.id}\` - ${STATUS_WORD[result.status]}`,
    "",
  ];

  lines.push("## What the requirement says", "");
  if (result.rows.length) {
    for (const id of result.rows) {
      lines.push(quoteRow(rows.get(id)), "");
    }
  } else {
    lines.push("> (this scenario guards the app itself, not one row)", "");
  }

  lines.push("## What was done", "");
  for (const step of result.steps) {
    lines.push(
      `${step.n}. ${step.text}${step.ok ? "" : "  **<- it stopped here**"}`,
    );
  }

  lines.push("", "## What should have happened, and what did", "");
  if (result.failure?.expected) {
    lines.push(
      `- **Expected:** ${result.failure.expected}`,
      `- **Saw:** ${result.failure.observed}`,
    );
    if (result.failure.hint) {
      lines.push(`- **Note:** ${result.failure.hint}`);
    }
  } else {
    lines.push(
      `- **The run could not go on:** ${result.failure?.message ?? "unknown"}`,
    );
  }

  const last = [...result.steps].reverse().find((step) => step.shot);

  if (last) {
    lines.push("", `Picture of the last step: \`${last.shot}\``);
  }

  lines.push(
    "",
    "## See it yourself",
    "",
    "```",
    replayCommand(result.id),
    "```",
    "",
    "It opens the real browser, slowly, and leaves the window open for a minute.",
    "",
    "## Your answer",
    "",
    "Reply with one of: **OK** (this is right) - **bug** (the app is wrong) - **spec wrong** (change the row to ...) - **other** (say what you think).",
    "",
  );

  return lines.join("\n");
};

/** the report of a whole run, one line for each scenario */
export const renderReport = (results, { when, appHead } = {}) => {
  const count = (status) => results.filter((r) => r.status === status).length;
  const lines = [
    "# UI gate report",
    "",
    `Run: ${when ?? "now"}${appHead ? `   App built from: ${appHead}` : ""}`,
    "",
    `**${results.length} scenarios:** ${count("pass")} verified, ${count(
      "discrepancy",
    )} discrepancies, ${count("error")} could not run.`,
    "",
    "| Scenario | Rows | Result | Steps | Time |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.rows.join(", ") || "-"} | ${STATUS_WORD[r.status]} | ${
        r.steps.length
      } | ${(r.ms / 1000).toFixed(1)} s |`,
    );
  }

  const bad = results.filter((r) => r.status !== "pass");

  if (bad.length) {
    lines.push("", "## What needs your answer", "");
    for (const r of bad) {
      lines.push(
        `- **${r.id}**: ${
          r.failure?.expected
            ? `expected ${r.failure.expected}, saw ${r.failure.observed}`
            : r.failure?.message
        }  (card: \`cards/${r.id}.md\`)`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};
