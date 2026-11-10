/**
 * AC-575 - the editor of the setups (D-479, D-480): every setup that carries the editor carries VSCodium (the
 *          MIT-licensed build); the small setup, which downloads, takes Microsoft's VS Code from Microsoft.
 */
import { describe, expect, it } from "vitest";

import { TOOLS } from "../../win7/build-win7-payload.mjs";
import { addressesOf, makeList, withVSCode } from "../make-online-manifest.mjs";

const where = {
  releaseBase: "https://example.test/release/",
  mirrorBase: undefined,
};

const codium = {
  role: "vscodium",
  name: "vscodium-x64-setup.exe",
  version: "1.100.0.1",
  size: 2,
  sha256: "codium-hash",
  source: "https://github.com/VSCodium/vscodium/releases/download/x/y.exe",
};

const code = {
  role: "vscode",
  name: "vscode-x64-setup.exe",
  version: "1.100.0",
  size: 3,
  sha256: "code-hash",
  source: "https://update.code.visualstudio.com/latest/win32-x64-user/stable",
};

const app = {
  role: "app",
  name: "app.zip",
  version: "built",
  size: 1,
  sha256: "app-hash",
  source: null,
};

describe("AC-575 the editor of the setups", () => {
  it("the Windows 7 payload carries VSCodium 1.70 for one user, and no Microsoft VS Code", () => {
    const roles = TOOLS.map((tool) => tool.role);

    expect(roles).toContain("vscodium");
    expect(roles).not.toContain("vscode");

    const editor = TOOLS.find((tool) => tool.role === "vscodium");

    expect(editor.version.startsWith("1.70.")).toBe(true);
    expect(editor.name).toMatch(/^VSCodiumUserSetup-ia32-1\.70\./);
    expect(editor.source).toContain("github.com/VSCodium/vscodium/");
  });

  it("the small setup's list names Microsoft's VS Code, never VSCodium", () => {
    const list = makeList({
      manifest: { files: [app, codium] },
      vscodeManifest: { files: [code] },
      ...where,
    });
    const roles = list.files.map((file) => file.role);

    expect(roles).toEqual(["app", "vscode"]);

    const editor = list.files.find((file) => file.role === "vscode");

    expect(editor.sha256).toBe("code-hash");
    expect(editor.urls[0]).toBe(
      "https://update.code.visualstudio.com/1.100.0/win32-x64-user/stable",
    );
  });

  it("the student list of the small setup holds VS Code too", () => {
    const list = makeList({
      manifest: { files: [app, codium] },
      vscodeManifest: { files: [code] },
      student: true,
      ...where,
    });

    expect(list.files.map((file) => file.role)).toEqual(["vscode"]);
  });

  it("a small-setup list cannot be made without a VS Code entry to put in", () => {
    expect(() => withVSCode({ files: [codium] }, { files: [app] })).toThrow(
      /VS Code entry/,
    );
  });

  it("a list made with no VS Code payload keeps what the payload has", () => {
    const list = makeList({ manifest: { files: [app, codium] }, ...where });

    expect(list.files.map((file) => file.role)).toEqual(["app", "vscodium"]);
    expect(addressesOf(codium, where).length).toBeGreaterThan(0);
  });
});
