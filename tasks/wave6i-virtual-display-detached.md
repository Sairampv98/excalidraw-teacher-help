---
id: wave6i-virtual-display-detached
paths: packages/vscode-bridge,SPEC.md
base: main
status: merged
---

# Wave 6i — the extension sees the virtual display the teacher HAS installed

## Why this wave exists

The owner installed the **Virtual Display Driver** (VirtualDrivers/Virtual-Display-Driver, release
25.7.23, "Generic Monitor (VDD by MTT)") on the machine on 2026-10-24, and asked for the VS Code
window to move to that virtual display.

Measured on that machine, right now:

- the driver **is** installed: `Get-PnpDevice -Class Display` shows **"Virtual Display Driver"**
  (`ROOT\DISPLAY\0000`, Status OK) and a monitor **"Generic Monitor (VDD by MTT)"**;
- `C:\VirtualDisplayDriver\vdd_settings.xml` says `<count>1</count>` - one virtual monitor is
  configured, with resolutions up to 3840x2160;
- **and yet the extension's own helper sees only ONE display**: the AMD Radeon at 1920x1080, 0,0.
  The virtual monitor is **not attached to the desktop** - VDD Control keeps it detached until the
  teacher sets its mode to **Extend** (or Clone) in its GUI.

**The bug this wave fixes:** the helper's `Enumerate` mode SKIPS an adapter that has no current mode:

```powershell
$screen = [VdCap]::CurrentMode($adapter.DeviceName)
if ($null -eq $screen) {
  # no mode: this output has no display attached to it. It is not a
  # screen, so it is not reported as one.
  continue
}
```

So the extension cannot tell the difference between

- "there is no virtual display on this machine" (the fallback), and
- "**a virtual display IS installed and the teacher just has to extend it**" (the remedy).

The second case is the one that matters: the teacher is one click away, and the tool says
"no virtual display" instead of naming the click.

### The rules this wave records

| D-146 | an **installed but detached** virtual display is reported, with the click that attaches it | locked | The teacher may have a virtual display driver **installed** and its monitor **detached** - VDD Control keeps a monitor detached until the teacher sets its mode to Extend, and until then the monitor is not part of the desktop's coordinate space, so a window cannot be placed on it. Today the helper skips an adapter with no current mode, so the tool says "there is no virtual display" and the teacher is left thinking they have to install something they already installed. The rule: **a driver that is installed but not attached is still a fact, and the fact names the click.** The extension reports the adapter as a virtual display that is **detached**, and the reason says exactly what to do. |
| D-147 | a window can be moved onto the virtual display **by rule**, and the move never takes the focus | locked | The teacher asked for the **VS Code window** to move to the virtual display, not only the presenter. The capture helper already finds a window **by rule** (D-112, D-113) and the virtual-display helper already places a window **without activating it** (SWP_NOACTIVATE). The rule: **the same rule finds the editor's window** - its title carries the workspace name - and the same placement moves it onto the virtual display **without taking the focus**, so the teacher keeps typing in their editor while their window is on the projector. |

## The rows to add to SPEC.md

**D-146 and D-147 are new** - add them to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-146 | an **installed but detached** virtual display is reported, with the click that attaches it | locked | The teacher may have a virtual display driver **installed** and its monitor **detached** - VDD Control keeps a monitor detached until the teacher sets its mode to Extend, and until then the monitor is not part of the desktop's coordinate space, so a window cannot be placed on it. Today the helper skips an adapter with no current mode, so the tool says "there is no virtual display" and the teacher is left thinking they have to install something they already installed. The rule: **a driver that is installed but not attached is still a fact, and the fact names the click.** The extension reports the adapter as a virtual display that is **detached**, and the reason says exactly what to do. |
| D-147 | a window can be moved onto the virtual display **by rule**, and the move never takes the focus | locked | The teacher asked for the **VS Code window** to move to the virtual display, not only the presenter. The capture helper already finds a window **by rule** (D-112, D-113) and the virtual-display helper already places a window **without activating it** (SWP_NOACTIVATE). The rule: **the same rule finds the editor's window** - its title carries the workspace name - and the same placement moves it onto the virtual display **without taking the focus**, so the teacher keeps typing in their editor while their window is on the projector. |

