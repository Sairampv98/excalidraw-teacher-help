/**
 * The offline proof must be about a FRESH sandbox, and it must say which of
 * the two took the internet away (D-156, AC-190).
 *
 * The proof is what tells us the offline setup really works on a machine with
 * no internet. It is only worth anything if two things are true:
 *
 *   1. the sandbox it ran in was FRESH - Windows Sandbox reuses a running
 *      virtual machine, and a live session keeps the configuration of the
 *      session it was started with;
 *   2. the machine really had no internet while the setup ran.
 *
 * The second one cannot be taken on trust. The .wsb asks for no networking,
 * and on the machine this was proved on that request was NOT honoured: the
 * Sandbox came up with a "Microsoft Hyper-V Network Adapter", a default route
 * and a working internet - even on a sandbox that had just been started. So
 * the run takes the network down from inside, by three separate means, and
 * says which of the two did it.
 *
 * This test proves the SHAPE, by reading the FILES:
 *
 *   - the sandbox file (`installer/offline/offline.wsb`),
 *   - the run that happens inside it (`installer/offline/run.ps1`),
 *   - the launcher that starts it (`installer/offline/run-offline-proof.ps1`).
 *
 * It starts no sandbox and touches no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The repository root, found by walking up from the working directory. */
const findRepoRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "excalidraw-app", "App.tsx");

    if (existsSync(candidate)) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the repository root was not found");
};

const repoRoot = findRepoRoot();

const read = (relative: string) =>
  readFileSync(join(repoRoot, relative), "utf8");

const WSB = "installer/offline/offline.wsb";
const RUN = "installer/offline/run.ps1";
const LAUNCHER = "installer/offline/run-offline-proof.ps1";

describe("the offline proof: a fresh sandbox, and an honest record", () => {
  it("AC-190 the sandbox file asks for no networking and runs the proof", () => {
    const wsb = read(WSB);

    // the setting is the right one and it is kept
    expect(wsb).toContain("<Networking>None</Networking>");

    // the folder with the payload is mapped in, and the proof runs itself
    expect(wsb).toContain("<MappedFolder>");
    expect(wsb).toContain("<SandboxFolder>C:\\Sandbox</SandboxFolder>");
    expect(wsb).toContain("C:\\Sandbox\\run.ps1");

    // and the shipped file does not name ONE MACHINE's folder - the launcher
    // writes the file for wherever the payload is
    expect(wsb).not.toContain("C:\\Users\\");
    expect(wsb).toContain("run-offline-proof.ps1");

    // and the file says plainly that the setting alone is not trusted, so
    // nobody reads it as a promise it cannot keep
    expect(wsb).toContain("does not trust it");
    expect(wsb).toContain("run-offline-proof.ps1");
  });

  it("AC-190 the run records the network as the sandbox set it up, BEFORE it takes it down", () => {
    const run = read(RUN);

    // the adapters and the default route are recorded first
    const adapters = run.indexOf("Get-NetAdapter");
    const routes = run.indexOf("Get-NetRoute");
    const takeover = run.indexOf("TAKING THE NETWORK DOWN FROM INSIDE");

    expect(adapters).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(-1);
    expect(takeover).toBeGreaterThan(-1);

    // the record of what the sandbox did comes BEFORE the takeover
    expect(adapters).toBeLessThan(takeover);
    expect(routes).toBeLessThan(takeover);

    // and the internet is asked about before anything is changed
    const before = run.indexOf("WHICH OF THE TWO TOOK THE INTERNET AWAY");
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(takeover);
  });

  it("AC-190 the run says which of the two took the internet away", () => {
    const run = read(RUN);

    // it names the two, and it says which one it was
    expect(run).toContain("WHICH OF THE TWO TOOK THE INTERNET AWAY");
    expect(run).toContain("NOT the .wsb");
    expect(run).toContain("The .wsb.");

    // and it says why: the Sandbox came up with a default route anyway
    expect(run).toContain("The Sandbox was given a network anyway");

    // the two are decided by facts, not by an assumption
    expect(run).toContain("$routedBefore");
    expect(run).toContain("$internetBefore");
  });

  it("AC-190 the run takes the network down by more than one way, and says how many worked", () => {
    const run = read(RUN);

    // three separate means: a firewall rule, the default route removed, and
    // the adapter disabled. One of them failed on the machine this was proved
    // on, so the proof must not rest on any single one.
    expect(run).toContain("New-NetFirewallRule");
    expect(run).toContain("Remove-NetRoute");
    expect(run).toContain("Disable-NetAdapter");

    // and the record says how many of them worked
    expect(run).toContain("$takenDown");
    expect(run).toContain("of the three ways worked");
  });

  it("AC-190 the proof is only valid when the machine is really offline", () => {
    const run = read(RUN);

    // the machine is probed three ways, each a different way of asking
    expect(run).toContain("GetHostAddresses");
    expect(run).toContain("TcpClient");
    expect(run).toContain("Invoke-WebRequest");

    // and any probe that answers makes the proof invalid
    expect(run).toContain(
      "THE MACHINE IS NOT OFFLINE - THIS PROOF IS NOT VALID.",
    );
    expect(run).toContain("THE MACHINE IS OFFLINE");
  });

  it("AC-190 the launcher starts a sandbox that is fresh, and prints the result", () => {
    expect(existsSync(join(repoRoot, LAUNCHER))).toBe(true);

    const launcher = read(LAUNCHER);

    // it stops a sandbox that is already running, and waits for it to be gone
    expect(launcher).toContain("Get-Process -Name 'WindowsSandbox'");
    expect(launcher).toContain("CloseMainWindow");
    expect(launcher).toContain("Stop-Process");
    expect(launcher).toContain("a Windows Sandbox is STILL running");

    // it writes the sandbox file for the folder the proof is in, so the proof
    // is not tied to one machine's path
    expect(launcher).toContain("offline-proof.wsb");
    expect(launcher).toContain("<Networking>None</Networking>");
    expect(launcher).toContain("$PayloadDir");

    // and it starts the sandbox and prints what came back
    expect(launcher).toContain("WindowsSandbox.exe");
    expect(launcher).toContain("sandbox-result.txt");

    // the verdict is the machine's own words
    expect(launcher).toContain("THE MACHINE IS OFFLINE");
    expect(launcher).toContain("THE PROOF IS VALID");
    expect(launcher).toContain("THE PROOF IS NOT VALID");

    // and it touches nothing else on the machine
    expect(launcher).not.toContain("Stop-Process -Name 'Code'");
    expect(launcher).not.toContain("Stop-Process -Name 'codium'");
  });
});
