#!/usr/bin/env node
/**
 * Build the `.vsix`.
 *
 * A `.vsix` is a zip: the `extension/` folder at the root, plus
 * `[Content_Types].xml` and `extension.vsixmanifest`. This script writes that
 * zip ITSELF - the STORE method (no compression) is a few dozen lines and
 * works on every platform - so the extension needs no packaging dependency,
 * and neither does the repository.
 *
 * The extension's TypeScript is bundled with esbuild, which the repository
 * already has. `vscode` is external: the editor provides it at run time.
 *
 *   node packages/vscode-bridge/scripts/build-vsix.mjs [--out <file.vsix>]
 */
import { build } from "esbuild";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const extensionDir = join(packageRoot, "extension");
const stageDir = join(packageRoot, "build", "vsix");
const manifest = JSON.parse(
  readFileSync(join(extensionDir, "package.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// the zip writer (STORE, no compression)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (let index = 0; index < buffer.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const dosTimestamp = (date) => {
  const time =
    ((date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)) &
    0xffff;
  const day =
    (((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()) &
    0xffff;
  return { time, day };
};

/**
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer}
 */
const writeZip = (entries) => {
  const { time, day } = dosTimestamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: the name is utf-8
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0014, 4); // made by: MS-DOS, zip 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
};

// ---------------------------------------------------------------------------
// the manifest files the installer needs
// ---------------------------------------------------------------------------
const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}" />
    <DisplayName>${manifest.displayName}</DisplayName>
    <Description xml:space="preserve">${manifest.description}</Description>
    <Tags>${(manifest.keywords ?? []).join(",")}</Tags>
    <Categories>${(manifest.categories ?? ["Other"]).join(",")}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${(manifest.extensionKind ?? ["workspace"]).join(",")}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
const outFlagIndex = process.argv.indexOf("--out");
const outPath =
  outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
    ? resolve(process.argv[outFlagIndex + 1])
    : join(packageRoot, `${manifest.name}-${manifest.version}.vsix`);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "extension", "out"), { recursive: true });

await build({
  entryPoints: [join(extensionDir, "src", "extension.ts")],
  outfile: join(stageDir, "extension", "out", "extension.js"),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "warning",
});

copyFileSync(
  join(extensionDir, "package.json"),
  join(stageDir, "extension", "package.json"),
);

const readme = join(packageRoot, "README.md");
if (existsSync(readme)) {
  copyFileSync(readme, join(stageDir, "extension", "README.md"));
}

const entries = [
  { name: "extension/package.json", data: readFileSync(join(stageDir, "extension", "package.json")) },
  { name: "extension/out/extension.js", data: readFileSync(join(stageDir, "extension", "out", "extension.js")) },
];
if (existsSync(join(stageDir, "extension", "README.md"))) {
  entries.push({
    name: "extension/README.md",
    data: readFileSync(join(stageDir, "extension", "README.md")),
  });
}
entries.push({
  name: "extension.vsixmanifest",
  data: Buffer.from(vsixManifest, "utf8"),
});
entries.push({
  name: "[Content_Types].xml",
  data: Buffer.from(contentTypes, "utf8"),
});

const zip = writeZip(entries);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zip);

// read the file back and check it is a zip with the entries we meant to write
const written = readFileSync(outPath);
if (written.readUInt32LE(0) !== 0x04034b50) {
  throw new Error("the vsix does not start with a zip local file header");
}
for (const entry of entries) {
  if (!written.includes(Buffer.from(entry.name, "utf8"))) {
    throw new Error(`the vsix is missing ${entry.name}`);
  }
}

const size = statSync(outPath).size;
process.stdout.write(`vsix: ${outPath}\n`);
process.stdout.write(`size: ${size} bytes\n`);
process.stdout.write("entries:\n");
for (const entry of entries) {
  process.stdout.write(`  ${entry.name} (${entry.data.length} bytes)\n`);
}
