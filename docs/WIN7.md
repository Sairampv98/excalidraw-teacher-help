# The universal Windows 7 offline setup: research and plan (2026-11-08)

## What the research found (and how sure it is)

Microsoft's own pages say (sure):

- Windows 7 SP1 needs the **servicing stack update KB4490628** and the **SHA-2 update KB4474419** before it can install any update released on or after August 2019. Both must be installed, and the machine restarted, before later updates. Without them, errors 80096010 or 80092004 appear. (support.microsoft.com, "2019 SHA-2 Code Signing Support requirement for Windows and WSUS".)
- Python's own documentation (3.8): Python 3.8 is the version for Windows 7; on Windows 7 it needs **KB2533623**; the C runtime (UCRT, KB2999226) must be there; the full installer's "Install Now" is per-user and needs administrator rights only when the C runtime update must be installed.

Other sources say (less sure, to be proved in the VM):

- KB2999226 (the C runtime) fails with 0x800b0001 on a Windows 7 that has no SHA-2 support: so the order is SP1, then KB4490628, then KB4474419, restart, then KB2999226.
- Node.js 12.22.x is the last LTS that runs on Windows 7 (13.14 is the last release of any kind). VS Code 1.70.3 is the last release for Windows 7 (the extension already asks for 1.70). Chrome 109 is the last Chrome for Windows 7 and needs a CPU with SSE3.
- Adoptium's page lists no Windows 7 at all, so Java 8 on Windows 7 is "works in practice, unsupported": it has to be proved in the VM, not assumed.
- Which Visual C++ runtime version is the last for Windows 7 is not settled by the sources: not needed if the tools that need it carry their own (Chromium does; Node, Python and VS Code use the C runtime above).

## What the setup must do (the plan)

1. **One Windows 7 build of the installer**, for .NET 3.5 (the only .NET a clean Windows 7 SP1 has): C# 3, no ZipArchive (a small zip reader on DeflateStream), the same wizard, uninstaller and tray launcher. The Windows 10/11 installer is built for .NET 4 and cannot run there.
2. **Stage 1, "Prepare Windows" (needs administrator: one UAC prompt)**: detect and install what is missing, in order: SP1 (KB976932), KB4490628, KB4474419, KB2533623, KB2999226; restart as needed and **continue by itself after each restart** (a RunOnce entry). Detection: the service pack level of Windows (WMI), the list of installed updates (QFE), and `wusa`'s own answer when an update is already there or does not apply. On an SP1 machine only what is missing is installed.
3. **Stage 2, the tools, for the user alone**: the same as the other installer, with the Windows 7 versions: Python 3.8.10, Node 12.22.12, VS Code 1.70.3 (and the extension), Java 8, a GCC build that runs on Windows 7 (msvcrt), and a bundled Chromium 109 (a Windows 7 machine may have only Internet Explorer).
4. **One 32-bit toolset for both 32-bit and 64-bit Windows** (32-bit programs run on 64-bit Windows). The operating-system updates are the only parts that differ: an x86 pack and an x64 pack.
5. **Packaging**: GitHub release files are limited to 2 GB each, and SP1 x64 alone is about 0.9 GB. So it is a folder: the small setup, the tools pack, and the x86 and x64 update packs. It is one folder (about 2.5 GB) that is copied to a USB stick or a shared drive, and the setup picks the pack that matches the machine. It cannot be one file.
6. **Honest limit**: the clean Windows 7 VM here is 32-bit. There is no 64-bit Windows 7 image, so the x64 path can be proved only by its logic (fake `wusa`, hashes, detection) unless a 64-bit Windows 7 ISO is provided.

## How it is tested

- A new VM from the RTM ISO with the same unattended answer file (no SP1): the real "SP1 is missing" path, with a snapshot before each stage.
- The existing VM `Win7Test` (SP1 already there): the "only the missing updates" path.
- Windows 10 and 11 development VMs: the click-through installer and the online edition.

## What has to be downloaded (to be agreed first)

- KB976932 x64 (SP1, about 0.9 GB; the x86 one is already in the pack), KB4490628 and KB4474419 for x86 and x64, KB2533623 and KB2999226 for x86 and x64, from Microsoft (the Update Catalog or the Download Center).
- Python 3.8.10 (python.org), VS Code 1.70.3 (update.code.visualstudio.com), and a Windows 7 build of Temurin 8 and of winlibs (in the pack already for 32-bit).

## The existing VM

`Win7Test` was installed from the owner's RTM ISO by `unattend\Autounattend.xml`, and SP1 was installed afterwards and then checkpointed (`clean-win7sp1-installed`). The state before SP1 was not kept. So a no-SP1 machine is made by installing again from the RTM ISO with the same answer file (about 30 minutes), and a checkpoint is kept this time.
