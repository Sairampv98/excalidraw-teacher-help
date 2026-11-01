/**
 * AC-523 - the release of the artifacts.
 *
 * An artifact is built from the private tree, so it carries what the private
 * tree carries: the ids of the decisions, the words of the way this repository
 * is developed and the paths of the machine that built it. The release scrubs
 * the artifact with the scrubber the mirror uses, and then scans it with the
 * guard the mirror uses - and a finding stops the release.
 */

import { describe, expect, it } from "vitest";

import { readZip } from "../../../packages/vscode-bridge/tests/helpers/zip";
import { scanFiles, scrubFiles } from "../release.mjs";
import { writeZip } from "../../../packages/vscode-bridge/scripts/zip.mjs";

/** a file of the extension's own package, with what it carries */
const aPrivateFile = () =>
  new Map([
    [
      "extension/media/window.ps1",
      Buffer.from(
        [
          "# The window helper (D-329).",
          "# It parks the window on the virtual display of C:\\Users\\teacher\\Desktop.",
          "Write-Host 'ready'",
          "",
        ].join("\n"),
        "utf8",
      ),
    ],
    [
      "extension/node_modules/tesseract.js-core/wasm.js",
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x00, 0x01]),
    ],
  ]);

describe("AC-523 an artifact carries nothing of the method", () => {
  it("AC-523 an artifact's text is scrubbed and scanned", () => {
    const { files } = scrubFiles(aPrivateFile());

    const helper = files.get("extension/media/window.ps1").toString("utf8");

    // the id is gone
    expect(helper).not.toContain("D-329");

    // and the path of the machine that built it is the reader's own
    expect(helper).toContain("C:\\Users\\you\\Desktop");
    expect(helper).toContain("Write-Host 'ready'");

    // a binary file is left exactly as it was
    expect(
      files.get("extension/node_modules/tesseract.js-core/wasm.js"),
    ).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x00, 0x01]));

    // and the guard finds nothing in what is left
    expect(scanFiles(files)).toEqual([]);

    // the sentences the rewrite map does not hold are dropped, and reported
    const unmapped = scrubFiles(
      new Map([
        [
          "a.ts",
          Buffer.from(
            "// Wave 9z changed the whole thing.\nexport const a = 1;\n",
          ),
        ],
      ]),
    );

    expect(unmapped.files.get("a.ts").toString("utf8")).not.toMatch(/wave/i);
    expect(unmapped.files.get("a.ts").toString("utf8")).toContain(
      "export const a = 1;",
    );
    expect(unmapped.dropped.length).toBe(1);
  });

  it("AC-523 the release stops on a finding", () => {
    // an artifact that was NOT scrubbed still carries the id
    const findings = scanFiles(aPrivateFile());

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.rule)).toContain("id");

    // and a secret is a finding too, and the value is never in the report
    // the value is a row of x's: it is not a credential, but it has the shape
    // of one, and the guard cannot tell the two apart - which is exactly why
    // the guard looks
    const withSecret = scanFiles(
      new Map([
        [
          "a.txt",
          Buffer.from(
            "token = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'\n",
          ),
        ],
      ]),
    );

    expect(withSecret.length).toBeGreaterThan(0);
    expect(withSecret[0].rule).toBe("secret");
    expect(JSON.stringify(withSecret)).not.toContain("xxxxxxxx");
  });

  it("AC-523 a zip is read, scrubbed and written again", () => {
    const entries = [
      {
        name: "extension/package.json",
        data: Buffer.from('{"version":"0.2.0"}'),
      },
      {
        name: "extension/out/extension.js",
        data: Buffer.from("// (D-1)\nconst a = 1;\n"),
      },
    ];

    const zip = writeZip(entries);

    // the archive is read with the reader the tests have always used - the
    // one that is NOT the writer's own code
    const read = readZip(zip);

    expect(read.map((entry) => entry.name)).toEqual([
      "extension/package.json",
      "extension/out/extension.js",
    ]);
    expect(read[0].data.toString("utf8")).toBe('{"version":"0.2.0"}');

    // the entries of the archive go through the scrub, and the archive is
    // written again with the same names in the same order
    const { files } = scrubFiles(
      new Map(read.map((entry) => [entry.name, entry.data])),
    );

    expect(
      files.get("extension/out/extension.js").toString("utf8"),
    ).not.toContain("D-1");

    // a scrub that broke the package would publish an extension that cannot
    // be installed: the manifest is still JSON
    expect(() =>
      JSON.parse(files.get("extension/package.json").toString("utf8")),
    ).not.toThrow();

    const again = readZip(
      writeZip([...files].map(([name, data]) => ({ name, data }))),
    );

    expect(again.map((entry) => entry.name)).toEqual([
      "extension/package.json",
      "extension/out/extension.js",
    ]);
    expect(again[1].data.toString("utf8")).toContain("const a = 1;");
    expect(
      scanFiles(new Map(again.map((entry) => [entry.name, entry.data]))),
    ).toEqual([]);
  });
});