Add **one** acceptance row to the acceptance tables, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

Use the reserved id **AC-183** and the check file
`packages/vscode-bridge/tests/virtualDisplay.test.ts` (create it if it does not exist). The detail
must name the test names, and the test names must themselves start with the row id - for example:

- `AC-183 an installed but detached virtual display is reported with the click that attaches it`
- `AC-183 the editor's window is moved onto the virtual display without taking the focus`

## The files to change

- `packages/vscode-bridge/extension/media/virtual-display.ps1` - the `Enumerate` mode must **not
  skip** an adapter that has no current mode. Report it with `attached: false` and
  `virtual: true`, and say plainly that the monitor is **detached** and that it must be set to
  Extend in VDD Control before a window can be placed on it.
- `packages/vscode-bridge/extension/src/virtualDisplay.ts` - the `DisplayDevice` shape gains what
  the detached case needs (a flag and a reason), `chooseTargetDisplay` must **not** choose a
  detached display (there is nothing to place a window on), and the reason it gives back must name
  the click.
- `packages/vscode-bridge/extension/src/inputPanel.ts` - the panel must show the remedy, and it
  must offer the **move the editor's window** action (D-147).
- `packages/vscode-bridge/extension/src/extension.ts` - the command that moves the editor's window
  onto the virtual display, by the workspace-name rule.
- `packages/vscode-bridge/tests/virtualDisplay.test.ts` - the AC-183 tests.

## The constraints

- **Spec first**: the rows go into `SPEC.md` **before** the code.
- **No new dependency.**
- **No driver is installed and none is required.** A machine with no virtual display driver at all
  still works and still says so plainly (D-145).
- The placement **never takes the focus** (SWP_NOACTIVATE) - the teacher is typing in their editor.
- The window is found **by rule** (a title substring), never by a remembered handle (D-112, D-113).
- The remedy text must name **VDD Control** and the **Extend** mode, because that is what the
  teacher has to do - a message that says "no virtual display" when one is installed is the bug
  this wave exists to fix.
- Text in `packages/excalidraw/locales/en.json` if the library needs a new string - put it in a
  NEW group called `virtualDisplay` inside `labels`, so another wave editing the `panel` group does
  not collide.
- LF line endings, no BOM, `yarn` only (never npm/pnpm).
- Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
  `npx vitest run <file> --watch=false`.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**IMPORTANT - do NOT run `node .tins\kit\bin\kit.mjs close`.** The gate takes a machine-wide lock
and two concurrent gates deadlock each other; the PARENT closes this session and merges it, one wave
at a time. So: run the gate yourself for your own proof (if it reports that another gate holds the
lock, that is not your failure - note it in your report and move on), run the rowcheck, commit your
work with a clear message, and STOP. The parent will close the session and merge.

**The real proof, beyond the tests**: on the machine that has the **Virtual Display Driver
installed**, run the helper's `Enumerate` mode and show that it now reports **two** entries - the
AMD display (attached) and the **virtual display (detached)** - and that the panel's reason says
what to do. Then, if the teacher has set the monitor to **Extend**, show the presenter's window (and
the editor's window) actually moving onto it, and show that the teacher's own keystrokes still reach
their editor.

Report what you saw, including the two raw lines the helper printed.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-183 tests must FAIL. Restore the fix and they must pass again. Report both failure messages
verbatim in your report.

REPORT BACK (plain text, under 250 words): what changed, the file list with line counts, the gate
result, the rowcheck result, the two raw lines the helper printed on this machine, both teeth
failures verbatim, and anything you could not do. Do not close the session - the parent does that.
