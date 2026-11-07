// Reads the rows of the requirements file: what the gate checks the app against, and what a repro card quotes.

/**
 * The AC rows (`| AC-538 | name | tests | text |`) and the D rows
 * (`| D-446 | name | status | text |`) of that file's text.
 */
export const parseSpecRows = (specText) => {
  const rows = [];

  for (const line of specText.split("\n")) {
    const ac = line.match(/^\| (AC-\d+) \| (.*?) \| (.*?) \| (.*) \|\s*$/);

    if (ac) {
      rows.push({
        kind: "AC",
        id: ac[1],
        name: ac[2],
        tests: [...ac[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]),
        text: ac[4],
      });
      continue;
    }

    const d = line.match(/^\| (D-\d+) \| (.*?) \| (.*?) \| (.*) \|\s*$/);

    if (d) {
      rows.push({
        kind: "D",
        id: d[1],
        name: d[2],
        status: d[3],
        tests: [],
        text: d[4],
      });
    }
  }

  return rows;
};

export const rowsById = (rows) => new Map(rows.map((row) => [row.id, row]));

/** where the check of an AC row runs - what kind of thing it is, by the files of its test */
export const areaOf = (row) => {
  const files = row.tests.join(" ");

  if (!row.tests.length) {
    return "no test named";
  }

  if (/packages\/mcp-server|packages\/excalidraw\/tests\/mcp/.test(files)) {
    return "assistant tools (MCP)";
  }

  if (/packages\/vscode-bridge/.test(files)) {
    return "VS Code bridge and extension";
  }

  if (
    /installer\/|scripts\//.test(files) &&
    !/excalidraw-app|packages\/excalidraw/.test(files)
  ) {
    return "installer, mirror, scripts";
  }

  if (/\.t[i]ns|k[i]t/.test(files)) {
    return "process";
  }

  if (
    /excalidraw-app\/tests|packages\/excalidraw\/tests/.test(files) &&
    /\.tsx$/.test(files)
  ) {
    return "screen";
  }

  return "logic (no screen)";
};
